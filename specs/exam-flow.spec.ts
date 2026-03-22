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

    // Verify exactly 3 task cards exist (Task 1, Task 2, Task 3)
    const taskCards = labSection.locator(".space-y-4 > *");
    await expect(taskCards).toHaveCount(3);

    // Verify Phase 3 task content is present
    const labText = await labSection.textContent();
    expect(labText).toContain("jQuery");
    expect(labText).toContain("Analytics");
    expect(labText).toContain("Brand Color");

    // Verify deprecated task names from previous phase are absent
    expect(labText).not.toContain("Deterministic");
    expect(labText).not.toContain("Open-ended");
  });

  test("Environment status card visible and 'Open Codespace' link present (mock mode)", async () => {
    // Lab section must be visible from previous step
    const labSection = sharedPage.locator('[data-testid="exam-lab"]');
    await expect(labSection).toBeVisible({ timeout: 10_000 });

    // Environment status card should be present
    const envCard = labSection.locator('text=Your Environment');
    await expect(envCard).toBeVisible({ timeout: 5_000 });

    // In mock mode the environment becomes 'ready' quickly; poll up to 15 s
    const openLink = sharedPage.locator('[data-testid="open-codespace-link"]');
    await expect(openLink).toBeVisible({ timeout: 15_000 });
    await expect(openLink).toHaveText("Open Codespace");
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

  test("After lab submission, candidate portal shows lab results and fluency scores (not placeholders)", async () => {
    // The submitted state must be visible from the previous test.
    await expect(
      sharedPage.locator('[data-testid="exam-submitted"]')
    ).toBeVisible({ timeout: 10_000 });

    // Give the async mock evaluation time to finish before navigating away.
    // runFullEvaluation (mock mode) is synchronous DB writes, so 3 s is
    // more than enough even under load.
    await sharedPage.waitForTimeout(3_000);

    // Navigate to the candidate portal
    await sharedPage.goto("/candidate");
    await sharedPage.waitForLoadState("domcontentloaded");

    const portal = sharedPage.locator('[data-testid="candidate-portal"]');
    await expect(portal).toBeVisible({ timeout: 15_000 });

    // There should be at least one attempt card on the page
    const attemptCards = portal.locator('[data-testid^="attempt-"]');
    await expect(attemptCards.first()).toBeVisible({ timeout: 10_000 });

    // The most-recent attempt (first card) should display lab results.
    // Before evaluation: "—" (from `labResults.length || "—"`).
    // After evaluation:  "3/3" (3 tasks, all passed).
    const firstCard = attemptCards.first();
    const labTasksCell = firstCard.locator('text=Lab Tasks').locator('..');
    await expect(labTasksCell.locator('p.text-lg')).not.toHaveText("—", {
      timeout: 10_000,
    });

    // Fluency scores should show individual dimension values, not "Pending"
    await expect(firstCard.locator('text=Pending')).toHaveCount(0, {
      timeout: 10_000,
    });

    // Verify all four dimension labels are present with numeric scores
    await expect(firstCard.locator('text=/Delegation: \\d/')).toBeVisible({
      timeout: 5_000,
    });
    await expect(firstCard.locator('text=/Description: \\d/')).toBeVisible({
      timeout: 5_000,
    });
    await expect(firstCard.locator('text=/Discernment: \\d/')).toBeVisible({
      timeout: 5_000,
    });
    await expect(firstCard.locator('text=/Diligence: \\d/')).toBeVisible({
      timeout: 5_000,
    });
  });
});
