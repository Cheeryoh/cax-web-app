import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "cax.db");
const SCHEMA_PATH = path.join(process.cwd(), "src", "lib", "schema.sql");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) {
    // Validate the cached connection still works (DB file may have been deleted)
    try {
      db.pragma("table_info(candidates)");
      return db;
    } catch {
      try { db.close(); } catch { /* ignore close errors */ }
      db = null;
    }
  }

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run schema migrations
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  // Idempotent migrations for columns added after initial schema
  try { db.exec("ALTER TABLE attempts ADD COLUMN human_reviewed INTEGER NOT NULL DEFAULT 0"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE attempts ADD COLUMN final_result TEXT"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE environments ADD COLUMN codespace_name TEXT"); } catch { /* column already exists */ }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
