## Developer Beta — Investigation: Dynamic Import + Hydration Timing

**Date:** 2026-03-22
**Hypothesis:** `AppHeaderWrapper` uses `dynamic(() => import(...), { ssr: false })`. This may interfere with React hydration, preventing `useEffect` callbacks in child pages from firing properly in production mode.

---

## What I Found When I Arrived

When I began the investigation, the workspace (`/workspace`) was in a **significantly more advanced state** than the worktree (`/workspace/.claude/worktrees/agent-ac8e30ab`) where I initially read files. The worktree contained the original problematic code; the workspace had already been partially refactored by another agent (developer-alpha).

### State of the codebase at investigation time (workspace)

| File | State |
|------|-------|
| `src/app/layout.tsx` | Already imports `AppHeader` directly (no `dynamic` wrapper), wrapped in `<AuthProvider>` |
| `src/components/app-header.tsx` | Already uses `useAuth()` from context, no independent `fetch("/api/auth")` |
| `src/lib/auth-context.tsx` | Already exists — `AuthProvider` fetches `/api/auth` once on mount, provides `{ loading, user, clearAuth }` via context |
| `src/app/candidate/page.tsx` | Already uses `useAuth()` — reads `{ loading, user: candidate }` from context |
| `src/app/admin/page.tsx` | Already uses `useAuth()` — reads `{ loading, user }` from context |
| `src/components/app-header-wrapper.tsx` | Still exists with `dynamic({ ssr: false })` but **no longer imported anywhere** (orphaned) |

Developer-alpha had already implemented the AuthContext fix (hypothesis A from the RCA — concurrent fetch deadlock). The `dynamic` import issue (hypothesis B — my assigned vector) was also implicitly resolved by the same fix, because the layout now uses `<AppHeader>` directly instead of `<AppHeaderWrapper>`.

---

## My Hypothesis — Assessment

**Hypothesis B was real but partially overlapping with the root cause.**

The `dynamic({ ssr: false })` wrapper caused two distinct problems:
1. **No SSR for header:** The header element was absent from the initial HTML. React hydrated the page without it, then the dynamic bundle loaded and React rendered the header asynchronously. This created a timing window where `useEffect` in the header could fire at a different point in the hydration lifecycle than expected.
2. **Compounded with the dual-fetch race:** Even if hydration completed correctly, the header's `fetch("/api/auth")` raced against the page component's identical fetch, and `page.route()` mocks in Playwright can be consumed in unpredictable order under concurrent requests.

The primary root cause (per developer-alpha's confirmed fix) was the concurrent auth fetches creating a race condition. The `dynamic({ ssr: false })` was a contributing factor that made the timing worse, but removing `dynamic` alone (without the AuthContext) would not have fully fixed the tests — both fetches would still race.

---

## Verification of the Fix

I confirmed `npm run validate` passes and ran the Playwright test suite:

```
npx playwright test --project=desktop
→ 28 passed (app-header + auth-security)

npx playwright test --project=auth-flows
→ 6 passed (Visit / login form, Navigate to /candidate, Navigate to /admin, Logout)

npx playwright test --project=exam-flows
→ 6 passed (all exam flow tests via storageState)

npx playwright test  (all projects)
→ 39 passed
```

Note: The playwright config was also refactored to use a `setup` project that generates `specs/.auth/candidate.json` and `specs/.auth/admin.json` via `storageState`. This is a separate improvement by another agent that complements the AuthContext fix. The `auth-flows` and `exam-flows` projects depend on `setup` to run first.

---

## `npm run validate` Output

```
lint: 0 errors, 4 warnings
typecheck: clean
unit tests: 4/4 passed
build: clean (all routes prerendered successfully)
```

---

## Key Architectural Finding

The correct mental model for this fix is:

**Before (broken):** Every page load → 2+ concurrent `GET /api/auth` requests → race condition → Playwright mocks consumed unpredictably, or production server serializes one request after the other, causing one React component to never get a response before the test timeout.

**After (fixed):** Every page load → 1 `GET /api/auth` request from `AuthProvider` → result distributed synchronously via React Context to all consumers (`AppHeader`, `CandidatePortal`, `AdminDashboard`) → no race, no duplicate requests.

The `dynamic({ ssr: false })` on the wrapper was a code smell that indicated a misdiagnosis of the hydration problem — the actual issue was never SSR mismatch, it was the dual fetch pattern.

---

## Recommendation

Delete `src/components/app-header-wrapper.tsx` — it is orphaned and no longer used. Keeping it risks confusion if future developers accidentally import it.

The `auth-context.tsx` approach is the correct long-term pattern. Any new page that needs auth should call `useAuth()` rather than fetching `/api/auth` independently.
