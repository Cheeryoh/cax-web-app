import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generateSessionToken,
  createSession,
  getSession,
  destroySession,
  seedDemoData,
} from "./auth-service";
import { closeDb } from "./db";

// Sessions are now Supabase-backed. These tests require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
beforeAll(async () => {
  await seedDemoData(); // Seed a candidate we can reference
});

afterAll(() => {
  closeDb();
});

describe("generateSessionToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateSessionToken();
    expect(typeof token).toBe("string");
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createSession / getSession", () => {
  it("creates a session and retrieves it", async () => {
    // Use candidate ID 1 (seeded demo candidate)
    const token = await createSession(1);
    const session = await getSession(token);
    expect(session).not.toBeNull();
    expect(session).toEqual({ candidateId: 1 });
  });
});

describe("destroySession", () => {
  it("destroys a session so it cannot be retrieved", async () => {
    const token = await createSession(1);
    expect(await getSession(token)).not.toBeNull();
    await destroySession(token);
    expect(await getSession(token)).toBeNull();
  });
});

describe("getSession with unknown token", () => {
  it("returns null for nonexistent token", async () => {
    expect(await getSession("nonexistent")).toBeNull();
  });
});
