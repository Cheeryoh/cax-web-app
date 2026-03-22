---
name: run-qa
description: Execute the full QA validation pipeline and report results
---

Run the full QA pipeline for the CAX Web App:

1. Run `npm run qa` which executes: lint → typecheck → unit tests → build → Playwright E2E/visual/a11y
2. Read the output and write structured results to `/workspace/qa-reports/latest.json`
3. Report a summary: total pass/fail counts per category, and list all failures with file paths and error messages
4. If there are failures, categorize them (lint, type, unit, build, e2e, visual, a11y) for routing

If `npm run qa` is not yet configured, report what's missing and suggest the setup steps.
