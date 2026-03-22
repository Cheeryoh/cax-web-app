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
      `evaluateLabResults: no lab_results event for attempt ${attemptId}, inserting default failing rows`
    );
    const defaultRows = Object.entries(TASK_CHECK_MAP).map(([taskId, checks]) => ({
      attempt_id: attemptId,
      task_id: taskId,
      passed: 0,
      details_json: JSON.stringify({
        passed: [],
        failed: checks,
        allPassed: false,
        reason: "no_validation_event",
      }),
    }));
    const { error: defaultInsertError } = await supabase
      .from("lab_results")
      .insert(defaultRows);
    if (defaultInsertError)
      throw new Error(`evaluateLabResults default insert failed: ${defaultInsertError.message}`);
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
// Fluency evaluation (shared types and helpers)
// ---------------------------------------------------------------------------

interface ValidationEvent {
  id: number;
  attempt_id: number;
  event_type: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  task_id: string | null;
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

// ---------------------------------------------------------------------------
// Task names
// ---------------------------------------------------------------------------

const TASK_NAMES: Record<string, string> = {
  task1_jquery: "jQuery Vulnerability Fix",
  task2_analytics: "Dead Analytics Removal",
  task3_branding: "Brand Color Consistency",
};

// ---------------------------------------------------------------------------
// Phase 3: Per-task tool attribution
// ---------------------------------------------------------------------------

const TASK_FILE_PATTERNS: Record<string, RegExp[]> = {
  task1_jquery: [/jquery/i, /vendor\//i, /package\.json/i, /package-lock/i, /node_modules/i],
  task2_analytics: [/analytics/i, /ua-/i, /gtag/i, /google/i],
  task3_branding: [/\.scss/i, /brand/i, /#bd5d38/i, /\$primary/i, /img-profile/i, /skill-badge/i],
};

/**
 * Scan a string for task file pattern matches. Returns matching task IDs.
 * index.html is ambiguous — caller should do a more specific check first.
 */
function matchPatterns(text: string): string[] {
  const matches: string[] = [];
  for (const [taskId, patterns] of Object.entries(TASK_FILE_PATTERNS)) {
    if (patterns.some((re) => re.test(text))) {
      matches.push(taskId);
    }
  }
  return matches;
}

/**
 * For a single validation event, determine which task it belongs to.
 * Scans tool_input and tool_output JSON for file path / content patterns.
 */
function attributeEvent(event: ValidationEvent): string {
  const combined = [
    event.tool_input ?? "",
    event.tool_output ?? "",
  ].join(" ");

  const matches = matchPatterns(combined);

  if (matches.length === 1) return matches[0];

  // index.html is both task2 and task3 — use more specific signals
  if (matches.length > 1) {
    const task2Signals = /ua-|analytics|gtag|google-analytics/.test(combined);
    const task3Signals = /\.scss|#bd5d38|\$primary|img-profile|skill-badge|brand/i.test(combined);
    if (task2Signals && !task3Signals) return "task2_analytics";
    if (task3Signals && !task2Signals) return "task3_branding";
    // Still ambiguous: first matched task wins (deterministic)
    return matches[0];
  }

  return "general";
}

export async function attributeEventsToTasks(
  attemptId: number
): Promise<Map<string, ValidationEvent[]>> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("validation_events")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("event_type", "tool_use")
    .order("timestamp", { ascending: true });

  if (error) throw new Error(`attributeEventsToTasks fetch failed: ${error.message}`);

  const events = (data ?? []) as ValidationEvent[];
  const grouped = new Map<string, ValidationEvent[]>();

  for (const event of events) {
    const taskId = attributeEvent(event);

    // Update task_id in DB
    const { error: updateError } = await supabase
      .from("validation_events")
      .update({ task_id: taskId })
      .eq("id", event.id);
    if (updateError) {
      console.warn(
        `attributeEventsToTasks: failed to update task_id for event ${event.id}: ${updateError.message}`
      );
    }

    if (!grouped.has(taskId)) grouped.set(taskId, []);
    grouped.get(taskId)!.push({ ...event, task_id: taskId });
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// Phase 4: Human-LLM convergence evaluation engine
// ---------------------------------------------------------------------------

/** Build a transcript excerpt suitable for inclusion in LLM prompts. */
function buildTranscript(
  events: ValidationEvent[],
  maxInputChars = 400,
  maxOutputChars = 200
): string {
  const lines: string[] = [];
  for (const event of events) {
    lines.push(
      `[${event.timestamp}] ${event.event_type}${event.tool_name ? ` / ${event.tool_name}` : ""}`
    );
    if (event.tool_input) {
      try {
        const parsed = JSON.parse(event.tool_input) as unknown;
        lines.push(`  Input: ${JSON.stringify(parsed, null, 2).substring(0, maxInputChars)}`);
      } catch {
        lines.push(`  Input: ${event.tool_input.substring(0, maxInputChars)}`);
      }
    }
    if (event.tool_output) {
      try {
        const parsed = JSON.parse(event.tool_output) as unknown;
        lines.push(`  Output: ${JSON.stringify(parsed, null, 2).substring(0, maxOutputChars)}`);
      } catch {
        lines.push(`  Output: ${event.tool_output.substring(0, maxOutputChars)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

const DIMENSION_DEFINITIONS: Record<string, string> = {
  delegation:
    "Did the candidate break work into well-scoped tasks and delegate them effectively to Claude Code? Did they avoid doing manually what Claude could do?",
  description:
    "Were their task descriptions clear, specific, and unambiguous? Did they provide the context Claude needed to succeed on the first attempt?",
  discernment:
    "Did the candidate critically evaluate Claude's suggestions before accepting them? Did they push back on incorrect solutions and verify outcomes?",
  diligence:
    "Did the candidate verify their work thoroughly? Did they run tests, check results, and ensure the final output met requirements?",
};

export function buildTaskFluencyPrompt(
  taskId: string,
  taskName: string,
  events: ValidationEvent[],
  generalEvents: ValidationEvent[] = []
): string {
  const lines: string[] = [];

  lines.push(`# Claude Code Activity Transcript — Task: ${taskName} (${taskId})`);
  lines.push("");

  if (generalEvents.length > 0) {
    lines.push("## General / Setup Events (context)");
    lines.push(buildTranscript(generalEvents));
  }

  lines.push(`## Task-Specific Events (${taskName})`);
  lines.push(buildTranscript(events));
  lines.push(`Total task events: ${events.length}`);
  lines.push("");

  lines.push(`
# Evaluation Task

You are evaluating a candidate's ability to work with Claude Code on the task: **${taskName}**.

Score the candidate on these four dimensions (the 4Ds), each on a scale of 0.0–5.0:

1. **Delegation** — ${DIMENSION_DEFINITIONS.delegation}

2. **Description** — ${DIMENSION_DEFINITIONS.description}

3. **Discernment** — ${DIMENSION_DEFINITIONS.discernment}

4. **Diligence** — ${DIMENSION_DEFINITIONS.diligence}

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

/** Parse LLM JSON response into FluencyResponse, stripping markdown fences if present. */
function parseFluencyJson(text: string): FluencyResponse | null {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const raw: unknown = JSON.parse(cleaned);
    const validated = FluencyResponseSchema.safeParse(raw);
    if (!validated.success) {
      console.error("parseFluencyJson: schema validation failed:", validated.error.issues);
      return null;
    }
    return validated.data;
  } catch (err) {
    console.error(
      "parseFluencyJson: JSON parse error:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

const TASK_IDS = ["task1_jquery", "task2_analytics", "task3_branding"] as const;
type KnownTaskId = (typeof TASK_IDS)[number];

const DIMENSIONS = ["delegation", "description", "discernment", "diligence"] as const;
type Dimension = (typeof DIMENSIONS)[number];

/**
 * Phase 4 main entry point.
 * Replaces evaluateFluency(). Scores all 3 tasks x 4 dimensions = 12 rows in task_evaluations.
 */
export async function evaluateFluencyPerTask(attemptId: number): Promise<void> {
  const supabase = getSupabase();

  // Idempotent: delete existing task_evaluations for this attempt
  // evaluation_dialogue rows reference task_evaluations via FK — delete dialogue first
  // to avoid FK constraint violations if ON DELETE CASCADE is not configured.
  const { data: existingEvals, error: existingEvalsError } = await supabase
    .from("task_evaluations")
    .select("id")
    .eq("attempt_id", attemptId);

  if (existingEvalsError) {
    throw new Error(
      `evaluateFluencyPerTask: existing evals fetch failed: ${existingEvalsError.message}`
    );
  }

  if (existingEvals && existingEvals.length > 0) {
    // Guard: do not wipe evaluations that have been reviewed by admin
    const { data: reviewedEvals } = await supabase
      .from("task_evaluations")
      .select("id")
      .eq("attempt_id", attemptId)
      .in("status", ["confirmed", "resolved", "admin_reviewed"]);

    if (reviewedEvals && reviewedEvals.length > 0) {
      console.warn(
        `evaluateFluencyPerTask: attempt ${attemptId} has ${reviewedEvals.length} reviewed evaluations, skipping re-evaluation`
      );
      return;
    }

    const evalIds = (existingEvals as { id: number }[]).map((r) => r.id);

    const { error: dialogueDeleteError } = await supabase
      .from("evaluation_dialogue")
      .delete()
      .in("task_evaluation_id", evalIds);
    if (dialogueDeleteError) {
      throw new Error(
        `evaluateFluencyPerTask: delete evaluation_dialogue failed: ${dialogueDeleteError.message}`
      );
    }

    const { error: evalDeleteError } = await supabase
      .from("task_evaluations")
      .delete()
      .eq("attempt_id", attemptId);
    if (evalDeleteError) {
      throw new Error(
        `evaluateFluencyPerTask: delete task_evaluations failed: ${evalDeleteError.message}`
      );
    }
  }

  if (process.env.USE_MOCK === "true") {
    const mockScores: Record<Dimension, number> = {
      delegation: 3.5,
      description: 4.0,
      discernment: 3.0,
      diligence: 4.5,
    };
    const mockJustifications: Record<Dimension, string> = {
      delegation:
        "The candidate broke the work into separate tasks but could have been more granular.",
      description:
        "Clear problem descriptions with specific file references and expected outcomes.",
      discernment:
        "Accepted most suggestions without questioning alternatives. Some evidence of critical evaluation.",
      diligence:
        "Consistently verified changes by running the test suite and checking results.",
    };

    for (const taskId of TASK_IDS) {
      for (const dimension of DIMENSIONS) {
        const score = mockScores[dimension];
        const justification = mockJustifications[dimension];

        const { data: evalRow, error: evalInsertError } = await supabase
          .from("task_evaluations")
          .insert({
            attempt_id: attemptId,
            task_id: taskId,
            dimension,
            llm_score: score,
            llm_justification: justification,
            status: "llm_scored",
            final_score: score,
          })
          .select("id")
          .single();

        if (evalInsertError) {
          throw new Error(
            `evaluateFluencyPerTask mock insert task_evaluations failed (${taskId}/${dimension}): ${evalInsertError.message}`
          );
        }

        const taskEvalId = (evalRow as { id: number }).id;

        const { error: dialogueInsertError } = await supabase
          .from("evaluation_dialogue")
          .insert({
            task_evaluation_id: taskEvalId,
            round: 1,
            actor: "llm",
            score,
            reasoning: justification,
            score_changed: false,
          });

        if (dialogueInsertError) {
          throw new Error(
            `evaluateFluencyPerTask mock insert evaluation_dialogue failed (${taskId}/${dimension}): ${dialogueInsertError.message}`
          );
        }
      }
    }
    return;
  }

  // Real mode: attribute events to tasks, build 3 prompts, fire in parallel
  const grouped = await attributeEventsToTasks(attemptId);
  const generalEvents = grouped.get("general") ?? [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build and fire all 3 LLM calls in parallel
  const taskPromises = TASK_IDS.map(
    async (taskId): Promise<[KnownTaskId, FluencyResponse | null]> => {
      const taskName = TASK_NAMES[taskId];
      const taskEvents = grouped.get(taskId) ?? [];

      if (taskEvents.length === 0 && generalEvents.length === 0) {
        console.warn(
          `evaluateFluencyPerTask: no events for ${taskId} (attempt ${attemptId}), skipping LLM call`
        );
        return [taskId, null];
      }

      const promptText = buildTaskFluencyPrompt(taskId, taskName, taskEvents, generalEvents);

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: promptText }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const parsed = parseFluencyJson(text);
      if (!parsed) {
        console.error(
          `evaluateFluencyPerTask: failed to parse LLM response for ${taskId} (attempt ${attemptId})`
        );
      }
      return [taskId, parsed];
    }
  );

  const results = await Promise.all(taskPromises);

  // Insert 12 rows into task_evaluations + 12 rows into evaluation_dialogue
  for (const [taskId, fluency] of results) {
    for (const dimension of DIMENSIONS) {
      const score = fluency ? fluency[dimension].score : null;
      const justification = fluency ? fluency[dimension].justification : null;
      const status: string = fluency ? "llm_scored" : "pending";

      const { data: evalRow, error: evalInsertError } = await supabase
        .from("task_evaluations")
        .insert({
          attempt_id: attemptId,
          task_id: taskId,
          dimension,
          llm_score: score,
          llm_justification: justification,
          status,
          final_score: score,
        })
        .select("id")
        .single();

      if (evalInsertError) {
        throw new Error(
          `evaluateFluencyPerTask insert task_evaluations failed (${taskId}/${dimension}): ${evalInsertError.message}`
        );
      }

      const taskEvalId = (evalRow as { id: number }).id;

      if (fluency && score !== null && justification !== null) {
        const { error: dialogueInsertError } = await supabase
          .from("evaluation_dialogue")
          .insert({
            task_evaluation_id: taskEvalId,
            round: 1,
            actor: "llm",
            score,
            reasoning: justification,
            score_changed: false,
          });

        if (dialogueInsertError) {
          throw new Error(
            `evaluateFluencyPerTask insert evaluation_dialogue failed (${taskId}/${dimension}): ${dialogueInsertError.message}`
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Re-evaluation prompt builder
// ---------------------------------------------------------------------------

interface DialogueEntry {
  round: number;
  actor: string;
  score: number;
  reasoning: string;
}

export function buildReEvaluationPrompt(
  taskId: string,
  taskName: string,
  dimension: string,
  events: ValidationEvent[],
  dialogueHistory: DialogueEntry[]
): string {
  const lines: string[] = [];

  lines.push(`# Re-Evaluation Request — Task: ${taskName} (${taskId})`);
  lines.push(`## Dimension: ${dimension}`);
  lines.push("");
  lines.push(`**Definition:** ${DIMENSION_DEFINITIONS[dimension] ?? dimension}`);
  lines.push("");

  lines.push("## Task Activity Transcript");
  lines.push(buildTranscript(events));
  lines.push("");

  lines.push("## Dialogue History");
  for (const entry of dialogueHistory) {
    lines.push(`### Round ${entry.round} — ${entry.actor.toUpperCase()}`);
    lines.push(`Score: ${entry.score}`);
    lines.push(`Reasoning: ${entry.reasoning}`);
    lines.push("");
  }

  lines.push(`
# Re-Evaluation Instructions

The human reviewer has provided additional context above (see admin entries in the dialogue history).
Consider the reviewer's observations and re-score the **${dimension}** dimension for this task.

Your score may stay the same or change based on the reviewer's context.

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "score": 0.0,
  "reasoning": "...",
  "score_changed": true
}
`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Zod schema for re-evaluation response
// ---------------------------------------------------------------------------

const ReEvaluationResponseSchema = z.object({
  score: z.number().min(0).max(5),
  reasoning: z.string(),
  score_changed: z.boolean(),
});

// ---------------------------------------------------------------------------
// requestLlmReEvaluation
// ---------------------------------------------------------------------------

export async function requestLlmReEvaluation(taskEvaluationId: number): Promise<void> {
  const supabase = getSupabase();

  // Fetch the task_evaluation row
  const { data: evalData, error: evalError } = await supabase
    .from("task_evaluations")
    .select("id, attempt_id, task_id, dimension, llm_score")
    .eq("id", taskEvaluationId)
    .single();

  if (evalError || !evalData) {
    throw new Error(`requestLlmReEvaluation: task_evaluation ${taskEvaluationId} not found`);
  }

  const evalRow = evalData as {
    id: number;
    attempt_id: number;
    task_id: string;
    dimension: string;
    llm_score: number | null;
  };

  // Fetch dialogue history
  const { data: dialogueData, error: dialogueError } = await supabase
    .from("evaluation_dialogue")
    .select("round, actor, score, reasoning")
    .eq("task_evaluation_id", taskEvaluationId)
    .order("round", { ascending: true });

  if (dialogueError) {
    throw new Error(
      `requestLlmReEvaluation: dialogue fetch failed: ${dialogueError.message}`
    );
  }

  const dialogueHistory = (dialogueData ?? []) as DialogueEntry[];
  const nextRound =
    dialogueHistory.length > 0
      ? Math.max(...dialogueHistory.map((d) => d.round)) + 1
      : 2;

  // Fetch the task's validation_events
  const { data: eventsData, error: eventsError } = await supabase
    .from("validation_events")
    .select("*")
    .eq("attempt_id", evalRow.attempt_id)
    .eq("task_id", evalRow.task_id)
    .order("timestamp", { ascending: true });

  if (eventsError) {
    throw new Error(`requestLlmReEvaluation: events fetch failed: ${eventsError.message}`);
  }

  const events = (eventsData ?? []) as ValidationEvent[];
  const taskName = TASK_NAMES[evalRow.task_id] ?? evalRow.task_id;

  // Build prompt and call LLM
  const promptText = buildReEvaluationPrompt(
    evalRow.task_id,
    taskName,
    evalRow.dimension,
    events,
    dialogueHistory
  );

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: promptText }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  let parsed: z.infer<typeof ReEvaluationResponseSchema>;
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const raw: unknown = JSON.parse(cleaned);
    const validated = ReEvaluationResponseSchema.safeParse(raw);
    if (!validated.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(validated.error.issues)}`);
    }
    parsed = validated.data;
  } catch (err) {
    throw new Error(
      `requestLlmReEvaluation: failed to parse LLM response for task_evaluation ${taskEvaluationId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Insert new dialogue row
  const { error: dialogueInsertError } = await supabase
    .from("evaluation_dialogue")
    .insert({
      task_evaluation_id: taskEvaluationId,
      round: nextRound,
      actor: "llm",
      score: parsed.score,
      reasoning: parsed.reasoning,
      score_changed: parsed.score_changed,
    });

  if (dialogueInsertError) {
    throw new Error(
      `requestLlmReEvaluation: dialogue insert failed: ${dialogueInsertError.message}`
    );
  }

  // Update task_evaluation: status='resolved', final_score=LLM's new score
  const { error: updateError } = await supabase
    .from("task_evaluations")
    .update({
      status: "resolved",
      final_score: parsed.score,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskEvaluationId);

  if (updateError) {
    throw new Error(
      `requestLlmReEvaluation: task_evaluation update failed: ${updateError.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// submitAdminTaskReview
// ---------------------------------------------------------------------------

export async function submitAdminTaskReview(
  taskEvaluationId: number,
  action: "confirm" | "provide_context",
  comment: string,
  reviewerId: number
): Promise<void> {
  const supabase = getSupabase();

  // Fetch the task_evaluation to get llm_score
  const { data: evalData, error: evalError } = await supabase
    .from("task_evaluations")
    .select("id, llm_score")
    .eq("id", taskEvaluationId)
    .single();

  if (evalError || !evalData) {
    throw new Error(
      `submitAdminTaskReview: task_evaluation ${taskEvaluationId} not found`
    );
  }

  const evalRow = evalData as { id: number; llm_score: number | null };
  const llmScore = evalRow.llm_score ?? 0;

  // reviewer context available via comment; reviewerId reserved for future schema extension
  void reviewerId;

  // Fetch current dialogue to determine next round number
  const { data: dialogueData, error: dialogueError } = await supabase
    .from("evaluation_dialogue")
    .select("round")
    .eq("task_evaluation_id", taskEvaluationId)
    .order("round", { ascending: false })
    .limit(1);

  if (dialogueError) {
    throw new Error(`submitAdminTaskReview: dialogue fetch failed: ${dialogueError.message}`);
  }

  const latestRound =
    dialogueData && dialogueData.length > 0
      ? (dialogueData[0] as { round: number }).round
      : 0;
  const nextRound = latestRound + 1;

  if (action === "confirm") {
    const { error: updateError } = await supabase
      .from("task_evaluations")
      .update({
        status: "confirmed",
        final_score: llmScore,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskEvaluationId);

    if (updateError) {
      throw new Error(`submitAdminTaskReview: confirm update failed: ${updateError.message}`);
    }

    const { error: dialogueInsertError } = await supabase
      .from("evaluation_dialogue")
      .insert({
        task_evaluation_id: taskEvaluationId,
        round: nextRound,
        actor: "admin",
        score: llmScore,
        reasoning: comment || "Confirmed LLM assessment",
        score_changed: false,
      });

    if (dialogueInsertError) {
      throw new Error(
        `submitAdminTaskReview: confirm dialogue insert failed: ${dialogueInsertError.message}`
      );
    }
  } else {
    // provide_context: update status, insert admin dialogue, then trigger LLM re-evaluation
    const { error: updateError } = await supabase
      .from("task_evaluations")
      .update({
        status: "admin_reviewed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskEvaluationId);

    if (updateError) {
      throw new Error(
        `submitAdminTaskReview: provide_context update failed: ${updateError.message}`
      );
    }

    const { error: dialogueInsertError } = await supabase
      .from("evaluation_dialogue")
      .insert({
        task_evaluation_id: taskEvaluationId,
        round: nextRound,
        actor: "admin",
        score: llmScore,
        reasoning: comment,
        score_changed: false,
      });

    if (dialogueInsertError) {
      throw new Error(
        `submitAdminTaskReview: provide_context dialogue insert failed: ${dialogueInsertError.message}`
      );
    }

    await requestLlmReEvaluation(taskEvaluationId);
  }
}

// ---------------------------------------------------------------------------
// checkAndFinalizeAttempt
// ---------------------------------------------------------------------------

interface PendingItem {
  taskId: string;
  dimension: string;
  status: string;
}

interface FinalizeResult {
  canFinalize: boolean;
  result?: "pass" | "fail";
  scores: Record<string, number>;
  pendingItems: PendingItem[];
}

export async function checkAndFinalizeAttempt(attemptId: number): Promise<FinalizeResult> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("task_evaluations")
    .select("task_id, dimension, status, final_score")
    .eq("attempt_id", attemptId);

  if (error) throw new Error(`checkAndFinalizeAttempt: fetch failed: ${error.message}`);

  const rows = (data ?? []) as {
    task_id: string;
    dimension: string;
    status: string;
    final_score: number | null;
  }[];

  // Identify items that are not yet resolved
  const pendingItems: PendingItem[] = rows
    .filter((r) => r.status !== "confirmed" && r.status !== "resolved")
    .map((r) => ({ taskId: r.task_id, dimension: r.dimension, status: r.status }));

  if (pendingItems.length > 0) {
    return { canFinalize: false, scores: {}, pendingItems };
  }

  // Compute per-dimension average across all tasks
  const dimensionTotals: Record<string, number[]> = {
    delegation: [],
    description: [],
    discernment: [],
    diligence: [],
  };

  for (const row of rows) {
    if (row.final_score !== null && row.dimension in dimensionTotals) {
      dimensionTotals[row.dimension].push(row.final_score);
    }
  }

  const scores: Record<string, number> = {};
  for (const [dim, values] of Object.entries(dimensionTotals)) {
    scores[dim] =
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  // Pass criteria: all 4 dimension averages >= 3.0 AND no individual final_score < 2.0
  const allAveragesPass = Object.values(scores).every((s) => s >= 3.0);
  const noLowScore = rows.every((r) => r.final_score === null || r.final_score >= 2.0);
  const passed = allAveragesPass && noLowScore;
  const result: "pass" | "fail" = passed ? "pass" : "fail";

  // Persist the result on the attempt
  const { error: updateError } = await supabase
    .from("attempts")
    .update({ human_reviewed: 1, final_result: result })
    .eq("id", attemptId);

  if (updateError) {
    throw new Error(
      `checkAndFinalizeAttempt: attempt update failed: ${updateError.message}`
    );
  }

  return { canFinalize: true, result, scores, pendingItems: [] };
}

// ---------------------------------------------------------------------------
// Legacy fluency evaluation (deprecated — use evaluateFluencyPerTask instead)
// ---------------------------------------------------------------------------

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

/**
 * @deprecated Use evaluateFluencyPerTask() instead. Kept for backwards compatibility.
 */
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
    if (insertError)
      throw new Error(`evaluateFluency mock insert failed: ${insertError.message}`);
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

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Parse and validate the JSON response
  let parsed: unknown;
  try {
    // Strip any markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
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
    await evaluateFluencyPerTask(attemptId);
  } catch (err) {
    console.error(
      `runFullEvaluation: evaluateFluencyPerTask failed for attempt ${attemptId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  await updateAttemptStatus(attemptId, "evaluated");
}
