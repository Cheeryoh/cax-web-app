/**
 * Accessibility audit — axe-core full-page scans for all primary page states.
 *
 * Tests run in the `a11y` project which depends on `setup`, giving each
 * describe block an isolated authenticated session via storageState.
 *
 * Pages covered:
 *   1. Login page (/)                  — unauthenticated
 *   2. Candidate portal (/candidate)   — authenticated as candidate
 *   3. Admin dashboard (/admin)        — authenticated as admin
 *   4. Exam MC phase (/exam)           — authenticated as candidate
 *
 * Known violations policy:
 *   - All violations must be empty unless explicitly documented below.
 *   - If axe flags a known false-positive (e.g. a third-party widget),
 *     use .exclude() or .disableRules() with a comment explaining why.
 *
 * Session isolation:
 *   - candidate-a11y.json is a dedicated session not shared with exam-flows
 *     or auth-flows. The exam MC test starts a real exam attempt from this
 *     session; it does not destroy any other test's session.
 */

import path from "path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ---------------------------------------------------------------------------
// 1. Login page — unauthenticated
// ---------------------------------------------------------------------------

test.describe("a11y: Login page (/)", () => {
  test("no accessibility violations on the login page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the login form to render
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page }).analyze();

    expect(
      results.violations,
      `Accessibility violations found on /:\n${
        results.violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")
      }`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Candidate portal — authenticated
// ---------------------------------------------------------------------------

test.describe("a11y: Candidate portal (/candidate)", () => {
  test.use({
    storageState: path.join(__dirname, ".auth/candidate-a11y.json"),
  });

  test("no accessibility violations on the candidate portal", async ({ page }) => {
    await page.goto("/candidate");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the portal to fully render (auth redirect may occur)
    await expect(
      page.locator('[data-testid="candidate-portal"]')
    ).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page }).analyze();

    expect(
      results.violations,
      `Accessibility violations found on /candidate:\n${
        results.violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")
      }`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Admin dashboard — authenticated as admin
// ---------------------------------------------------------------------------

test.describe("a11y: Admin dashboard (/admin)", () => {
  test.use({
    storageState: path.join(__dirname, ".auth/admin.json"),
  });

  test("no accessibility violations on the admin dashboard", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the dashboard to fully render
    await expect(
      page.locator('[data-testid="admin-dashboard"]')
    ).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page }).analyze();

    expect(
      results.violations,
      `Accessibility violations found on /admin:\n${
        results.violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")
      }`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Exam MC phase — authenticated as candidate (with API mocking)
//
// The exam page auto-starts on mount via useEffect → startExam(), which
// calls POST /api/exam { action: "start" } then GET /api/exam?action=questions.
//
// To prevent creating real DB records (which would interfere with the parallel
// exam-flows tests by adding extra attempts for the same candidate), we mock
// the exam API routes with minimal fixture responses that still allow the page
// to render the MC phase fully. The auth API is NOT mocked — the real session
// cookie is used so that auth-dependent rendering works correctly.
// ---------------------------------------------------------------------------

test.describe("a11y: Exam MC phase (/exam)", () => {
  test.use({
    storageState: path.join(__dirname, ".auth/candidate-a11y.json"),
  });

  test("no accessibility violations on the exam MC phase", async ({ page }) => {
    // Mock POST /api/exam to return a synthetic attempt (no DB write)
    await page.route("/api/exam", async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ attempt: { id: 99999 } }),
        });
      } else if (method === "GET") {
        // Mock questions response
        const url = route.request().url();
        if (url.includes("action=questions")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              questions: [
                {
                  id: "q_a11y_1",
                  text: "Which tool is used for file pattern matching in Claude Code?",
                  options: [
                    { key: "A", text: "Bash find command" },
                    { key: "B", text: "Glob tool" },
                    { key: "C", text: "Grep tool" },
                    { key: "D", text: "Read tool" },
                  ],
                },
              ],
            }),
          });
        } else {
          await route.continue();
        }
      } else {
        await route.continue();
      }
    });

    await page.goto("/exam");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the MC phase to be rendered (exam starts automatically)
    await expect(
      page.locator('[data-testid="exam-mc"]')
    ).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page }).analyze();

    expect(
      results.violations,
      `Accessibility violations found on /exam (MC phase):\n${
        results.violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")
      }`
    ).toHaveLength(0);
  });
});
