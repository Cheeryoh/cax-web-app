import { describe, it, expect, beforeAll } from "vitest";
import {
  generateSessionToken,
  createSession,
  getSession,
  destroySession,
  seedDemoData,
} from "./auth-service";

// Sessions are now Supabase-backed. These tests require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
const SUPABASE_AVAILABLE = !!(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

beforeAll(async () => {
  if (!SUPABASE_AVAILABLE) return;
  await seedDemoData(); // Seed a candidate we can reference
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
  it.skipIf(!SUPABASE_AVAILABLE)("creates a session and retrieves it", async () => {
    // Use candidate ID 1 (seeded demo candidate)
    const token = await createSession(1);
    const session = await getSession(token);
    expect(session).not.toBeNull();
    expect(session).toEqual({ candidateId: 1 });
  });
});

describe("destroySession", () => {
  it.skipIf(!SUPABASE_AVAILABLE)("destroys a session so it cannot be retrieved", async () => {
    const token = await createSession(1);
    expect(await getSession(token)).not.toBeNull();
    await destroySession(token);
    expect(await getSession(token)).toBeNull();
  });
});

describe("getSession with unknown token", () => {
  it.skipIf(!SUPABASE_AVAILABLE)("returns null for nonexistent token", async () => {
    expect(await getSession("nonexistent")).toBeNull();
  });
});
