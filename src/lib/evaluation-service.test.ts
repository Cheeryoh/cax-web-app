import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  evaluateLabResults,
  evaluateFluency,
  runFullEvaluation,
} from "./evaluation-service";
import {
  createAttempt,
  updateAttemptStatus,
  getLabResults,
  getFluencyScore,
  getAttempt,
} from "./exam-service";
import { seedDemoData } from "./auth-service";
import { getDb, closeDb } from "./db";

// Preserve original env value so afterAll can restore it
const ORIGINAL_USE_MOCK = process.env.USE_MOCK;

let attemptId: number;

beforeAll(async () => {
  process.env.USE_MOCK = "true";
  getDb(); // Initialize DB + schema
  await seedDemoData(); // Ensure candidate ID 1 exists

  // Create a fresh attempt for the evaluation tests and move it to 'submitted'
  const attempt = createAttempt(1);
  attemptId = attempt.id;
  updateAttemptStatus(attemptId, "submitted");
});

afterAll(() => {
  process.env.USE_MOCK = ORIGINAL_USE_MOCK;
  closeDb();
});

// ---------------------------------------------------------------------------
// evaluateLabResults
// ---------------------------------------------------------------------------

describe("evaluateLabResults (mock mode)", () => {
  it("inserts 3 lab_results rows for the attempt", async () => {
    await evaluateLabResults(attemptId);

    const results = getLabResults(attemptId);
    expect(results).toHaveLength(3);
  });

  it("each row has passed === 1", async () => {
    // evaluateLabResults is idempotent — calling again gives same results
    const results = getLabResults(attemptId);
    for (const row of results) {
      expect(row.passed).toBe(1);
    }
  });

  it("task IDs include task1_jquery, task2_analytics, task3_branding", async () => {
    const results = getLabResults(attemptId);
    const taskIds = results.map((r) => r.task_id);
    expect(taskIds).toContain("task1_jquery");
    expect(taskIds).toContain("task2_analytics");
    expect(taskIds).toContain("task3_branding");
  });
});

// ---------------------------------------------------------------------------
// evaluateFluency
// ---------------------------------------------------------------------------

describe("evaluateFluency (mock mode)", () => {
  it("inserts a fluency_scores row for the attempt", async () => {
    await evaluateFluency(attemptId);

    const score = getFluencyScore(attemptId);
    expect(score).not.toBeNull();
  });

  it("all four dimensions have scores between 1 and 5", async () => {
    const score = getFluencyScore(attemptId);
    expect(score).not.toBeNull();

    const { delegation, description, discernment, diligence } = score!;
    for (const value of [delegation, description, discernment, diligence]) {
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThanOrEqual(1);
      expect(value!).toBeLessThanOrEqual(5);
    }
  });

  it("raw_analysis is valid JSON", async () => {
    const score = getFluencyScore(attemptId);
    expect(score).not.toBeNull();
    expect(score!.raw_analysis).not.toBeNull();

    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(score!.raw_analysis!);
    }).not.toThrow();
    expect(typeof parsed).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// runFullEvaluation
// ---------------------------------------------------------------------------

describe("runFullEvaluation (mock mode)", () => {
  // Use a separate attempt so these assertions are not muddied by the
  // evaluateLabResults / evaluateFluency tests above.
  let fullAttemptId: number;

  beforeAll(async () => {
    const attempt = createAttempt(1);
    fullAttemptId = attempt.id;
    updateAttemptStatus(fullAttemptId, "submitted");
  });

  it("sets attempt status to 'evaluated'", async () => {
    await runFullEvaluation(fullAttemptId);

    const attempt = getAttempt(fullAttemptId);
    expect(attempt).not.toBeNull();
    expect(attempt!.status).toBe("evaluated");
  });

  it("produces 3 lab_results rows", async () => {
    const results = getLabResults(fullAttemptId);
    expect(results).toHaveLength(3);
  });

  it("produces 1 fluency_scores row", async () => {
    const score = getFluencyScore(fullAttemptId);
    expect(score).not.toBeNull();
  });

  it("is idempotent — running twice yields 3 lab_results rows and 1 fluency_scores row", async () => {
    // Second call
    await runFullEvaluation(fullAttemptId);

    const results = getLabResults(fullAttemptId);
    expect(results).toHaveLength(3);

    const score = getFluencyScore(fullAttemptId);
    expect(score).not.toBeNull();
  });
});
