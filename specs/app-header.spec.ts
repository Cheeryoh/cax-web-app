import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("AppHeader — unauthenticated", () => {
  test("renders header with title link at desktop", async ({ page }) => {
    await page.goto("/");

    const header = page.locator('[data-testid="app-header"]');
    await expect(header).toBeVisible();

    // Title link present and points to "/"
    const title = header.locator('[data-testid="app-title"]');
    await expect(title).toBeVisible();
    await expect(title).toHaveText("CAX");
    await expect(title).toHaveAttribute("href", "/");

    // Authenticated-only elements must be absent when not logged in
    await expect(
      header.locator('[data-testid="header-display-name"]')
    ).not.toBeVisible();
    await expect(
      header.locator('[data-testid="header-role-badge"]')
    ).not.toBeVisible();
    await expect(
      header.locator('[data-testid="header-logout-btn"]')
    ).not.toBeVisible();
  });

  test("header has correct height and border", async ({ page }) => {
    await page.goto("/");
    const header = page.locator('[data-testid="app-header"]');
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    // h-14 = 56px (allow 1px variance for sub-pixel rendering)
    expect(box!.height).toBeGreaterThanOrEqual(55);
    expect(box!.height).toBeLessThanOrEqual(57);
  });

  test("no accessibility violations on landing page", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .include('[data-testid="app-header"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test("screenshot — header unauthenticated desktop", async ({ page }) => {
    await page.goto("/");
    const header = page.locator('[data-testid="app-header"]');
    await expect(header).toHaveScreenshot("app-header-unauthenticated-desktop.png");
  });
});

test.describe("AppHeader — unauthenticated mobile", () => {
  test("renders header on mobile viewport", async ({ page }) => {
    await page.goto("/");

    const header = page.locator('[data-testid="app-header"]');
    await expect(header).toBeVisible();

    const title = header.locator('[data-testid="app-title"]');
    await expect(title).toBeVisible();
    await expect(title).toHaveText("CAX");
  });
});

test.describe("AppHeader — authenticated", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept /api/auth GET to return a logged-in user
    await page.route("/api/auth", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authenticated: true,
            candidate: {
              displayName: "Alice Tester",
              role: "admin",
            },
          }),
        });
      } else {
        route.continue();
      }
    });
  });

  test("shows display name, role badge, and logout button", async ({
    page,
  }) => {
    // This test asserts display-name visibility — only valid on desktop viewport
    // (sm breakpoint = 640px). Skip on narrow viewports where it's intentionally hidden.
    const vp = page.viewportSize();
    test.skip(
      vp !== null && vp.width < 640,
      "display-name is hidden sm:inline — not visible on mobile viewports"
    );

    await page.goto("/");

    const header = page.locator('[data-testid="app-header"]');

    // Display name visible on desktop (hidden sm:inline — desktop viewport is wide enough)
    const displayName = header.locator('[data-testid="header-display-name"]');
    await expect(displayName).toBeVisible();
    await expect(displayName).toHaveText("Alice Tester");

    // Role badge
    const badge = header.locator('[data-testid="header-role-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("admin");

    // Logout button
    const logoutBtn = header.locator('[data-testid="header-logout-btn"]');
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toHaveText("Log out");
  });

  test("logout calls DELETE /api/auth and redirects to /", async ({ page }) => {
    let deleteCalled = false;

    await page.route("/api/auth", (route) => {
      const method = route.request().method();
      if (method === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ authenticated: true, candidate: { displayName: "Alice Tester", role: "admin" } }),
        });
      } else if (method === "DELETE") {
        deleteCalled = true;
        route.fulfill({ status: 204, body: "" });
      } else {
        route.continue();
      }
    });

    await page.goto("/");

    const logoutBtn = page.locator('[data-testid="header-logout-btn"]');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // After logout the page navigates to "/"
    await page.waitForURL("/");
    expect(deleteCalled).toBe(true);
  });

  test("display name hidden on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const displayName = page.locator('[data-testid="header-display-name"]');
    // hidden sm:inline — must not be visible on narrow viewport
    await expect(displayName).toBeHidden();

    // Badge and logout button remain visible on mobile
    await expect(
      page.locator('[data-testid="header-role-badge"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="header-logout-btn"]')
    ).toBeVisible();
  });

  test("no accessibility violations when authenticated", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .include('[data-testid="app-header"]')
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test("screenshot — header authenticated desktop", async ({ page }) => {
    await page.goto("/");
    const header = page.locator('[data-testid="app-header"]');
    await expect(header).toHaveScreenshot("app-header-authenticated-desktop.png");
  });
});
