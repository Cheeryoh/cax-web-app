# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **CAX Web App** — a candidate assessment platform built with Next.js 16 (App Router), SQLite (better-sqlite3), TailwindCSS v4, and shadcn/ui v4. It evaluates Claude Code proficiency through multiple-choice questions and a hands-on performance lab.

## Tech Stack (Verified)

- **Framework:** Next.js 16.2.1 (Turbopack, App Router)
- **UI:** TailwindCSS v4, shadcn/ui v4 (Base UI primitives, NOT Radix)
- **Database:** SQLite via better-sqlite3 (synchronous API)
- **Auth:** bcryptjs + SQLite session store + AuthProvider React Context
- **Testing:** Vitest (unit), Playwright 1.58.2 + Chromium (E2E/visual/a11y), axe-core (accessibility)

## Development Environment

Docker dev container based on `node:20-bookworm-slim`. Runs as `node` user (passwordless sudo).

## Port Mapping

| Port | Purpose |
|------|---------|
| 3000 | Next.js Dev Server |

## Dependency Rule — IMPORTANT

BEFORE installing or using ANY dependency, library, or framework, you MUST:
1. Fetch and read the relevant section of its official documentation (use WebFetch)
2. Verify the API, configuration, and usage patterns match your intended use
3. After installing, **Read the generated/installed source file** before using it in application code
4. When a component wraps a third-party primitive, **read the primitive's source too** — the wrapper's API is the surface, the primitive's behavior is the contract (e.g., Base UI's `useButton` sets `type="button"` on native buttons, overriding form submit behavior)
5. Do NOT assume APIs, flags, config shapes, or defaults — verify them against the docs

## shadcn/ui v4 — IMPORTANT

shadcn/ui v4 uses **Base UI primitives** (NOT Radix). Key differences from older versions:
- No `asChild` prop — use `render` prop or `buttonVariants()` with plain elements
- Button uses `@base-ui/react/button`, Badge uses `useRender` from `@base-ui/react`
- Input uses `@base-ui/react/input`
- **Base UI Button sets `type="button"` on native buttons** — this prevents form submission. For form submit buttons, use a native `<button type="submit">` with Tailwind classes instead of the shadcn `<Button>` component
- Always read the generated component file in `src/components/ui/` before using it

## API Token Rule — IMPORTANT

- NEVER use live API tokens if cached/mock data exists
- All services must support `USE_MOCK=true` mode with fixture data
- Store tokens in .env.local (gitignored), never hardcode

## Auth Pattern — IMPORTANT

Auth state is managed by `AuthProvider` (`src/lib/auth-context.tsx`) which fetches `GET /api/auth` ONCE per page load and shares the result via `useAuth()` hook.

- **NEVER have multiple components independently fetch `/api/auth` on mount** — this caused a production-mode race condition (see RCA-2026-03-22-playwright-auth-tests.md)
- Always use `useAuth()` from `@/lib/auth-context` for auth state in client components
- `AppHeader` and all page components consume auth state from the shared context
- `clearAuth()` resets state after logout

## Playwright Test Isolation — IMPORTANT

- Each test project that modifies auth state (e.g., logout) MUST have its own isolated `storageState` session file
- Never share a `storageState` file between a test that destroys a session and a test that needs it
- Auth sessions are created in `specs/auth.setup.ts` and saved to `specs/.auth/`
- Current sessions: `candidate.json` (auth-flows), `candidate-exam.json` (exam-flows), `admin.json`

## Playwright UI Coverage Rule — IMPORTANT

Every form and primary user interaction MUST have at least one E2E test that exercises it **the way a user would** — fill fields, click buttons, verify the outcome. API-based auth shortcuts (`storageState`, `page.evaluate(fetch(...))`) are acceptable for most tests, but they do NOT replace testing the actual UI flow. If a user clicks a button and nothing happens, a test must catch that.

## npm in Dev Container

- Always use `--no-audit --no-fund` flags with npm install
- `node_modules/` is a Docker named volume — after any wipe, verify ownership with `ls -la node_modules/`
- Never kill npm install mid-flight — it leaves corrupted temp dirs
- Build script sets `NODE_ENV=production` — the dev container defaults to `development`

## Phase Completion Rule — IMPORTANT

Before marking ANY phase complete:
1. Re-read the plan's deliverable list for that phase
2. For EACH deliverable, verify it exists on disk (file, config, installed package)
3. Prove it works with a command (e.g., `npx playwright --version`, `npm run validate`)
4. "All dependencies installed" means all dependencies THE PLAN REQUIRES — not just what package.json happens to list
5. The plan is the source of truth. Package.json is an artifact.
6. Run `npm run qa` against a CLEAN state (delete `data/cax.db` + `specs/.auth/`) before declaring a phase complete — not just `npm run validate`

## Database Operations — IMPORTANT

- After deleting `data/cax.db`, always restart the dev server (`npm run dev`)
- The `getDb()` singleton validates its connection on each call, but a server restart is the cleanest recovery
- Never delete the DB while Playwright tests are running

## Debugging Test Failures — IMPORTANT

When tests fail, determine whether the BUG is in the app or the tests BEFORE making changes:
1. Test the app directly (curl, browser, standalone Playwright script) bypassing the test suite
2. If the app works correctly, the bug is in the test infrastructure — fix the tests
3. If the app is broken, fix the app — don't change tests to work around app bugs
4. Never assume "the tests must be right" or "the app must be right" — verify independently

## Build Commands

```bash
npm run dev          # Start Next.js dev server (port 3000)
npm run build        # Production build (sets NODE_ENV=production)
npm run validate     # lint + typecheck + unit tests + build
npm run qa           # validate + Playwright E2E/visual/a11y
```

## Work Log & Transcript

Maintain two living documents:
1. `/workspace/WORK_LOG.md` — What was built, decisions, blockers, resolutions
2. `/workspace/TRANSCRIPT.md` — Human-AI collaboration record

## RCA Documentation

When a major issue is encountered:
1. Create an RCA doc in `/workspace/rca-docs/` named `RCA-YYYY-MM-DD-brief-description.md`
2. Use findings to update this file to prevent recurrence
