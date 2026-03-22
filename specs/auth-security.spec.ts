/**
 * Auth security tests — API-level only (uses `request` fixture, no browser).
 *
 * These tests validate that every protected endpoint correctly enforces
 * authentication and that session lifecycle (login → logout → reject)
 * behaves as specified.
 *
 * Coverage:
 *   [x] Unauthenticated access to protected APIs → 401
 *   [x] Candidate cannot access admin API → 401
 *   [x] Session invalidation on logout
 *   [x] Wrong password → 401
 *   [x] Missing fields → 400
 *   [x] Evaluate endpoint requires admin role → 401 for candidate
 *   [x] Evaluate endpoint requires admin role → 401 for unauthenticated
 *   [x] Validation events endpoint rejects requests without X-Codespace-Name → 401
 *   [x] Environments API requires authentication → 401
 */

import { test, expect } from "@playwright/test";
import { CANDIDATE, ADMIN } from "./helpers/credentials";

// ---------------------------------------------------------------------------
// Unauthenticated access — all protected endpoints must return 401
// ---------------------------------------------------------------------------

test.describe("Unauthenticated access → 401", () => {
  test("GET /api/exam?action=questions without session → 401", async ({
    request,
  }) => {
    const res = await request.get("/api/exam?action=questions");
    expect(res.status()).toBe(401);
  });

  test("POST /api/exam {action:'start'} without session → 401", async ({
    request,
  }) => {
    const res = await request.post("/api/exam", {
      data: { action: "start" },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/admin without session → 401", async ({ request }) => {
    const res = await request.get("/api/admin");
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Role-based access control
// ---------------------------------------------------------------------------

test.describe("Role enforcement", () => {
  test("Candidate session → GET /api/admin → 401", async ({ request }) => {
    // Login as candidate first
    const loginRes = await request.post("/api/auth", {
      data: CANDIDATE,
    });
    expect(loginRes.status()).toBe(200);

    // Same request context carries the session cookie; admin endpoint must
    // reject a non-admin role.
    const adminRes = await request.get("/api/admin");
    expect(adminRes.status()).toBe(401);
  });

  test("Admin session → GET /api/admin → 200", async ({ request }) => {
    const loginRes = await request.post("/api/auth", {
      data: ADMIN,
    });
    expect(loginRes.status()).toBe(200);

    const adminRes = await request.get("/api/admin");
    expect(adminRes.status()).toBe(200);

    const body = await adminRes.json();
    // Response must include the candidates array
    expect(body).toHaveProperty("candidates");
  });
});

// ---------------------------------------------------------------------------
// Session invalidation after logout
// ---------------------------------------------------------------------------

test.describe("Session lifecycle", () => {
  test("Login → DELETE /api/auth → GET /api/auth → 401 (session invalidated)", async ({
    request,
  }) => {
    // Authenticate
    const loginRes = await request.post("/api/auth", {
      data: CANDIDATE,
    });
    expect(loginRes.status()).toBe(200);

    // Verify session is live
    const authCheck = await request.get("/api/auth");
    expect(authCheck.status()).toBe(200);

    // Logout
    const logoutRes = await request.delete("/api/auth");
    expect(logoutRes.status()).toBe(200);

    // Session must now be invalidated — the cookie was cleared by the server
    // and the request context no longer holds a valid token.
    const postLogoutCheck = await request.get("/api/auth");
    expect(postLogoutCheck.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Credential validation
// ---------------------------------------------------------------------------

test.describe("Credential validation", () => {
  test("Wrong password → 401", async ({ request }) => {
    const res = await request.post("/api/auth", {
      data: { username: CANDIDATE.username, password: "WrongPass999!" },
    });
    expect(res.status()).toBe(401);
  });

  test("Missing username → 400", async ({ request }) => {
    const res = await request.post("/api/auth", {
      data: { password: CANDIDATE.password },
    });
    expect(res.status()).toBe(400);
  });

  test("Missing password → 400", async ({ request }) => {
    const res = await request.post("/api/auth", {
      data: { username: CANDIDATE.username },
    });
    expect(res.status()).toBe(400);
  });

  test("Empty body → 400", async ({ request }) => {
    const res = await request.post("/api/auth", {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Evaluate endpoint — admin-only
// ---------------------------------------------------------------------------

test.describe("POST /api/evaluate — admin-only access", () => {
  test("Unauthenticated request → 401", async ({ request }) => {
    const res = await request.post("/api/evaluate", {
      data: { attemptId: 1 },
    });
    expect(res.status()).toBe(401);
  });

  test("Candidate session → POST /api/evaluate → 401", async ({ request }) => {
    // Login as candidate
    const loginRes = await request.post("/api/auth", {
      data: CANDIDATE,
    });
    expect(loginRes.status()).toBe(200);

    // Candidate must NOT be able to trigger evaluation (admin-only)
    const evalRes = await request.post("/api/evaluate", {
      data: { attemptId: 1 },
    });
    expect(evalRes.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Environments API — requires authentication
// ---------------------------------------------------------------------------

test.describe("Environments API — authentication enforced", () => {
  test("POST /api/environments without session → 401", async ({ request }) => {
    const res = await request.post("/api/environments", {
      data: { attemptId: 1 },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/environments without session → 401", async ({ request }) => {
    const res = await request.get("/api/environments?attemptId=1");
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/environments without session → 401", async ({ request }) => {
    const res = await request.delete("/api/environments", {
      data: { attemptId: 1 },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Validation events — X-Codespace-Name header required
// ---------------------------------------------------------------------------

test.describe("POST /api/validation/events — header-based auth", () => {
  test("Request without X-Codespace-Name header → 401", async ({ request }) => {
    // This is already tested in validation-events.spec.ts but duplicated here
    // as part of the security checklist to ensure the header requirement is
    // always enforced regardless of which test suite runs.
    const res = await request.post("/api/validation/events", {
      data: { event_type: "tool_use", tool_name: "Bash" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("Request with forged/unknown X-Codespace-Name → 401", async ({
    request,
  }) => {
    const res = await request.post("/api/validation/events", {
      headers: { "X-Codespace-Name": "fake-codespace-that-does-not-exist" },
      data: { event_type: "tool_use", tool_name: "Bash" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
