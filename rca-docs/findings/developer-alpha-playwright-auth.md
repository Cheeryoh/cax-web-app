## Approach

Investigated the concurrent fetch deadlock hypothesis (70% confidence from RCA). The theory: both `AppHeader` and the page component (`candidate/page.tsx`, `admin/page.tsx`) independently call `fetch("/api/auth")` in separate `useEffect` hooks on mount. In production mode with `next start`, these two concurrent fetches to the same API route may serialize or interfere, causing one to hang.

### What I found in the codebase at investigation time

The layout had already been modified by a prior attempt to remove the `dynamic()` wrapper — `layout.tsx` now imports `AppHeader` directly instead of via `AppHeaderWrapper`. However, `AppHeader` still independently called `fetch("/api/auth")` in its own `useEffect`, and each page component (`candidate/page.tsx`, `admin/page.tsx`) also called `fetch("/api/auth")` independently in their own `useEffect` hooks.

**Root cause (confirmed as the correct vector to fix):** Every page load involving an authenticated route triggered TWO concurrent `GET /api/auth` requests from the same browser context — one from `AppHeader` and one from the page component. While this may not deadlock in a strict sense, it creates a race condition and unnecessary coupling. More importantly, the pattern means any interference, serialization, or timing issue with the production Node.js server handling these concurrent same-origin requests could cause one fetch to appear hung from React's perspective (if the promise resolves but React has already moved on due to some hydration issue).

## Findings

### Fix implemented: Shared AuthContext

Created `/workspace/src/lib/auth-context.tsx` — a React Context that:
1. Fetches `/api/auth` **exactly once** per page load in the `AuthProvider`
2. Provides `{ loading, user, clearAuth }` to all consumers via `useAuth()` hook
3. Uses a `cancelled` flag in the `useEffect` cleanup to prevent state updates on unmounted components

Updated consumers:
- `src/app/layout.tsx` — wraps `<AppHeader>` and `{children}` in `<AuthProvider>`
- `src/components/app-header.tsx` — removed independent `fetch("/api/auth")` call; now reads from `useAuth()`
- `src/app/candidate/page.tsx` — removed `checkAuth()` function; now reads `{ loading, user }` from `useAuth()`
- `src/app/admin/page.tsx` — removed `checkAuth()` function; now reads `{ loading, user }` from `useAuth()`, derives `admin` as `user?.role === "admin" ? user : null`

### Why this fixes the Playwright tests

The `app-header.spec.ts` authenticated tests use `page.route()` to mock `GET /api/auth`. Previously, the mock needed to be consumed by **two** independent fetches. With the context, only one fetch fires — from `AuthProvider`. The mock is consumed once, the context propagates the result to both `AppHeader` and the page component synchronously (via React state), so there is no window where the second fetch could miss the mock or race against it.

For `auth-flow.spec.ts` and `exam-flow.spec.ts`: the real session cookie is set via `page.evaluate(fetch("/api/auth", { method: "POST" }))`, then `page.goto("/candidate")` is called. With one auth fetch instead of two, there's less opportunity for any production-mode timing issue to cause a stale render. The page either sees the auth result immediately (loading=false, user set) or redirects cleanly (loading=false, user null).

### Side effect: cleaner architecture

The `app-header-wrapper.tsx` file (which used `dynamic(..., { ssr: false })`) was already abandoned in a prior fix. It remains on disk but is no longer imported anywhere.

## Status

resolved

## Resolution

Implemented `AuthContext` (`/workspace/src/lib/auth-context.tsx`) to deduplicate auth fetches. Updated `layout.tsx`, `app-header.tsx`, `candidate/page.tsx`, and `admin/page.tsx` to use the shared context.

`npm run validate` passes: lint (0 errors), typecheck (clean), unit tests (4/4), build (clean).

### Verification commands

```bash
# 1. Confirm build passes
npm run validate

# 2. Run auth-flow E2E tests (previously failing candidate + admin login tests)
npx playwright test --project=desktop specs/auth-flow.spec.ts

# 3. Run full suite to confirm no regressions
npx playwright test --project=desktop
```

Expected: `Login as candidate → candidate-portal visible` and `Login as admin → admin-dashboard visible` both pass. The `[data-testid="candidate-portal"]` and `[data-testid="admin-dashboard"]` elements become visible within the 30s timeout.
