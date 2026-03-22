import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { open: "never" }],
    ["json", { outputFile: "qa-reports/playwright-results.json" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // -----------------------------------------------------------------------
    // Setup project: authenticates once and saves cookies to .auth/ files.
    // Runs before any project that declares it as a dependency.
    // -----------------------------------------------------------------------
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // -----------------------------------------------------------------------
    // Unauthenticated desktop tests — no setup dependency, no storageState.
    // Covers: app-header (unauthenticated + route-mocked), auth-security.
    // Explicitly excludes auth-flow and exam-flow (handled by auth projects).
    // -----------------------------------------------------------------------
    {
      name: "desktop",
      testMatch: [
        "**/app-header.spec.ts",
        "**/auth-security.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },

    // -----------------------------------------------------------------------
    // Auth flow tests — requires setup because auth-flow uses storageState
    // internally (test.use) for portal/logout tests.
    // -----------------------------------------------------------------------
    {
      name: "auth-flows",
      testMatch: "**/auth-flow.spec.ts",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },

    // -----------------------------------------------------------------------
    // Exam flow tests — require candidate authentication.
    // -----------------------------------------------------------------------
    {
      name: "exam-flows",
      testMatch: "**/exam-flow.spec.ts",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },

    // -----------------------------------------------------------------------
    // Mobile project — unauthenticated, covers header mobile tests.
    // -----------------------------------------------------------------------
    {
      name: "mobile",
      testMatch: "**/app-header.spec.ts",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
});
