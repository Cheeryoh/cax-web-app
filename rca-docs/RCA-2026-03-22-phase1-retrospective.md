# Phase 1 Retrospective & Self-Assessment

- **Date:** 2026-03-22
- **Severity:** Medium (no data loss, but significant time wasted)
- **Summary:** Multiple avoidable issues during Phase 1 foundation setup due to violating our own rules

---

## Issue 1: Corrupted node_modules from killed npm process

- **Timeline:** Ran `npm install -D vitest ...` → process appeared hung → killed it → node_modules left in corrupted state with partial `.xyz-XXXXX` temp directories → subsequent installs failed with ENOTEMPTY
- **Root Cause:** Killed a running npm install prematurely. npm renames packages to temp dirs during install; killing mid-rename leaves half-moved directories.
- **Impact:** ~5 minutes of debugging ENOTEMPTY errors, required full `sudo find node_modules -mindepth 1 -delete` to recover.
- **Prevention:** **Never kill npm install mid-flight.** If it appears hung, check if packages are actually being written (`ls node_modules/<pkg>`) before killing. Use `--no-audit --no-fund` from the start to avoid the audit phase that looks like a hang.
- **Rule to add:** When running npm install, always use `--no-audit --no-fund` flags in this dev container to avoid misleading "hung" behavior.

## Issue 2: node_modules owned by root

- **Timeline:** Docker volume mount created `node_modules/` owned by `root:root` → npm install as `node` user failed with EACCES
- **Root Cause:** Docker named volume was initialized before the container's `node` user existed, so it defaulted to root ownership.
- **Impact:** ~2 minutes. Quick fix with `sudo chown`.
- **Prevention:** Already documented in CLAUDE.md that node_modules is a Docker volume. Should note the ownership issue.
- **Rule to add:** After any `node_modules` wipe, verify ownership with `ls -la node_modules/` before running npm install.

## Issue 3: Violated the Dependency Rule — shadcn/ui v4 API

- **Timeline:** Used `asChild` prop on shadcn Button component → build failed with type error → `asChild` doesn't exist in shadcn v4 (it migrated to Base UI's `render` prop pattern)
- **Root Cause:** **Assumed the shadcn/ui API from memory (v0.x/v1.x patterns) instead of reading the generated component code first.** This is exactly what the Dependency Rule was written to prevent.
- **Impact:** ~3 minutes to diagnose and fix.
- **Prevention:** The Dependency Rule says "verify the API, configuration, and usage patterns match your intended use." I verified the *install command* via WebFetch but did NOT verify the *component API* before using it. Reading the generated `button.tsx` file before writing the landing page would have caught this instantly.
- **Lesson:** The Dependency Rule applies to *usage*, not just *installation*. After installing a package, read the generated/installed code before using it in application code.

## Issue 4: NODE_ENV=development during build

- **Timeline:** `npm run build` failed with `useContext` null error during prerendering → spent time investigating global-error.tsx → the real issue was `NODE_ENV=development` set by the dev container
- **Root Cause:** The dev container sets `NODE_ENV=development` globally. Next.js build expects `NODE_ENV=production`. The non-standard NODE_ENV warning was in the output but I initially focused on the `useContext` error instead.
- **Impact:** ~5 minutes chasing the wrong root cause (global-error.tsx) before noticing the NODE_ENV warning.
- **Prevention:** Read ALL warning/error messages in build output, not just the final error. The `NODE_ENV` warning appeared at the top.
- **Rule to add:** Build script should explicitly set `NODE_ENV=production`. (Already fixed: `"build": "NODE_ENV=production next build"`)

## Issue 5: Plan said "Next.js 14" but latest is 16

- **Timeline:** Plan locked "Next.js 14 (App Router)" but `create-next-app@latest` installed Next.js 16.2.1. Proceeded without flagging the version mismatch.
- **Root Cause:** Did not pin the version in the create command. The plan should have been updated when the WebFetch of Next.js docs revealed v16.2.1.
- **Impact:** Low — Next.js 16 is backwards-compatible and actually better. But the plan is now inaccurate.
- **Prevention:** When a dependency version differs from the plan, update the plan BEFORE proceeding.

---

## Scorecard Against Our Rules

| Rule | Followed? | Notes |
|------|-----------|-------|
| Dependency Rule (read docs before use) | Partial | Read install docs but NOT component API docs. Violated on shadcn Button usage. |
| API Token Rule | Yes | USE_MOCK=true from the start, no live tokens used. |
| Work Log & Transcript | Yes | Both created with retroactive content. |
| RCA Documentation | Yes | This document. |
| "Verify first, implement second" | Partial | Verified install commands but not runtime APIs. |
| Build gate before declaring done | Yes | Caught all issues via build before declaring Phase 1 complete. |

---

## Process Improvements for Phase 2

1. **After installing any package, `Read` its main exported file before using it in code.** For shadcn components: read the generated `.tsx` file. For npm packages: read the type definitions or main export.
2. **Always use `--no-audit --no-fund` for npm install in this container** to avoid the audit phase appearing as a hang.
3. **Read ALL build output, not just the last error.** Warnings at the top often explain errors at the bottom.
4. **When dependency versions diverge from the plan, update the plan immediately.**
5. **Never kill npm install mid-flight.** Wait for it or use background + check for package existence.
