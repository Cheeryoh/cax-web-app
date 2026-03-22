/**
 * Playwright setup project — authenticates as candidate and admin,
 * then saves storage state (cookies) to .auth/ files for reuse
 * across all authenticated test projects.
 *
 * Uses the API directly (request fixture) rather than the UI form.
 * This is faster, avoids Base UI form interaction quirks, and is the
 * recommended Playwright pattern when the app exposes an auth API.
 *
 * IMPORTANT: Four separate candidate sessions are created:
 *
 *   candidate.json        — used by auth-flows tests (includes a logout test that
 *                           destroys this session token; must be isolated)
 *   candidate-exam.json   — used by exam-flows tests (logout test must NOT
 *                           share this token or the exam flow breaks)
 *   candidate-logout.json — used by logout test ONLY (gets destroyed)
 *   candidate-a11y.json   — used by a11y tests (isolated to avoid interference)
 *   admin.json            — used by admin auth-flow and a11y tests
 *
 * Each setup step performs a fresh login so each file holds a distinct,
 * independent session token in the database.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import { CANDIDATE, ADMIN } from "./helpers/credentials";

const CANDIDATE_AUTH_FILE = path.join(__dirname, ".auth/candidate.json");
const CANDIDATE_EXAM_AUTH_FILE = path.join(
  __dirname,
  ".auth/candidate-exam.json"
);
const CANDIDATE_LOGOUT_AUTH_FILE = path.join(
  __dirname,
  ".auth/candidate-logout.json"
);
const CANDIDATE_A11Y_AUTH_FILE = path.join(
  __dirname,
  ".auth/candidate-a11y.json"
);
const ADMIN_AUTH_FILE = path.join(__dirname, ".auth/admin.json");

/** Shared helper: navigate to /, login via API, verify auth, return storageState. */
async function loginAsCandidate(
  page: Parameters<Parameters<typeof setup>[1]>[0]["page"],
  targetFile: string
) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const res = await page.evaluate(
    async (creds) => {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
        credentials: "same-origin",
      });
      return { ok: r.ok, status: r.status };
    },
    { username: CANDIDATE.username, password: CANDIDATE.password }
  );

  expect(res.ok, `Candidate login failed with status ${res.status}`).toBe(
    true
  );

  const authCheck = await page.evaluate(async () => {
    const r = await fetch("/api/auth", { credentials: "same-origin" });
    return r.ok ? r.json() : null;
  });
  expect(authCheck?.authenticated).toBe(true);
  expect(authCheck?.candidate?.role).toBe("candidate");

  await page.context().storageState({ path: targetFile });
}

// ---------------------------------------------------------------------------
// Candidate session — used by auth-flow tests (including logout)
// ---------------------------------------------------------------------------

setup("authenticate as candidate (auth-flows)", async ({ page }) => {
  await loginAsCandidate(page, CANDIDATE_AUTH_FILE);
});

// ---------------------------------------------------------------------------
// Candidate session — used by exam-flow tests (must NOT be destroyed by logout)
// ---------------------------------------------------------------------------

setup("authenticate as candidate (exam-flows)", async ({ page }) => {
  // Each call to loginAsCandidate performs a new POST /api/auth which
  // creates a distinct session token — independent of candidate.json.
  await loginAsCandidate(page, CANDIDATE_EXAM_AUTH_FILE);
});

// ---------------------------------------------------------------------------
// Candidate session — used by logout test ONLY (this session gets destroyed)
// ---------------------------------------------------------------------------

setup("authenticate as candidate (logout)", async ({ page }) => {
  await loginAsCandidate(page, CANDIDATE_LOGOUT_AUTH_FILE);
});

// ---------------------------------------------------------------------------
// Candidate session — used by a11y tests (isolated from other suites)
// ---------------------------------------------------------------------------

setup("authenticate as candidate (a11y)", async ({ page }) => {
  await loginAsCandidate(page, CANDIDATE_A11Y_AUTH_FILE);
});

// ---------------------------------------------------------------------------
// Admin session — used by admin auth-flow test
// ---------------------------------------------------------------------------

setup("authenticate as admin", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const res = await page.evaluate(
    async (creds) => {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
        credentials: "same-origin",
      });
      return { ok: r.ok, status: r.status };
    },
    { username: ADMIN.username, password: ADMIN.password }
  );

  expect(res.ok, `Admin login failed with status ${res.status}`).toBe(true);

  const authCheck = await page.evaluate(async () => {
    const r = await fetch("/api/auth", { credentials: "same-origin" });
    return r.ok ? r.json() : null;
  });
  expect(authCheck?.authenticated).toBe(true);
  expect(authCheck?.candidate?.role).toBe("admin");

  await page.context().storageState({ path: ADMIN_AUTH_FILE });
});
