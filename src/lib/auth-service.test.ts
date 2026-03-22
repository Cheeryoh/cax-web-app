import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generateSessionToken,
  createSession,
  getSession,
  destroySession,
  seedDemoData,
} from "./auth-service";
import { getDb, closeDb } from "./db";

// Sessions are now SQLite-backed, so we need a real DB
beforeAll(async () => {
  getDb(); // Initialize DB + schema
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
  it("creates a session and retrieves it", () => {
    // Use candidate ID 1 (seeded demo candidate)
    const token = createSession(1);
    const session = getSession(token);
    expect(session).not.toBeNull();
    expect(session).toEqual({ candidateId: 1 });
  });
});

describe("destroySession", () => {
  it("destroys a session so it cannot be retrieved", () => {
    const token = createSession(1);
    expect(getSession(token)).not.toBeNull();
    destroySession(token);
    expect(getSession(token)).toBeNull();
  });
});

describe("getSession with unknown token", () => {
  it("returns null for nonexistent token", () => {
    expect(getSession("nonexistent")).toBeNull();
  });
});
