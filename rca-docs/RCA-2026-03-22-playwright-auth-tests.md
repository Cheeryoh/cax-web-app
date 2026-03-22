- **Date:** 2026-03-22
- **Severity:** High
- **Summary:** 6 of 24 Playwright E2E tests fail — all involve rendering authenticated pages in production mode. App works correctly in browser.

## Symptom
Candidate portal (`/candidate`), admin dashboard (`/admin`), and exam page (`/exam`) show "Loading..." indefinitely in Playwright headless Chromium when running against `next start` (production build). The same pages work correctly in the browser via `npm run dev`.

## What Was Tried (5 approaches, all failed)

| # | Approach | Result |
|---|----------|--------|
| 1 | `page.fill` + `page.click` on Base UI `ButtonPrimitive` | Form submission never fires. Click event doesn't trigger `onSubmit`. |
| 2 | `page.evaluate(fetch(...))` + `window.location.href` | Cookie sets (verified). `waitForURL` times out — `window.location.href` inside evaluate doesn't resolve Playwright's navigation. |
| 3 | `page.evaluate(fetch(...))` + `page.goto()` | Cookie exists (verified via `page.context().cookies()`). API returns 200 (verified via in-page fetch). React component stays "Loading..." forever. |
| 4 | `page.request.post()` + `page.goto()` | Standalone `request` fixture has separate cookie jar from `page`. Cookies not shared. |
| 5 | `page.context().addCookies()` manual | Cookie added. Same "Loading..." result. |

## Key Evidence
- Cookie IS set in the browser jar (verified via `page.context().cookies()` — returns `session` cookie)
- `GET /api/auth` from browser context returns `{authenticated: true, candidate: {...}}` (verified via `page.evaluate(fetch("/api/auth"))`)
- No JavaScript console errors on the page (verified via `page.on("console")` and `page.on("pageerror")`)
- Page URL IS `/candidate` (verified via `page.url()`)
- Page content IS "Loading..." (verified via `page.content()` and error-context.md snapshots)
- The same API call works via curl with the same cookie value

## Hypotheses

### A: Concurrent fetch deadlock (70% confidence)
The candidate page fires `checkAuth()` → `fetch("/api/auth")` on mount. Simultaneously, the `AppHeader` (loaded via `dynamic` with `ssr: false`) fires its own `fetch("/api/auth")`. In Next.js production mode (`next start`), the server may serialize or deadlock concurrent requests to the same API route from the same page load.

**How to test:** Remove the AppHeader's auth fetch, or use a shared React Context for auth state so only one fetch fires.

### B: Dynamic import + hydration timing (50% confidence)
The `AppHeaderWrapper` uses `dynamic(() => import(...), { ssr: false })`. This delays the AppHeader's load until after hydration. The page's `useEffect` fires during hydration, but the dynamic import may interfere with React's reconciliation, preventing state updates from taking effect.

**How to test:** Remove the `dynamic` wrapper and revert to direct import. Solve hydration mismatch differently (e.g., client-only wrapper without `dynamic`).

### C: Playwright httpOnly cookie handling (30% confidence)
Playwright's headless Chromium may handle `httpOnly` cookies set via `page.evaluate(fetch(...))` differently than cookies set by normal browser navigation. The cookie appears in `page.context().cookies()` but may not be sent with subsequent `page.goto()` requests.

**How to test:** Use Playwright's `storageState` or `globalSetup` to authenticate and save cookies, then load them per test context.

## Files Involved
- `/workspace/src/app/candidate/page.tsx` — `checkAuth()` on mount, "Loading..." default state
- `/workspace/src/app/admin/page.tsx` — same pattern
- `/workspace/src/components/app-header.tsx` — `useEffect` fetches `/api/auth` on mount
- `/workspace/src/components/app-header-wrapper.tsx` — `dynamic` import with `ssr: false`
- `/workspace/src/app/layout.tsx` — renders `AppHeaderWrapper` before `{children}`
- `/workspace/src/app/api/auth/route.ts` — auth API (GET session check, POST login, DELETE logout)
- `/workspace/src/lib/auth-service.ts` — SQLite-backed session store
- `/workspace/specs/auth-flow.spec.ts` — failing auth flow tests
- `/workspace/specs/exam-flow.spec.ts` — failing exam flow test
- `/workspace/specs/app-header.spec.ts` — 3 failing authenticated header tests (use route mocking)
- `/workspace/playwright.config.ts` — webServer: `npm run build && npm run start`

## Approach Vectors for Resolution
1. **App code:** Deduplicate auth fetches via React Context; remove `dynamic` import
2. **Infrastructure:** Investigate Next.js `next start` request handling for concurrent same-route fetches
3. **Test approach:** Use Playwright `storageState` / `globalSetup` for auth instead of per-test cookie setting
4. **Environment:** Compare production vs dev mode behavior; test if the issue reproduces with `npm run dev` instead of `npm run build && npm run start`
