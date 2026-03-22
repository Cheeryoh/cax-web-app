import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createEnvironment,
  getEnvironmentByAttempt,
  getEnvironmentByCodespaceName,
  pollEnvironmentStatus,
  destroyEnvironment,
} from "./environment-service";
import { createAttempt } from "./exam-service";
import { seedDemoData } from "./auth-service";
import { closeDb } from "./db";

// Force mock mode for all tests in this file
const ORIGINAL_USE_MOCK = process.env.USE_MOCK;

// These tests require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY environment variables.
beforeAll(async () => {
  process.env.USE_MOCK = "true";
  await seedDemoData(); // Seed candidate ID 1
});

afterAll(() => {
  process.env.USE_MOCK = ORIGINAL_USE_MOCK;
  closeDb();
});

describe("createEnvironment (mock mode)", () => {
  it("returns environment with status 'ready' and a mock codespace name", async () => {
    // Create an attempt first — environments.attempt_id is a FK to attempts
    const attempt = await createAttempt(1);
    const env = await createEnvironment(attempt.id);

    expect(env.status).toBe("ready");
    expect(env.codespace_name).toBeTruthy();
    expect(env.codespace_name).toMatch(/^mock-cs-/);
    expect(env.attempt_id).toBe(attempt.id);
  });
});

describe("getEnvironmentByAttempt", () => {
  it("returns the environment created for a given attempt", async () => {
    const attempt = await createAttempt(1);
    const created = await createEnvironment(attempt.id);

    const fetched = await getEnvironmentByAttempt(attempt.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.attempt_id).toBe(attempt.id);
  });
});

describe("getEnvironmentByCodespaceName", () => {
  it("returns the environment by its codespace name", async () => {
    const attempt = await createAttempt(1);
    const created = await createEnvironment(attempt.id);

    const fetched = await getEnvironmentByCodespaceName(created.codespace_name!);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.codespace_name).toBe(created.codespace_name);
  });

  it("returns null for an unknown codespace name", async () => {
    const result = await getEnvironmentByCodespaceName("nonexistent-codespace-xyz");
    expect(result).toBeNull();
  });
});

describe("pollEnvironmentStatus (mock mode)", () => {
  it("returns environment with status 'ready' (mock mode skips real poll)", async () => {
    const attempt = await createAttempt(1);
    const created = await createEnvironment(attempt.id);

    const polled = await pollEnvironmentStatus(created.id);
    expect(polled.status).toBe("ready");
    expect(polled.id).toBe(created.id);
  });

  it("throws for a nonexistent environment ID", async () => {
    await expect(pollEnvironmentStatus(999999)).rejects.toThrow(
      "Environment 999999 not found"
    );
  });
});

describe("destroyEnvironment (mock mode)", () => {
  it("sets status to 'deleted' and records destroyed_at", async () => {
    const attempt = await createAttempt(1);
    const created = await createEnvironment(attempt.id);
    expect(created.status).toBe("ready");

    await destroyEnvironment(created.id);

    const after = await getEnvironmentByAttempt(attempt.id);
    expect(after).not.toBeNull();
    expect(after!.status).toBe("deleted");
    expect(after!.destroyed_at).not.toBeNull();
  });

  it("throws for a nonexistent environment ID", async () => {
    await expect(destroyEnvironment(999999)).rejects.toThrow(
      "Environment 999999 not found"
    );
  });
});
