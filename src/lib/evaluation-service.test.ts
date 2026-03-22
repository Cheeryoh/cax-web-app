/**
 * Unit tests for evaluation-service.ts
 *
 * These tests cover pure-logic functions only — no network calls, no Supabase.
 * DB-touching functions (evaluateFluencyPerTask, etc.) require integration
 * infrastructure and are tested via E2E.
 */
import { describe, it, expect } from "vitest";
import {
  buildFluencyPrompt,
  buildTaskFluencyPrompt,
  buildReEvaluationPrompt,
} from "./evaluation-service";

// ---------------------------------------------------------------------------
// Minimal ValidationEvent fixture
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<{
    id: number;
    attempt_id: number;
    event_type: string;
    tool_name: string | null;
    tool_input: string | null;
    tool_output: string | null;
    task_id: string | null;
    timestamp: string;
    raw_json: string;
  }> = {}
) {
  return {
    id: 1,
    attempt_id: 42,
    event_type: "tool_use",
    tool_name: "read_file",
    tool_input: JSON.stringify({ path: "vendor/jquery.js" }),
    tool_output: JSON.stringify({ content: "/* jquery */" }),
    task_id: "task1_jquery",
    timestamp: "2026-03-22T10:00:00Z",
    raw_json: "{}",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildFluencyPrompt (legacy)
// ---------------------------------------------------------------------------

describe("buildFluencyPrompt", () => {
  it("returns a non-empty string", () => {
    const events = [makeEvent()];
    const prompt = buildFluencyPrompt(events);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes the 4D dimension names", () => {
    const prompt = buildFluencyPrompt([makeEvent()]);
    expect(prompt).toContain("Delegation");
    expect(prompt).toContain("Description");
    expect(prompt).toContain("Discernment");
    expect(prompt).toContain("Diligence");
  });

  it("includes the event timestamp", () => {
    const event = makeEvent({ timestamp: "2026-03-22T10:00:00Z" });
    const prompt = buildFluencyPrompt([event]);
    expect(prompt).toContain("2026-03-22T10:00:00Z");
  });

  it("includes the total event count", () => {
    const events = [makeEvent(), makeEvent({ id: 2 }), makeEvent({ id: 3 })];
    const prompt = buildFluencyPrompt(events);
    expect(prompt).toContain("Total events: 3");
  });

  it("requests JSON output with all four dimensions", () => {
    const prompt = buildFluencyPrompt([makeEvent()]);
    expect(prompt).toContain('"delegation"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"discernment"');
    expect(prompt).toContain('"diligence"');
  });

  it("handles events with null tool_input and tool_output gracefully", () => {
    const event = makeEvent({ tool_input: null, tool_output: null });
    expect(() => buildFluencyPrompt([event])).not.toThrow();
  });

  it("truncates very long tool_input", () => {
    const longInput = JSON.stringify({ path: "x".repeat(2000) });
    const event = makeEvent({ tool_input: longInput });
    const prompt = buildFluencyPrompt([event]);
    // Input truncated at 500 chars — the prompt should not contain the full 2000-char string
    const fullPath = "x".repeat(2000);
    expect(prompt).not.toContain(fullPath);
  });
});

// ---------------------------------------------------------------------------
// buildTaskFluencyPrompt (Phase 3/4)
// ---------------------------------------------------------------------------

describe("buildTaskFluencyPrompt", () => {
  const taskId = "task1_jquery";
  const taskName = "jQuery Vulnerability Fix";

  it("returns a non-empty string", () => {
    const prompt = buildTaskFluencyPrompt(taskId, taskName, [makeEvent()]);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes task name and id in the heading", () => {
    const prompt = buildTaskFluencyPrompt(taskId, taskName, [makeEvent()]);
    expect(prompt).toContain(taskName);
    expect(prompt).toContain(taskId);
  });

  it("includes all 4 dimension names", () => {
    const prompt = buildTaskFluencyPrompt(taskId, taskName, [makeEvent()]);
    expect(prompt).toContain("Delegation");
    expect(prompt).toContain("Description");
    expect(prompt).toContain("Discernment");
    expect(prompt).toContain("Diligence");
  });

  it("includes task event count", () => {
    const events = [makeEvent(), makeEvent({ id: 2 })];
    const prompt = buildTaskFluencyPrompt(taskId, taskName, events);
    expect(prompt).toContain("Total task events: 2");
  });

  it("includes general events as context section when provided", () => {
    const generalEvent = makeEvent({ id: 99, task_id: "general", tool_name: "bash" });
    const prompt = buildTaskFluencyPrompt(taskId, taskName, [makeEvent()], [generalEvent]);
    expect(prompt).toContain("General / Setup Events");
  });

  it("omits general context section when generalEvents is empty", () => {
    const prompt = buildTaskFluencyPrompt(taskId, taskName, [makeEvent()], []);
    expect(prompt).not.toContain("General / Setup Events");
  });

  it("requests JSON output with all four dimensions", () => {
    const prompt = buildTaskFluencyPrompt(taskId, taskName, [makeEvent()]);
    expect(prompt).toContain('"delegation"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"discernment"');
    expect(prompt).toContain('"diligence"');
  });

  it("handles empty events array without throwing", () => {
    expect(() => buildTaskFluencyPrompt(taskId, taskName, [])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildReEvaluationPrompt (Phase 4)
// ---------------------------------------------------------------------------

describe("buildReEvaluationPrompt", () => {
  const taskId = "task2_analytics";
  const taskName = "Dead Analytics Removal";
  const dimension = "diligence";

  const dialogueHistory = [
    { round: 1, actor: "llm", score: 3.5, reasoning: "Candidate ran tests once." },
    {
      round: 2,
      actor: "admin",
      score: 3.5,
      reasoning: "Candidate actually ran tests three times, not once.",
    },
  ];

  it("returns a non-empty string", () => {
    const prompt = buildReEvaluationPrompt(
      taskId,
      taskName,
      dimension,
      [makeEvent()],
      dialogueHistory
    );
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes task name, id, and dimension", () => {
    const prompt = buildReEvaluationPrompt(
      taskId,
      taskName,
      dimension,
      [makeEvent()],
      dialogueHistory
    );
    expect(prompt).toContain(taskName);
    expect(prompt).toContain(taskId);
    expect(prompt).toContain(dimension);
  });

  it("includes all dialogue history entries", () => {
    const prompt = buildReEvaluationPrompt(
      taskId,
      taskName,
      dimension,
      [makeEvent()],
      dialogueHistory
    );
    expect(prompt).toContain("Round 1");
    expect(prompt).toContain("Round 2");
    expect(prompt).toContain("LLM");
    expect(prompt).toContain("ADMIN");
    expect(prompt).toContain("Candidate ran tests once.");
    expect(prompt).toContain("Candidate actually ran tests three times");
  });

  it("instructs LLM to respond with score, reasoning, score_changed JSON", () => {
    const prompt = buildReEvaluationPrompt(
      taskId,
      taskName,
      dimension,
      [makeEvent()],
      dialogueHistory
    );
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"reasoning"');
    expect(prompt).toContain('"score_changed"');
  });

  it("includes dimension definition", () => {
    const prompt = buildReEvaluationPrompt(
      taskId,
      taskName,
      "delegation",
      [makeEvent()],
      dialogueHistory
    );
    // Dimension definitions are embedded in DIMENSION_DEFINITIONS
    expect(prompt).toContain("Definition:");
  });

  it("handles empty dialogue history without throwing", () => {
    expect(() =>
      buildReEvaluationPrompt(taskId, taskName, dimension, [makeEvent()], [])
    ).not.toThrow();
  });

  it("handles empty events array without throwing", () => {
    expect(() =>
      buildReEvaluationPrompt(taskId, taskName, dimension, [], dialogueHistory)
    ).not.toThrow();
  });
});
