---
name: evaluate-lab
description: Run deterministic checks and 4D AI Fluency scoring on a candidate submission
---

Evaluate a candidate's lab submission for attempt $ARGUMENTS:

## Part 1: Deterministic Checks
1. Fetch the candidate's repo state from their Codespace
2. Run task checkers:
   - Task 1 (CSS): Verify flex-direction, align-items, z-index corrections
   - Task 2 (JS): Verify validateForm() exists, no TDZ errors
   - Task 3 (Assets): Verify image src paths match actual files
   - Task 4 (A11y): Count semantic HTML elements, aria attributes, meta tags
3. Store pass/fail results in the `lab_results` table

## Part 2: 4D AI Fluency Scoring
1. Retrieve conversation logs from `/workspace/.exam-logs/conversation.jsonl`
2. Send to Claude API with the 4D rubric (Delegation, Description, Discernment, Diligence)
3. Parse structured response and store in `fluency_scores` table

IMPORTANT: Use `USE_MOCK=true` for development testing. Only call live APIs for explicit E2E runs.
