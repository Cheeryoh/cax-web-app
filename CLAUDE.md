# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **CAX Web App** development environment. The repository currently contains dev container configuration only — no application source code has been written yet. The project is set up for a full-stack JavaScript/TypeScript web application.

## Development Environment

The project runs in a Docker dev container based on `node:20-bookworm-slim`. The container runs as the `node` user (with passwordless sudo).

**Starting the environment:** Open in VS Code with the Dev Containers extension, or use `devcontainer up`.

**Available tools in container:** git, gh (GitHub CLI), curl, wget, jq, nano, vim, fzf, PowerShell

**npm global installs** go to `/usr/local/share/npm-global` (already on PATH).

## Port Mapping

| Port | Purpose |
|------|---------|
| 3000 | Frontend Dev Server |
| 5173 | Vite Dev Server |
| 5000 | Backend API |
| 8000 | Backend Alt |
| 8080 | App Server |

## Editor Configuration

- Prettier is the default formatter (format-on-save enabled)
- ESLint auto-fix on save
- Tab size: 2 spaces
- Default terminal: PowerShell (`pwsh`)

## Volume Mounts

- `node_modules/` is persisted in a named Docker volume (not on the host filesystem)
- Claude config (`~/.claude`) is persisted in a separate named volume

## Dependency Rule — IMPORTANT

BEFORE installing or using ANY dependency, library, or framework, you MUST:
1. Fetch and read the relevant section of its official documentation (use WebFetch or the docs URL)
2. Verify the API, configuration, and usage patterns match your intended use
3. Do NOT assume APIs, flags, config shapes, or defaults — verify them against the docs

This applies to: npm packages, CLI tools, framework features, Playwright APIs, database drivers, etc.
Do not skip this step. Assumptions are the #1 source of rework. Verify first, implement second.

## API Token Rule — IMPORTANT

When testing or building, NEVER use live API tokens (GitHub PAT, Claude API key) if cached data or mock responses exist.
- Use cached/mocked responses for unit tests, integration tests, and development
- Only use live tokens when performing full end-to-end validation that explicitly requires it
- Store tokens in .env.local (gitignored), never hardcode
- All services must support a `USE_MOCK=true` mode that returns fixture data

## Work Log & Transcript

Maintain two living documents throughout the project:
1. `/workspace/WORK_LOG.md` — Chronological log of what was built, decisions made, blockers hit, and how they were resolved. Updated after each phase/milestone.
2. `/workspace/TRANSCRIPT.md` — Record of human-AI collaboration: key discussions, proposals, decisions, and rationale. Captures the "why" behind choices.

Both files should be updated actively as work progresses.

## RCA Documentation

When a major issue is encountered (build-breaking bug, architecture mistake, dependency conflict, etc.):
1. Create an RCA doc in `/workspace/rca-docs/` using the template below
2. Name format: `RCA-YYYY-MM-DD-brief-description.md`
3. Use findings to update CLAUDE.md rules to prevent recurrence

### RCA Template:
- **Date:** YYYY-MM-DD
- **Severity:** Critical / High / Medium
- **Summary:** One-line description of what happened
- **Timeline:** Sequence of events leading to the issue
- **Root Cause:** The actual underlying cause (not symptoms)
- **Impact:** What was affected, how much time lost
- **Resolution:** What was done to fix it
- **Prevention:** Rule changes or process improvements to prevent recurrence
- **Lessons Learned:** Key takeaways for future work

## Build Commands

```bash
npm run dev          # Start Next.js dev server (port 3000)
npm run build        # Production build
npm run validate     # lint + typecheck + unit tests + build
npm run qa           # validate + Playwright E2E/visual/a11y
```
