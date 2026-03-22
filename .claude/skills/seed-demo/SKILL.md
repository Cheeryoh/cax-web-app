---
name: seed-demo
description: Reset the database and create demo candidate with pre-loaded credentials
---

Reset the CAX database to a clean demo state:

1. Drop and recreate all tables using the schema in `src/lib/schema.sql`
2. Create a demo candidate:
   - Username: `demo-candidate-1@example.com`
   - Password: `demo123` (hashed with bcrypt)
   - Display name: `Demo Candidate`
3. Create the admin account:
   - Username: `admin`
   - Password: `admin` (hashed with bcrypt)
4. Optionally seed sample attempt data for UI development (past attempts with scores)
5. Report the credentials created

Run with: `/seed-demo`
