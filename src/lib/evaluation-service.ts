import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getSupabase } from "./supabase";
import { updateAttemptStatus } from "./exam-service";

// ---------------------------------------------------------------------------
// Lab evaluation
// ---------------------------------------------------------------------------

const TASK_CHECK_MAP: Record<string, string[]> = {
  task1_jquery: ["jquery_version", "vendor_updated"],
  task2_analytics: ["no_ua_tag"],
  task3_branding: ["global_scss", "overrides_scss", "img_profile", "skill_badge"],
};

// All check names, to determine which task each check belongs to
function checkToTaskId(checkName: string): string | null {
  for (const [taskId, checks] of Object.entries(TASK_CHECK_MAP)) {
    if (checks.includes(checkName)) return taskId;
  }
  return null;
}

export async function evaluateLabResults(attemptId: number): Promise<void> {
  const supabase = getSupabase();

  // Idempotent: clear previous results before writing new ones
  const { error: deleteError } = await supabase
    .from("lab_results")
    .delete()
    .eq("attempt_id", attemptId);
  if (deleteError) throw new Error(`evaluateLabResults delete failed: ${deleteError.message}`);

  if (process.env.USE_MOCK === "true") {
    const mockTasks = [
      {
        task_id: "task1_jquery",
        passed: 1,
        details_json: JSON.stringify({ checks: ["jquery_version", "vendor_updated"], allPassed: true }),
      },
      {
        task_id: "task2_analytics",
        passed: 1,
        details_json: JSON.stringify({ checks: ["no_ua_tag"], allPassed: true }),
      },
      {
        task_id: "task3_branding",
        passed: 1,
        details_json: JSON.stringify({
          checks: ["global_scss", "overrides_scss", "img_profile", "skill_badge"],
          allPassed: true,
        }),
      },
    ];

    const rows = mockTasks.map((t) => ({ attempt_id: attemptId, ...t }));
    const { error: insertError } = await supabase.from("lab_results").insert(rows);
    if (insertError) throw new Error(`evaluateLabResults mock insert failed: ${insertError.message}`);
    return;
  }

  // Real mode: read lab_results event from validation_events
  const { data: events, error: eventsError } = await supabase
    .from("validation_events")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("event_type", "lab_results")
    .order("timestamp", { ascending: false })
    .limit(1);

  if (eventsError) throw new Error(`evaluateLabResults events fetch failed: ${eventsError.message}`);

  if (!events || events.length === 0) {
    console.warn(
      `evaluateLabResults: no lab_results event for attempt ${attemptId}, skipping lab check`
    );
    return;
  }

  // Parse the most recent lab_results event
  const latestEvent = events[0] as Record<string, unknown>;
  let stdout: string;
  try {
    const rawJson = latestEvent.raw_json as string;
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    stdout = typeof parsed.output === "string" ? parsed.output : rawJson;
  } catch {
    console.warn(
      `evaluateLabResults: failed to parse lab_results event for attempt ${attemptId}`
    );
    return;
  }

  // Parse stdout: lines starting with ✓ (pass) or ✗ (fail)
  const taskChecks: Record<string, { passed: string[]; failed: string[] }> = {};
  for (const taskId of Object.keys(TASK_CHECK_MAP)) {
    taskChecks[taskId] = { passed: [], failed: [] };
  }

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    let isPassed: boolean | null = null;
    let checkName: string | null = null;

    if (trimmed.startsWith("✓")) {
      isPassed = true;
      checkName = trimmed.replace(/^✓\s*/, "").trim();
    } else if (trimmed.startsWith("✗")) {
      isPassed = false;
      checkName = trimmed.replace(/^✗\s*/, "").trim();
    }

    if (checkName !== null && isPassed !== null) {
      const taskId = checkToTaskId(checkName);
      if (taskId) {
        if (isPassed) {
          taskChecks[taskId].passed.push(checkName);
        } else {
          taskChecks[taskId].failed.push(checkName);
        }
      }
    }
  }

  // Insert results — a task passes only when all its checks pass
  const insertRows = Object.entries(taskChecks).map(([taskId, { passed, failed }]) => {
    const allPassed = failed.length === 0 && passed.length > 0;
    return {
      attempt_id: attemptId,
      task_id: taskId,
      passed: allPassed ? 1 : 0,
      details_json: JSON.stringify({ passed, failed, allPassed }),
    };
  });

  const { error: insertError } = await supabase.from("lab_results").insert(insertRows);
  if (insertError) throw new Error(`evaluateLabResults insert failed: ${insertError.message}`);
}

// ---------------------------------------------------------------------------
// Fluency evaluation
// ---------------------------------------------------------------------------

interface ValidationEvent {
  id: number;
  attempt_id: number;
  event_type: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  timestamp: string;
  raw_json: string;
}

const FluencyDimensionSchema = z.object({
  score: z.number().min(0).max(5),
  justification: z.string(),
});

const FluencyResponseSchema = z.object({
  delegation: FluencyDimensionSchema,
  description: FluencyDimensionSchema,
  discernment: FluencyDimensionSchema,
  diligence: FluencyDimensionSchema,
});

type FluencyResponse = z.infer<typeof FluencyResponseSchema>;

export function buildFluencyPrompt(events: ValidationEvent[]): string {
  // Build a human-readable transcript of Claude Code activity
  const lines: string[] = ["# Claude Code Activity Transcript", ""];

  for (const event of events) {
    lines.push(`[${event.timestamp}] ${event.event_type}`);
    if (event.tool_name) {
      lines.push(`  Tool: ${event.tool_name}`);
    }
    if (event.tool_input) {
      try {
        const parsed = JSON.parse(event.tool_input) as unknown;
        lines.push(`  Input: ${JSON.stringify(parsed, null, 2).substring(0, 500)}`);
      } catch {
        lines.push(`  Input: ${event.tool_input.substring(0, 500)}`);
      }
    }
    if (event.tool_output) {
      try {
        const parsed = JSON.parse(event.tool_output) as unknown;
        lines.push(`  Output: ${JSON.stringify(parsed, null, 2).substring(0, 300)}`);
      } catch {
        lines.push(`  Output: ${event.tool_output.substring(0, 300)}`);
      }
    }
    lines.push("");
  }

  lines.push(`Total events: ${events.length}`);
  lines.push("");

  lines.push(`
# Evaluation Task

You are evaluating a candidate's ability to work with Claude Code based on their session transcript above.

Score the candidate on these four dimensions (the 4Ds), each on a scale of 0.0–5.0:

1. **Delegation** — Did the candidate break work into well-scoped tasks and delegate them effectively to Claude Code? Did they avoid doing manually what Claude could do?

2. **Description** — Were their task descriptions clear, specific, and unambiguous? Did they provide the context Claude needed to succeed on the first attempt?

3. **Discernment** — Did the candidate critically evaluate Claude's suggestions before accepting them? Did they push back on incorrect solutions and verify outcomes?

4. **Diligence** — Did the candidate verify their work thoroughly? Did they run tests, check results, and ensure the final output met requirements?

Respond with ONLY valid JSON in this exact format (no markdown, no preamble):
{
  "delegation": { "score": 0.0, "justification": "..." },
  "description": { "score": 0.0, "justification": "..." },
  "discernment": { "score": 0.0, "justification": "..." },
  "diligence": { "score": 0.0, "justification": "..." }
}
`);

  return lines.join("\n");
}

export async function evaluateFluency(attemptId: number): Promise<void> {
  const supabase = getSupabase();

  // Idempotent: clear previous score before writing new one
  const { error: deleteError } = await supabase
    .from("fluency_scores")
    .delete()
    .eq("attempt_id", attemptId);
  if (deleteError) throw new Error(`evaluateFluency delete failed: ${deleteError.message}`);

  if (process.env.USE_MOCK === "true") {
    const mockResult: FluencyResponse = {
      delegation: {
        score: 3.5,
        justification:
          "The candidate broke the work into separate tasks but could have been more granular in their approach.",
      },
      description: {
        score: 4.0,
        justification:
          "Clear problem descriptions with specific file references and expected outcomes.",
      },
      discernment: {
        score: 3.0,
        justification:
          "Accepted most suggestions without questioning alternatives. Some evidence of critical evaluation.",
      },
      diligence: {
        score: 4.5,
        justification:
          "Consistently verified changes by running the test suite and checking results.",
      },
    };

    const { error: insertError } = await supabase.from("fluency_scores").insert({
      attempt_id: attemptId,
      delegation: mockResult.delegation.score,
      description: mockResult.description.score,
      discernment: mockResult.discernment.score,
      diligence: mockResult.diligence.score,
      raw_analysis: JSON.stringify(mockResult),
    });
    if (insertError) throw new Error(`evaluateFluency mock insert failed: ${insertError.message}`);
    return;
  }

  // Real mode: build transcript from validation_events, call Anthropic API
  const { data: eventsData, error: eventsError } = await supabase
    .from("validation_events")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("timestamp", { ascending: true });

  if (eventsError) throw new Error(`evaluateFluency events fetch failed: ${eventsError.message}`);

  const events = (eventsData ?? []) as ValidationEvent[];

  if (events.length === 0) {
    console.warn(
      `evaluateFluency: no validation events for attempt ${attemptId}, skipping fluency scoring`
    );
    return;
  }

  const promptText = buildFluencyPrompt(events);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: promptText }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse and validate the JSON response
  let parsed: unknown;
  try {
    // Strip any markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error(
      `evaluateFluency: failed to parse Anthropic response for attempt ${attemptId}:`,
      err instanceof Error ? err.message : String(err),
      "\nRaw text:",
      text
    );
    return;
  }

  const validated = FluencyResponseSchema.safeParse(parsed);
  if (!validated.success) {
    console.error(
      `evaluateFluency: invalid response schema for attempt ${attemptId}:`,
      validated.error.issues
    );
    return;
  }

  const result = validated.data;
  const { error: insertError } = await supabase.from("fluency_scores").insert({
    attempt_id: attemptId,
    delegation: result.delegation.score,
    description: result.description.score,
    discernment: result.discernment.score,
    diligence: result.diligence.score,
    raw_analysis: JSON.stringify(result),
  });
  if (insertError) throw new Error(`evaluateFluency insert failed: ${insertError.message}`);
}

// ---------------------------------------------------------------------------
// Full evaluation orchestrator
// ---------------------------------------------------------------------------

export async function runFullEvaluation(attemptId: number): Promise<void> {
  try {
    await evaluateLabResults(attemptId);
  } catch (err) {
    console.error(
      `runFullEvaluation: evaluateLabResults failed for attempt ${attemptId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    await evaluateFluency(attemptId);
  } catch (err) {
    console.error(
      `runFullEvaluation: evaluateFluency failed for attempt ${attemptId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  await updateAttemptStatus(attemptId, "evaluated");
}
