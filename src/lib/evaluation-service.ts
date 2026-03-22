import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getDb } from "./db";
import { getEnvironmentByAttempt } from "./environment-service";
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
  const db = getDb();

  // Idempotent: clear previous results before writing new ones
  db.prepare("DELETE FROM lab_results WHERE attempt_id = ?").run(attemptId);

  if (process.env.USE_MOCK === "true") {
    const mockTasks = [
      {
        taskId: "task1_jquery",
        passed: 1,
        details: { checks: ["jquery_version", "vendor_updated"], allPassed: true },
      },
      {
        taskId: "task2_analytics",
        passed: 1,
        details: { checks: ["no_ua_tag"], allPassed: true },
      },
      {
        taskId: "task3_branding",
        passed: 1,
        details: {
          checks: ["global_scss", "overrides_scss", "img_profile", "skill_badge"],
          allPassed: true,
        },
      },
    ];
    const insert = db.prepare(
      "INSERT INTO lab_results (attempt_id, task_id, passed, details_json) VALUES (?, ?, ?, ?)"
    );
    for (const task of mockTasks) {
      insert.run(attemptId, task.taskId, task.passed, JSON.stringify(task.details));
    }
    return;
  }

  // Real mode: SSH into the Codespace and run the validator
  const env = getEnvironmentByAttempt(attemptId);
  if (!env || !env.codespace_name) {
    console.warn(
      `evaluateLabResults: no active codespace for attempt ${attemptId}, skipping lab check`
    );
    return;
  }

  const codespaceName = env.codespace_name;

  let stdout: string;
  try {
    stdout = execSync(
      `gh codespace ssh -c ${codespaceName} -- "cd /workspaces/exam-template-alex-rivera && node tests/validate.js"`,
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          GH_TOKEN: process.env.GITHUB_PAT ?? "",
        },
        timeout: 60_000,
      }
    );
  } catch (err) {
    console.warn(
      `evaluateLabResults: gh codespace ssh failed for attempt ${attemptId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  // Parse stdout: lines starting with ✓ (pass) or ✗ (fail)
  // Collect per-task results
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
  const insert = db.prepare(
    "INSERT INTO lab_results (attempt_id, task_id, passed, details_json) VALUES (?, ?, ?, ?)"
  );
  for (const [taskId, { passed, failed }] of Object.entries(taskChecks)) {
    const allPassed = failed.length === 0 && passed.length > 0;
    const details = { passed, failed, allPassed };
    insert.run(attemptId, taskId, allPassed ? 1 : 0, JSON.stringify(details));
  }
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
  const db = getDb();

  // Idempotent: clear previous score before writing new one
  db.prepare("DELETE FROM fluency_scores WHERE attempt_id = ?").run(attemptId);

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
    db.prepare(
      "INSERT INTO fluency_scores (attempt_id, delegation, description, discernment, diligence, raw_analysis) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      attemptId,
      mockResult.delegation.score,
      mockResult.description.score,
      mockResult.discernment.score,
      mockResult.diligence.score,
      JSON.stringify(mockResult)
    );
    return;
  }

  // Real mode: build transcript from validation_events, call Anthropic API
  const events = db
    .prepare("SELECT * FROM validation_events WHERE attempt_id = ? ORDER BY timestamp")
    .all(attemptId) as ValidationEvent[];

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
  db.prepare(
    "INSERT INTO fluency_scores (attempt_id, delegation, description, discernment, diligence, raw_analysis) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    attemptId,
    result.delegation.score,
    result.description.score,
    result.discernment.score,
    result.diligence.score,
    JSON.stringify(result)
  );
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

  updateAttemptStatus(attemptId, "evaluated");
}
