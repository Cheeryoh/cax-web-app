---
name: provision-env
description: Spin up a candidate Codespace from the broken-repo template
---

Provision a GitHub Codespace for the candidate specified in $ARGUMENTS:

1. Verify GitHub CLI is authenticated (`gh auth status`)
2. Create a Codespace from the broken-repo template repository
3. Configure the Codespace with the `claude-exam` CLI wrapper
4. Return the Codespace URL and status

Usage: `/provision-env candidate-id`

IMPORTANT: Use `USE_MOCK=true` in development. Only call the real GitHub API for explicit E2E testing.
