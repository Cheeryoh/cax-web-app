# CAX Web App — Collaboration Transcript

This document records the human-AI collaboration throughout the project. It captures key discussions, proposals, decisions, and the rationale behind choices.

---

## Session 1 — 2026-03-22: Initial Planning & Architecture

### User Request
Build a demo candidate assessment experience (CAX) that evaluates Claude Code proficiency. Two parts: multiple-choice questions + performance lab with a broken repo. Needs candidate portal, admin dashboard, evaluation engine (deterministic + AI Fluency via 4D framework), and a team of specialized agents to build it.

### Architecture Proposals
Three options were proposed:
1. **Option A: Next.js Monolith** — Single Next.js 14 app with App Router, API routes, SQLite. Fastest to build.
2. **Option B: React SPA + Express API** — Vite React frontend + Express backend. Clean separation but more boilerplate.
3. **Option C: Astro + Hono** — Astro SSR with React islands + Hono micro-API. Modern but less familiar.

**Decision:** Option A (Next.js Monolith) — fastest path to a working demo.

### Lab Environment Discussion
User clarified that candidates need real virtual environments with provisional email accounts. Options discussed:
- Docker containers (local)
- Cloud VMs
- GitHub Codespaces / Devcontainers
- Simulated/mock

**Decision:** GitHub Codespaces using user's personal GitHub account + PAT. Candidates get auto-generated temp credentials (e.g., bob-exam-candidate-1@example.com).

### Key Optimization: Provision During MC
User identified that environments don't need to be ready immediately — they should start spinning up while the candidate takes the MC portion. This hides the 30-90s provisioning latency.

### 4D Scoring Approach
Options: LLM-as-Judge, heuristic rules, or hybrid.
**Decision:** LLM-as-Judge for demo (Claude API). Long-term plan is hybrid heuristic+LLM to reduce cost.

### Conversation Log Capture
Options for capturing candidate-Claude interactions:
- Parse Claude Code's native logs (risky — undocumented format)
- Custom CLI wrapper (full control)
- Hook-based logging (limited to tool events)
- Git-based inference (misses non-code interactions)

**Decision:** Custom CLI wrapper (`claude-exam`) that tees all conversations to structured JSONL.

### Agent Team Design
Initial plan: 3 agents (developer, tester, UX). User raised concern about testing iteration loops (12+ iterations to fix fixtures).

Redesigned to 4 agents with automated visual validation:
1. **developer.md** — Full-stack builder with mandatory build gate
2. **ux-designer.md** — Design system + visual specs as Playwright tests
3. **qa.md** — Full validation pipeline (lint → typecheck → unit → build → E2E → visual → a11y)
4. **orchestrator.md** — Workflow coordinator with 3-retry cap and failure routing

Key innovation: UX agent writes Playwright specs (executable acceptance criteria) BEFORE developer implements. QA runs them. No human ever opens localhost.

### Best Practices Integration
Reviewed Claude Code best practices from code.claude.com/docs/en/best-practices. Key patterns incorporated:
- "Give Claude a way to verify its work" → every agent has verification gates
- "Explore first, then plan, then code" → orchestrator enforces this sequence
- "Manage context aggressively" → scoped agent contexts, /clear between tasks
- "CLAUDE.md should be concise" → only non-inferable info
- "Hooks for deterministic actions" → lint/format/typecheck on edit
- "Skills for reusable workflows" → run-qa, provision-env, evaluate-lab, seed-demo

### Rules Added
1. **Dependency Rule:** Always read official docs before using any dependency. Never assume APIs.
2. **API Token Rule:** Never use live tokens when cached/mock data exists. All services support USE_MOCK=true.
3. **RCA Documentation:** Major issues get formal RCA docs in `/workspace/rca-docs/`. Findings feed back into CLAUDE.md rules.

### SWOT Analysis
Confidence assessment per phase:
| Phase | Confidence | Top Risk |
|-------|-----------|----------|
| 1: Foundation | 95% | Playwright in slim container |
| 2: Auth & Pages | 90% | Next.js App Router auth quirks |
| 3: Exam Flow | 75% | Codespace provisioning latency |
| 4: Broken Repo | 92% | Task 4 difficulty calibration |
| 5: Evaluation | 80% | Log format parsing |
| 6: Polish & QA | 85% | E2E depends on all prior phases |

Overall confidence: ~85% after risk mitigations.

---

## Session 2 — 2026-03-22: Phase 2 Retrospective

### User Request
"Reflect on phase 2. Let me know what each agent did at a high level. Suggest improvements if any. Update CLAUDE.md. Purge any rules that might no longer be relevant."

### Agent Performance in Phase 2

| Agent | Planned Role | Actual Role |
|-------|-------------|-------------|
| Developer | Build pages, services, API routes | Done — but by the conductor (me), not as a spawned subagent |
| UX Designer | Write Playwright specs BEFORE implementation | Not used. Zero specs written. |
| QA | Run full validation pipeline | Not used. Only `npm run build` was run. |
| Orchestrator | Enforce spec→implement→verify cycle | Not used. Conductor did everything monolithically. |

### Root Cause
Speed over process. Building everything directly was faster for Phase 2 scope. But this means:
- No visual specs exist as acceptance criteria
- No Playwright tests validate the UI
- No structured QA report was generated
- The spec-first workflow was completely bypassed

### CLAUDE.md Changes Made
**Purged:**
- Project Overview saying "no application source code has been written yet" (outdated)
- Port mappings for 5173, 5000, 8000, 8080 (we only use 3000)
- Editor Configuration section (inferable from .devcontainer/devcontainer.json)
- Volume Mounts section (covered by npm section)
- Full RCA template (kept reference, template is in the rca-docs folder itself)

**Added:**
- Tech Stack section with verified versions (Next.js 16.2.1, TailwindCSS v4, shadcn/ui v4)
- shadcn/ui v4 section documenting Base UI patterns (no asChild, use render prop)

**Updated:**
- All agent files: "Next.js 14" → "Next.js 16"

### Improvement Suggestions for Phase 3+
1. Actually spawn agents for their designated tasks
2. Install Playwright + Chromium before Phase 3 (should have been Phase 1)
3. Write at least basic Playwright specs for existing pages before building more
4. Run `npm run validate` (not just `npm run build`) — requires at least one vitest test file

---

## Session 3 — 2026-03-22: Change Request + Parallel Investigation

### Change Request
User inspected the running app and requested 5 changes:
1. Anthropic brand visual redesign (warm beige/terracotta, serif headings, light theme)
2. Unified login/logout with role-based routing and stronger passwords
3. Full 4D rubric display in admin dashboard (not just average)
4. Human-in-the-loop review (admin comments, score adjustments, final pass/fail only after human sign-off)
5. Remove "Deterministic"/"Open-ended" task type labels from exam

### Quality Over Speed Shift
User explicitly stated: "I want to focus on quality, rather than speed moving forward. Quality and reliability of output matter now, most." This became the guiding principle for all subsequent work.

### Agent Team Actually Used
For the first time, all agents were spawned via the Agent tool:
- **Developer** — Schema migrations, auth service, API endpoints, admin review panel, login page
- **UX Designer** — Anthropic brand colors (globals.css), typography (Source Serif 4 + Inter), AppHeader component design
- **QA** — Vitest pipeline setup (4 unit tests), security tests (10 API tests), E2E specs (auth flow, exam flow)
- All ran `npm run validate` after each task

### The Playwright Auth Crisis (6 failing tests)
QA found 3 real bugs:
- BUG-001: In-memory session store not shared across Next.js production route workers → moved to SQLite
- BUG-002: AppHeader read flat user object but API returns nested `candidate` → fixed
- BUG-003: `type="email"` on login input blocked admin username "admin" → changed to `type="text"`

But after fixing those, 6 tests still failed — all involving authenticated page rendering in production mode. The conductor (me) spent 5+ iterations trying variations of cookie-setting in Playwright, violating the 3-retry cap.

### Parallel Investigation Deployment
User approved expanding to 8 agents (4 original + 4 Alpha/Beta investigators). All 4 deployed simultaneously in worktree isolation:

| Agent | Vector | Finding |
|-------|--------|---------|
| **Dev Alpha** | App code | ROOT CAUSE: Two concurrent `GET /api/auth` fetches (AppHeader + page component) caused production-mode race condition. **Fix: AuthProvider React Context** — single fetch, shared state. |
| **QA Alpha** | Test approach | Rebuilt test infrastructure with Playwright `storageState` + setup project. Found secondary bug: logout test invalidated shared session token. |
| **QA Beta** | Environment | Independently found the session invalidation bug. Created isolated `candidate-exam.json` for exam flows. Proved production mode was NOT the issue. |
| **Dev Beta** | Infrastructure | Confirmed fix was complete. Validated all 39 tests pass. |

**Result:** 42 Playwright tests passing, 0 failures. The parallel approach resolved in one round what sequential attempts couldn't in five.

### Base UI Button `type="button"` Bug
After the parallel investigation fix, user tested the app and Sign In button didn't work. Root cause: Base UI's `useButton` hook explicitly sets `type="button"` on native buttons, preventing form submission. No test clicked the actual button — all used API shortcuts.

**Fix:** Native `<button type="submit">` with Tailwind classes instead of shadcn `<Button>`.
**Rule added:** UI Coverage Rule — every form must have at least one E2E test that clicks the actual button.
**Rule added:** Dependency Rule step 4 — when a wrapper wraps a primitive, read the primitive's source too.

### CLAUDE.md Evolution
Rules added through this session:
- Auth Pattern (single AuthProvider, never duplicate fetches)
- Playwright Test Isolation (isolated storageState per test project)
- Playwright UI Coverage Rule (test actual user interactions, not just API shortcuts)
- Debugging Test Failures (verify app independently before changing tests)
- Phase Completion Rule step 6 (run `npm run qa` against clean state)
- Dependency Rule step 4 (read primitive source, not just wrapper)
- shadcn v4: Base UI Button sets `type="button"` — use native button for form submit

### Commit Checkpoint
All work committed at `44b1086`: 69 files, 7,519 lines. Full platform through Phase 2 + change request.

---

## Session 4 — 2026-03-22: Phase 3 — Exam Flow + Codespace Integration

### Pre-Phase 3 Alignment
User answered 4 clarifying questions:
1. **Commit first:** Yes, create checkpoint before Phase 3
2. **Fix login test debt:** Yes, write UI interaction test now
3. **Codespaces:** Real integration (not mock)
4. **Process:** Judgment call per feature (full ceremony for complex, lighter for simple)

### GitHub Auth + Template Repo
- Authenticated as `Cheeryoh` with `codespace` + `repo` scopes
- Template repo: `Cheeryoh/exam-template-alex-rivera` — Bootstrap 4 + SCSS + Gulp resume site
- 3 tasks (7 validation checks): jQuery CVE, dead analytics, brand color consistency
- Built-in validator: `node tests/validate.js`
- Claude Code hooks POST events to `${SUBMIT_ENDPOINT}/api/validation/events`

### Concurrent Codespace Identity Architecture
GitHub API doesn't support per-Codespace env vars at creation. Solution for 4 concurrent demo users:
- `SUBMIT_ENDPOINT` — repo-level Codespace secret (same for all)
- `CODESPACE_NAME` — built-in GitHub env var (unique per Codespace)
- Identity flow: CAX app creates Codespace → stores `codespace_name` in DB → template hooks send `CODESPACE_NAME` header → CAX maps to attempt

### Phase 3 Implementation (8 tasks)
1. Schema: `validation_events` table + `codespace_name` column on environments
2. Environment service: GitHub Codespace CRUD via REST API + mock mode
3. API routes: `/api/environments` (POST/GET/DELETE) + `/api/validation/events` (webhook)
4. MC questions: Replaced 5 Claude Code general questions with 5 aligned to template repo
5. Exam page UI: 3 real tasks + dynamic Codespace status + "Open Codespace" link
6. Exam API: Auto-provision Codespace on exam start (non-blocking)
7. Template repo: Updated hooks to send `CODESPACE_NAME` header, pushed to GitHub
8. Tests: Pending (QA agent next)
