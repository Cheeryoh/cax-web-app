import { getSupabase } from "./supabase";
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
  const supabase = getSupabase();
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  const { data, error } = await supabase
    .from("candidates")
    .upsert(
      { username, password_hash: hash, display_name: displayName, role },
      { onConflict: "username", ignoreDuplicates: true }
    )
    .select("id, username, display_name, role, created_at, active")
    .single();

  if (error) throw new Error(`createCandidate failed: ${error.message}`);
  return data as Candidate;
}

export async function validateCredentials(
  username: string,
  password: string
): Promise<Candidate | null> {
  const supabase = getSupabase();

  const { data: row, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("username", username)
    .eq("active", 1)
    .maybeSingle();

  if (error) throw new Error(`validateCredentials failed: ${error.message}`);
  if (!row) return null;

  const valid = await bcrypt.compare(password, row.password_hash as string);
  if (!valid) return null;

  const { password_hash: _hash, ...candidate } = row as Record<string, unknown>;
  return candidate as unknown as Candidate;
}

export async function getCandidateById(id: number): Promise<Candidate | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("candidates")
    .select("id, username, display_name, role, created_at, active")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getCandidateById failed: ${error.message}`);
  return (data as Candidate | null) ?? null;
}

export async function getAllCandidates(): Promise<Candidate[]> {
  const supabase = getSupabase();

  // Show all users who have at least one attempt, regardless of role
  const { data: attemptRows, error: attemptError } = await supabase
    .from("attempts")
    .select("candidate_id");
  if (attemptError) throw new Error(`getAllCandidates attempts query failed: ${attemptError.message}`);

  const candidateIds = [...new Set((attemptRows ?? []).map((r: { candidate_id: number }) => r.candidate_id))];
  if (candidateIds.length === 0) return [];

  const { data, error } = await supabase
    .from("candidates")
    .select("id, username, display_name, role, created_at, active")
    .in("id", candidateIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getAllCandidates failed: ${error.message}`);
  return (data ?? []) as Candidate[];
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Supabase-backed session store
export async function createSession(candidateId: number): Promise<string> {
  const supabase = getSupabase();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("sessions")
    .insert({ token, candidate_id: candidateId, expires_at: expiresAt });

  if (error) throw new Error(`createSession failed: ${error.message}`);
  return token;
}

export async function getSession(
  token: string
): Promise<{ candidateId: number } | null> {
  const supabase = getSupabase();

  const { data: row, error } = await supabase
    .from("sessions")
    .select("candidate_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error(`getSession failed: ${error.message}`);
  if (!row) return null;

  if (new Date(row.expires_at as string) < new Date()) {
    await supabase.from("sessions").delete().eq("token", token);
    return null;
  }

  return { candidateId: row.candidate_id as number };
}

export async function destroySession(token: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("sessions").delete().eq("token", token);
  if (error) throw new Error(`destroySession failed: ${error.message}`);
}

// Seed a single candidate if it does not already exist.
// createCandidate uses upsert with ignoreDuplicates:true, but .single() would
// error when the row is silently ignored. This wrapper checks first.
async function seedCandidate(
  username: string,
  password: string,
  displayName: string,
  role: "candidate" | "admin" = "candidate"
): Promise<void> {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("candidates")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existing) return;
  await createCandidate(username, password, displayName, role);
}

// Seed demo data
export async function seedDemoData(): Promise<void> {
  // Original accounts — kept for backwards compatibility
  await seedCandidate("demo@example.com", "Cand!date2026", "Demo Candidate", "candidate");
  await seedCandidate("admin", "Adm!n$ecure2026", "Administrator", "admin");

  // Phase 2 — dedicated demo candidates and admin
  await seedCandidate("alex.rivera@cax-demo.com", "C@xAlex2026!", "Alex Rivera", "candidate");
  await seedCandidate("jordan.patel@cax-demo.com", "C@xJordan2026!", "Jordan Patel", "candidate");
  await seedCandidate("sam.nakamura@cax-demo.com", "C@xSam2026!", "Sam Nakamura", "candidate");
  await seedCandidate("admin@cax-demo.com", "Adm!n$ecure2026", "CAX Administrator", "admin");
}
