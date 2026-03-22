/**
 * Validation events API tests — exercises POST /api/validation/events
 * using Playwright's `request` fixture (no browser, no UI).
 *
 * Auth for the validation endpoint uses the X-Codespace-Name header,
 * NOT session cookies.  However, we still need a valid codespace name
 * recorded in the DB, so we first create a candidate session and start
 * an exam attempt (which provisions a mock Codespace in USE_MOCK mode).
 *
 * These tests run in the `desktop` project (no storageState dependency).
 */

import { test, expect } from "@playwright/test";
import { CANDIDATE } from "./helpers/credentials";

// ---------------------------------------------------------------------------
// Helper: login via API and return the session cookie string
// ---------------------------------------------------------------------------

async function loginAndGetCookie(
  request: Parameters<Parameters<typeof test>[1]>[0]["request"]
): Promise<string> {
  const res = await request.post("/api/auth", {
    data: { username: CANDIDATE.username, password: CANDIDATE.password },
  });
  expect(res.ok(), `Login failed: ${res.status()}`).toBe(true);

  // The session cookie is set by the server; extract it from the response
  const setCookieHeader = res.headers()["set-cookie"] ?? "";
  // "session=<token>; Path=/; HttpOnly; ..."
  const match = setCookieHeader.match(/session=([^;]+)/);
  expect(match, "session cookie missing from login response").not.toBeNull();
  return `session=${match![1]}`;
}

// ---------------------------------------------------------------------------
// Helper: start exam (creates attempt + environment in mock mode) and return
// the attempt ID (which we use to derive the mock codespace name).
// ---------------------------------------------------------------------------

async function startExamAndGetAttemptId(
  request: Parameters<Parameters<typeof test>[1]>[0]["request"],
  sessionCookie: string
): Promise<number> {
  const res = await request.post("/api/exam", {
    headers: { Cookie: sessionCookie },
    data: { action: "start" },
  });
  expect(res.ok(), `Start exam failed: ${res.status()}`).toBe(true);
  const body = await res.json();
  const attemptId: number = body.attempt.id;

  // Trigger environment creation for this attempt
  const envRes = await request.post("/api/environments", {
    headers: { Cookie: sessionCookie },
    data: { attemptId },
  });
  expect(envRes.ok(), `Environment creation failed: ${envRes.status()}`).toBe(
    true
  );
  const envBody = await envRes.json();
  // In mock mode the codespace_name is "mock-cs-<attemptId>"
  expect(envBody.environment.codespace_name).toBe(`mock-cs-${attemptId}`);

  return attemptId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("POST /api/validation/events", () => {
  test("valid request with known X-Codespace-Name returns 200 { received: true }", async ({
    request,
  }) => {
    const cookie = await loginAndGetCookie(request);
    const attemptId = await startExamAndGetAttemptId(request, cookie);
    const codespaceNameHeader = `mock-cs-${attemptId}`;

    const res = await request.post("/api/validation/events", {
      headers: { "X-Codespace-Name": codespaceNameHeader },
      data: { event_type: "tool_use", tool_name: "Bash" },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true });
  });

  test("request without X-Codespace-Name header returns 401", async ({
    request,
  }) => {
    const res = await request.post("/api/validation/events", {
      data: { event_type: "tool_use", tool_name: "Bash" },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("request with unknown codespace name returns 401", async ({
    request,
  }) => {
    const res = await request.post("/api/validation/events", {
      headers: { "X-Codespace-Name": "completely-unknown-codespace-xyz" },
      data: { event_type: "tool_use", tool_name: "Bash" },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
