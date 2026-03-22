- **Date:** 2026-03-22
- **Severity:** Critical
- **Summary:** Login returns 500 Internal Server Error after deleting cax.db while dev server is running
- **Timeline:**
  1. Dev server running with cax.db initialized
  2. `rm -f data/cax.db` executed to reset seed data (passwords changed)
  3. Dev server still holds a cached `db` singleton pointing to the deleted file
  4. Next request to POST /api/auth calls `getDb()` which returns the stale cached connection
  5. `seedDemoData()` queries `candidates` table → "no such table" error
- **Root Cause:** `getDb()` caches the SQLite connection as a module-level singleton and never validates the connection is still viable. When the DB file is deleted externally, the cached connection becomes invalid but the null check passes.
- **Impact:** Complete login failure. All authenticated features blocked. User-facing 500 error.
- **Resolution:** Made `getDb()` validate the cached connection by running `db.pragma('table_info(candidates)')` before returning. On failure, closes the stale connection and re-initializes.
- **Prevention:**
  1. CLAUDE.md rule: "After deleting data/cax.db, restart the dev server"
  2. Resilient `getDb()` that self-heals on stale connections
  3. QA gap: Playwright tests run against fresh `next start` processes, so stale-connection bugs are never exercised. Consider adding a test that deletes the DB mid-session.
- **Lessons Learned:** Module-level singletons in Next.js are fragile — they work in production (single process) but can become stale in development (hot reload, file deletion). Always validate cached external resources before using them.
