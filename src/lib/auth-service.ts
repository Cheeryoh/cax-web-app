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

  const { data, error } = await supabase
    .from("candidates")
    .select("id, username, display_name, role, created_at, active")
    .eq("role", "candidate")
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

// Seed demo data
export async function seedDemoData(): Promise<void> {
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from("candidates")
    .select("id")
    .eq("username", "demo@example.com")
    .maybeSingle();

  if (existing) return;

  await createCandidate("demo@example.com", "Cand!date2026", "Demo Candidate", "candidate");
  await createCandidate("admin", "Adm!n$ecure2026", "Administrator", "admin");
}
