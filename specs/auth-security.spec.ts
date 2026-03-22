/**
 * Auth security tests — API-level only (uses `request` fixture, no browser).
 *
 * These tests validate that every protected endpoint correctly enforces
 * authentication and that session lifecycle (login → logout → reject)
 * behaves as specified.
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
