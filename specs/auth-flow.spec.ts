/**
 * Auth flow tests — browser-based UI flows.
 *
 * Covers: login page rendering, candidate portal visibility (via storageState),
 * admin dashboard visibility (via storageState), and logout behaviour.
 *
 * Tests that require an authenticated session use storageState loaded from
 * specs/.auth/{candidate,admin}.json, written by specs/auth.setup.ts.
 * This replaces the previous per-test page.evaluate(fetch(...)) pattern,
 * which was fragile and coupled to cookie timing in production mode.
 */

import path from "path";
import { test, expect } from "@playwright/test";
import { CANDIDATE, ADMIN } from "./helpers/credentials";

// ---------------------------------------------------------------------------
// Landing page — unauthenticated, no storageState needed
// ---------------------------------------------------------------------------

test("Visit / → login form visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="username-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="login-submit-btn"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Login form UI interaction — tests the actual button click, not API shortcuts
// This is the test that would have caught the Base UI type="button" bug.
// ---------------------------------------------------------------------------

test.describe("Login form UI interaction", () => {
  test("Fill credentials and click submit → redirected to /candidate", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Clear pre-filled values and enter candidate credentials
    const usernameInput = page.locator('[data-testid="username-input"]');
    const passwordInput = page.locator('[data-testid="password-input"]');
    await usernameInput.clear();
    await usernameInput.fill(CANDIDATE.username);
    await passwordInput.clear();
    await passwordInput.fill(CANDIDATE.password);

    // Click the actual submit button — this is what the user does
    await page.locator('[data-testid="login-submit-btn"]').click();

    // Should redirect to /candidate via window.location.href
    await page.waitForURL("**/candidate", { timeout: 15_000 });
    await expect(
      page.locator('[data-testid="candidate-portal"]')
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Fill admin credentials and click submit → redirected to /admin", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const usernameInput = page.locator('[data-testid="username-input"]');
    const passwordInput = page.locator('[data-testid="password-input"]');
    await usernameInput.clear();
    await usernameInput.fill(ADMIN.username);
    await passwordInput.clear();
    await passwordInput.fill(ADMIN.password);

    await page.locator('[data-testid="login-submit-btn"]').click();

    await page.waitForURL("**/admin", { timeout: 15_000 });
    await expect(
      page.locator('[data-testid="admin-dashboard"]')
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Wrong password → error message shown, no redirect", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const usernameInput = page.locator('[data-testid="username-input"]');
    const passwordInput = page.locator('[data-testid="password-input"]');
    await usernameInput.clear();
    await usernameInput.fill(CANDIDATE.username);
    await passwordInput.clear();
    await passwordInput.fill("wrongpassword");

    await page.locator('[data-testid="login-submit-btn"]').click();

    // Error message should appear
    await expect(
      page.locator('[data-testid="login-error"]')
    ).toBeVisible({ timeout: 5_000 });

    // Should still be on the login page
    expect(page.url()).toContain("localhost:3000");
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Candidate portal — uses pre-authenticated storageState (no per-test login)
// ---------------------------------------------------------------------------

test.describe("Candidate portal — authenticated", () => {
  test.use({
    storageState: path.join(__dirname, ".auth/candidate.json"),
  });

  test("Navigate to /candidate → candidate-portal visible", async ({ page }) => {
    await page.goto("/candidate");
    await expect(
      page.locator('[data-testid="candidate-portal"]')
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Admin dashboard — uses pre-authenticated storageState (no per-test login)
// ---------------------------------------------------------------------------

test.describe("Admin dashboard — authenticated", () => {
  test.use({
    storageState: path.join(__dirname, ".auth/admin.json"),
  });

  test("Navigate to /admin → admin-dashboard visible", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.locator('[data-testid="admin-dashboard"]')
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Logout — uses pre-authenticated storageState, then logs out via API
// ---------------------------------------------------------------------------

test.describe("Logout flow", () => {
  // Uses its own isolated session — the logout test DESTROYS this session,
  // so it must NOT share with any other test (see Playwright Test Isolation rule)
  test.use({
    storageState: path.join(__dirname, ".auth/candidate-logout.json"),
  });

  test("DELETE /api/auth → session invalidated", async ({ page }) => {
    // Verify session is live
    await page.goto("/");
    const authBefore = await page.evaluate(async () => {
      const res = await fetch("/api/auth", { credentials: "same-origin" });
      return res.status;
    });
    expect(authBefore).toBe(200);

    // Logout via API
    await page.evaluate(async () => {
      await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
    });

    // Session must now be invalidated
    const authAfter = await page.evaluate(async () => {
      const res = await fetch("/api/auth", { credentials: "same-origin" });
      return res.status;
    });
    expect(authAfter).toBe(401);
  });
});
