import { getDb } from "./db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export interface Candidate {
  id: number;
  username: string;
  display_name: string;
  role: "candidate" | "admin";
  created_at: string;
  active: number;
}

const SALT_ROUNDS = 10;

export async function createCandidate(
  username: string,
  password: string,
  displayName: string,
  role: "candidate" | "admin" = "candidate"
): Promise<Candidate> {
  const db = getDb();
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  db.prepare(
    "INSERT OR IGNORE INTO candidates (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)"
  ).run(username, hash, displayName, role);
  return db
    .prepare("SELECT id, username, display_name, role, created_at, active FROM candidates WHERE username = ?")
    .get(username) as Candidate;
}

export async function validateCredentials(
  username: string,
  password: string
): Promise<Candidate | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM candidates WHERE username = ? AND active = 1")
    .get(username) as (Candidate & { password_hash: string }) | undefined;
  if (!row) return null;
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) return null;
  const { password_hash: _hash, ...candidate } = row;
  return candidate;
}

export function getCandidateById(id: number): Candidate | null {
  const db = getDb();
  return (
    db
      .prepare("SELECT id, username, display_name, role, created_at, active FROM candidates WHERE id = ?")
      .get(id) as Candidate | undefined
  ) ?? null;
}

export function getAllCandidates(): Candidate[] {
  const db = getDb();
  return db
    .prepare("SELECT id, username, display_name, role, created_at, active FROM candidates WHERE role = 'candidate' ORDER BY created_at DESC")
    .all() as Candidate[];
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// SQLite-backed session store (shared across all route workers)
export function createSession(candidateId: number): string {
  const db = getDb();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, candidate_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, candidateId, expiresAt);
  return token;
}

export function getSession(token: string): { candidateId: number } | null {
  const db = getDb();
  const row = db
    .prepare("SELECT candidate_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as { candidate_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { candidateId: row.candidate_id };
}

export function destroySession(token: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Seed demo data
export async function seedDemoData(): Promise<void> {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM candidates WHERE username = ?")
    .get("demo@example.com");
  if (existing) return;

  await createCandidate("demo@example.com", "Cand!date2026", "Demo Candidate", "candidate");
  await createCandidate("admin", "Adm!n$ecure2026", "Administrator", "admin");
}
