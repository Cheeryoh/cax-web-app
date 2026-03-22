/**
 * Exam flow tests — full candidate journey through MC → lab → submit.
 *
 * All tests run in the authenticated-candidate project, which pre-loads the
 * session cookie from specs/.auth/candidate.json (written by auth.setup.ts).
 * No per-test login logic is needed — page.goto("/exam") works directly.
 *
 * The suite is serial because each step depends on state accumulated in
 * previous steps (attempt created, MC submitted, lab active).
 * A single page instance is shared across the serial suite via beforeAll,
 * so the exam state is preserved between steps.
 */

import path from "path";
import { test, expect, type Page } from "@playwright/test";

// Use the exam-specific auth file so the logout test in auth-flows
// cannot invalidate this session by calling DELETE /api/auth.
test.use({
  storageState: path.join(__dirname, ".auth/candidate-exam.json"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Select the first radio option for every question card on the MC page.
 * Returns the count of questions found.
 */
async function answerAllQuestions(page: Page): Promise<number> {
  const questionCards = page.locator('[data-testid^="question-"]');
  const count = await questionCards.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await questionCards.nth(i).locator('input[type="radio"]').first().click();
  }
  return count;
}

// ---------------------------------------------------------------------------
// Full exam flow — serial, shared page instance preserves exam state
// ---------------------------------------------------------------------------

test.describe.serial("Full exam flow", () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    // Load the authenticated storage state into the browser context so that
    // the shared page already has the session cookie on first navigation.
    const context = await browser.newContext({
      storageState: path.join(__dirname, ".auth/candidate-exam.json"),
    });
    sharedPage = await context.newPage();
    await sharedPage.goto("/exam");
    await sharedPage.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await sharedPage.context().close();
  });

  test("Navigate to /exam → MC questions visible", async () => {
    const mcSection = sharedPage.locator('[data-testid="exam-mc"]');
    await expect(mcSection).toBeVisible({ timeout: 15_000 });

    const questionCards = sharedPage.locator('[data-testid^="question-"]');
    await expect(questionCards.first()).toBeVisible({ timeout: 10_000 });
  });

  test("Answer all questions → submit → MC result visible", async () => {
    // Wait for MC phase to be visible (may already be there from previous test)
    await expect(sharedPage.locator('[data-testid="exam-mc"]')).toBeVisible({
      timeout: 15_000,
    });

    await answerAllQuestions(sharedPage);

    const submitBtn = sharedPage.locator('button:has-text("Submit Answers")');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await expect(
      sharedPage.locator('[data-testid="exam-mc-result"]')
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Continue to lab → task cards visible without 'Deterministic' or 'Open-ended' text", async () => {
    // MC result must be visible from previous step
    await expect(
      sharedPage.locator('[data-testid="exam-mc-result"]')
    ).toBeVisible({ timeout: 10_000 });

    await sharedPage
      .locator('button:has-text("Continue to Performance Lab")')
      .click();

    const labSection = sharedPage.locator('[data-testid="exam-lab"]');
    await expect(labSection).toBeVisible({ timeout: 10_000 });

    const taskCards = labSection.locator(".space-y-4 > *");
    await expect(taskCards.first()).toBeVisible();

    const labText = await labSection.textContent();
    expect(labText).not.toContain("Deterministic");
    expect(labText).not.toContain("Open-ended");
  });

  test("Submit lab → submitted confirmation visible", async () => {
    // Lab must be visible from previous step
    await expect(
      sharedPage.locator('[data-testid="exam-lab"]')
    ).toBeVisible({ timeout: 10_000 });

    await sharedPage.locator('button:has-text("Submit Lab")').click();

    await expect(
      sharedPage.locator('[data-testid="exam-submitted"]')
    ).toBeVisible({ timeout: 10_000 });
  });
});
