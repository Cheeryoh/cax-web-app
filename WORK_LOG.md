# CAX Web App — Work Log

Chronological log of what was built, decisions made, blockers hit, and resolutions.

---

## 2026-03-22

### Phase 1: Foundation — COMPLETE

**Completed:**
- [x] Updated CLAUDE.md with dependency rule, API token rule, work log/transcript rule, RCA template
- [x] Created TRANSCRIPT.md with retroactive session 1 notes
- [x] Created WORK_LOG.md
- [x] Created 4 agent files: developer.md, ux-designer.md, qa.md, orchestrator.md
- [x] Created 4 skills: run-qa, provision-env, evaluate-lab, seed-demo
- [x] Initialized Next.js 16.2.1 + TypeScript + TailwindCSS v4 + shadcn/ui v4
- [x] Set up SQLite schema (6 tables: candidates, attempts, mc_answers, lab_results, fluency_scores, environments)
- [x] Created db.ts service, questions.json (5 MC questions), .env.local
- [x] Landing page with build passing
- [x] Directory structure: rca-docs/, specs/, qa-reports/, data/

**Blockers hit:**
1. **node_modules root ownership** — Docker volume created as root. Fix: `sudo chown -R node:node node_modules/`
2. **Corrupted node_modules** — Killed npm install mid-flight, left ENOTEMPTY temp dirs. Fix: `sudo find node_modules -mindepth 1 -delete` + fresh install
3. **shadcn v4 Button API** — Used `asChild` prop from v0/v1 memory. Doesn't exist in v4 (Base UI pattern). Fix: Read generated component code, use plain Tailwind classes on `<Link>`.
4. **NODE_ENV=development during build** — Dev container sets NODE_ENV globally, breaks Next.js production build prerendering. Fix: `"build": "NODE_ENV=production next build"` in package.json.

**Rules updated:**
- Dependency Rule: added step 3 — read generated source file after install before using
- Added "npm in Dev Container" section to CLAUDE.md with volume/ownership/kill guidance
- Created RCA doc: `rca-docs/RCA-2026-03-22-phase1-retrospective.md`

### Phase 2: Auth & Core Pages — COMPLETE

**Completed:**
- [x] AuthService: temp credential gen, bcrypt hashing, in-memory session store, demo seeding
- [x] ExamService: attempt CRUD, MC submission with scoring, attempt summaries, pass/fail logic
- [x] API routes: /api/auth (POST login, GET session, DELETE logout), /api/exam (start/submit_mc/submit_lab/questions/attempts), /api/admin (candidate list + drill-down)
- [x] Landing page (`/`) — hero + "Start Assessment" link
- [x] Exam page (`/exam`) — MC questions → submission → MC result → lab task checklist → submit
- [x] Candidate portal (`/candidate`) — login form (pre-filled demo creds) → attempt history with MC/lab/4D scores
- [x] Admin dashboard (`/admin`) — login form (pre-filled admin creds) → candidate table with scores
- [x] Installed shadcn components: card, input, label, table, badge, separator (read all generated files before use)
- [x] Build passes, dev server responds, auth API returns valid data

**Blockers:**
- JSON import via relative path failed with Turbopack. Fix: switched to fs.readFileSync at runtime (server-only code).

**Dependency Rule compliance:**
- Read shadcn docs (WebFetch) for card, input, table install commands
- Read all 5 generated component files before using them in pages
- No assumed APIs this phase

### Change Request: Visual Redesign + Auth + Admin Review — COMPLETE

**Phase A (Foundation):**
- [x] D1: admin_reviews table + attempts migrations (human_reviewed, final_result)
- [x] D2: Passwords changed (Cand!date2026, Adm!n$ecure2026) + redirectUrl in auth API
- [x] U1: Anthropic brand colors in globals.css (warm beige, terracotta, AA-compliant muted text)
- [x] Q1: Vitest config + 4 unit tests passing + npm run validate pipeline working

**Phase B (Visual + Auth):**
- [x] U2: Source Serif 4 (headings) + Inter (body) + Geist Mono fonts
- [x] U3: AppHeader component with auth check, role badge, logout
- [x] D6: Unified login at `/` with pre-filled creds + demo accounts card
- [x] D7: Removed inline login forms from candidate + admin pages

**Phase C (Review Feature):**
- [x] D3: getAdminReviews, upsertAdminReview, completeReview in exam-service
- [x] D4: Admin API POST handler with Zod validation (submit_review, complete_review)
- [x] Admin review panel UI: expandable rows, per-dimension scoring, comments, pass/fail buttons

**Phase D (Cleanup + Testing):**
- [x] D5: Removed "Deterministic" and "Open-ended" badges from exam tasks
- [x] Q2+Q3: 26 Playwright E2E tests (security, auth flow, exam flow)
- [x] Fixed 3 bugs found by QA:
  - BUG-001: Session store moved from in-memory Map to SQLite (cross-route sharing)
  - BUG-002: AppHeader reading flat user object → fixed to read nested candidate
  - BUG-003: type="email" on login blocking admin username → changed to type="text"
  - Fixed demo card showing wrong admin credentials

**Final state:**
- `npm run validate`: 0 errors, 4 warnings, 4 unit tests pass, build passes
- `npx playwright test`: 26/26 E2E tests pass
- All agents used: Developer (7 tasks), UX Designer (3 tasks), QA (3 tasks + bug discovery)

### Bugfix: Login 500 + Hydration — COMPLETE (partial)

**Fixed:**
- [x] BUG: 500 on login after DB deletion — resilient `getDb()` validates cached connection
- [x] BUG: Hydration mismatch warning — `suppressHydrationWarning` on body + `dynamic` import for AppHeader
- [x] RCA created: `rca-docs/RCA-2026-03-22-login-500-stale-db.md`

**RESOLVED: Playwright auth tests — all 36 tests pass, 0 failures**

Parallel investigation deployed all 4 Alpha/Beta agents simultaneously:
- **Dev Alpha** found the root cause: concurrent `GET /api/auth` race condition. Fix: `AuthProvider` React Context (single fetch, shared state). Removed `dynamic` import wrapper.
- **QA Alpha** rebuilt test infrastructure: Playwright `storageState` with setup project. Found secondary bug: logout test invalidated shared session token.
- **QA Beta** independently found the session invalidation bug. Created isolated `candidate-exam.json` for exam flows.
- **Dev Beta** confirmed the fix was complete.

Key files created/modified:
- `src/lib/auth-context.tsx` (new) — AuthProvider + useAuth() hook
- `src/app/layout.tsx` — wraps with AuthProvider, direct AppHeader import
- `src/components/app-header.tsx` — uses useAuth(), no independent fetch
- `src/app/candidate/page.tsx` — uses useAuth(), no checkAuth()
- `src/app/admin/page.tsx` — uses useAuth(), loadCandidates only when authenticated
- `specs/auth.setup.ts` (new) — 3 auth sessions (candidate, candidate-exam, admin)
- `playwright.config.ts` — setup + project dependency chain
- `specs/auth-flow.spec.ts` — rewritten with storageState
- `specs/exam-flow.spec.ts` — rewritten with isolated session

Final: `npm run validate` passes. `npx playwright test`: 36 passed, 1 skipped, 0 failed. Stable across consecutive runs.

### Phase 3: Exam Flow + Codespace Integration — COMPLETE

- Environment service: GitHub Codespace CRUD via REST API + mock mode
- API routes: /api/environments (POST/GET/DELETE), /api/validation/events (webhook)
- MC questions aligned to template repo (jQuery CVE, analytics, SCSS, Gulp, 4D)
- Exam page: 3 real tasks + dynamic Codespace status + "Open Codespace" link
- Template repo updated: CODESPACE_NAME header in hooks, pushed to GitHub
- Auto-provision Codespace when exam starts (background, non-blocking)

### Phase 4: Broken Repo Template — COMPLETE (pre-existing)

Template repo `Cheeryoh/exam-template-alex-rivera` already had 3 tasks, 7 validation checks.

### Phase 5: Evaluation Engine — COMPLETE

- evaluation-service.ts: deterministic lab scoring + 4D LLM-as-Judge (Claude Haiku)
- Mock mode returns fixed scores; real mode runs validate.js + Anthropic API
- Auto-evaluation fires on lab submission (fire-and-forget)
- /api/evaluate route for admin manual re-evaluation
- Admin "Run Evaluation" / "Re-Evaluate" buttons

### Phase 6: Polish & QA — COMPLETE

**Accessibility fixes (3 bugs found by axe-core):**
- Login page missing `<h1>` heading → added native `<h1>`
- Destructive badge contrast failure (3.62:1) → changed to `bg-destructive text-white` (5.32:1)
- Inline link color contrast failure (2.86:1) → added `--link` variable with darker terracotta

**Test isolation fix:**
- Auth-flow candidate portal test was failing due to shared session with logout test
- Fix: created isolated `candidate-logout.json` session for the logout test

**Security tests added (7 new):**
- /api/evaluate unauthenticated → 401, candidate → 401
- /api/environments without session → 401 (POST, GET, DELETE)
- /api/validation/events without X-Codespace-Name → 401, unknown name → 401

**Final test counts:**
- Unit tests: 22 (auth: 4, environment: 8, evaluation: 10)
- Playwright E2E: 61 passed, 1 skipped (intentional), 0 failures
- Coverage: auth flows, security, exam flow, validation events, accessibility, visual

### Agent Expansion: Parallel Issue Resolution Teams

**Decision:** Expand from 3 agents to 7 agents (+ orchestrator) to enable parallel investigation with diverse approach vectors when issues hit the 3-retry cap.

**New agents created:**
- [x] `developer-alpha.md` — App code investigator
- [x] `developer-beta.md` — Infrastructure investigator
- [x] `qa-alpha.md` — Test approach investigator
- [x] `qa-beta.md` — Environment investigator

**Rationale:** The Playwright auth issue consumed 5+ iterations of the same approach vector (cookie-setting variations). Parallel agents with diverse vectors (app code vs infrastructure vs test approach vs environment) would have resolved it faster.

**Communication:** SendMessage for real-time coordination + filesystem (`/rca-docs/findings/`) for persistent records.
**Isolation:** Worktree isolation per investigation agent — no merge conflicts during exploration.
