import { getSupabase } from "./supabase";
import fs from "fs";
import path from "path";

export interface Attempt {
  id: number;
  candidate_id: number;
  exam_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  environment_id: number | null;
  human_reviewed: number;
  final_result: string | null;
}

export interface McAnswer {
  id: number;
  attempt_id: number;
  question_id: string;
  selected_answer: string;
  is_correct: number;
}

export interface LabResult {
  id: number;
  attempt_id: number;
  task_id: string;
  passed: number;
  details_json: string | null;
}

export interface FluencyScore {
  id: number;
  attempt_id: number;
  delegation: number | null;
  description: number | null;
  discernment: number | null;
  diligence: number | null;
  raw_analysis: string | null;
  scored_at: string;
}

export interface AdminReview {
  id: number;
  attempt_id: number;
  reviewer_id: number;
  dimension: string;
  original_score: number;
  adjusted_score: number;
  weight: number;
  comment: string | null;
  reviewed_at: string;
}

export interface Question {
  id: string;
  text: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
}

// Reads local JSON file — stays synchronous, no DB involved
export function getQuestions(): Question[] {
  const filePath = path.join(process.cwd(), "data", "questions.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw).questions;
}

async function generateExamId(): Promise<string> {
  const supabase = getSupabase();
  const year = new Date().getFullYear();
  const prefix = `EX-${year}-`;
  const { count, error } = await supabase
    .from("attempts")
    .select("*", { count: "exact", head: true })
    .like("exam_id", `${prefix}%`);
  if (error) throw new Error(`generateExamId failed: ${error.message}`);
  const seq = String((count ?? 0) + 1).padStart(3, "0");
  return `${prefix}${seq}`;
}

export async function createAttempt(candidateId: number): Promise<Attempt> {
  const supabase = getSupabase();
  const examId = await generateExamId();

  const { data, error } = await supabase
    .from("attempts")
    .insert({ candidate_id: candidateId, exam_id: examId })
    .select()
    .single();

  if (error) throw new Error(`createAttempt failed: ${error.message}`);
  return data as Attempt;
}

export async function getAttempt(attemptId: number): Promise<Attempt | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`getAttempt failed: ${error.message}`);
  return (data as Attempt | null) ?? null;
}

export async function getAttemptsByCandidate(
  candidateId: number
): Promise<Attempt[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("attempts")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(`getAttemptsByCandidate failed: ${error.message}`);
  return (data ?? []) as Attempt[];
}

export async function updateAttemptStatus(
  attemptId: number,
  status: string
): Promise<void> {
  const supabase = getSupabase();

  const updateData: Record<string, unknown> = { status };
  if (status === "submitted" || status === "evaluated") {
    updateData.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("attempts")
    .update(updateData)
    .eq("id", attemptId);

  if (error) throw new Error(`updateAttemptStatus failed: ${error.message}`);
}

export async function submitMcAnswers(
  attemptId: number,
  answers: { questionId: string; selectedAnswer: string }[]
): Promise<{ correct: number; total: number }> {
  const supabase = getSupabase();
  const questions = getQuestions();
  let correct = 0;

  const rows = answers.map((answer) => {
    const question = questions.find((q) => q.id === answer.questionId);
    const isCorrect = question?.correctAnswer === answer.selectedAnswer ? 1 : 0;
    if (isCorrect) correct++;
    return {
      attempt_id: attemptId,
      question_id: answer.questionId,
      selected_answer: answer.selectedAnswer,
      is_correct: isCorrect,
    };
  });

  const { error } = await supabase.from("mc_answers").insert(rows);
  if (error) throw new Error(`submitMcAnswers failed: ${error.message}`);

  return { correct, total: answers.length };
}

export async function getMcAnswers(attemptId: number): Promise<McAnswer[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("mc_answers")
    .select("*")
    .eq("attempt_id", attemptId);

  if (error) throw new Error(`getMcAnswers failed: ${error.message}`);
  return (data ?? []) as McAnswer[];
}

export async function getLabResults(attemptId: number): Promise<LabResult[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("lab_results")
    .select("*")
    .eq("attempt_id", attemptId);

  if (error) throw new Error(`getLabResults failed: ${error.message}`);
  return (data ?? []) as LabResult[];
}

export async function getFluencyScore(
  attemptId: number
): Promise<FluencyScore | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("fluency_scores")
    .select("*")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`getFluencyScore failed: ${error.message}`);
  return (data as FluencyScore | null) ?? null;
}

export async function getAdminReviews(
  attemptId: number
): Promise<AdminReview[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("admin_reviews")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("dimension", { ascending: true });

  if (error) throw new Error(`getAdminReviews failed: ${error.message}`);
  return (data ?? []) as AdminReview[];
}

export interface AttemptSummary {
  attempt: Attempt;
  mcScore: { correct: number; total: number };
  labResults: LabResult[];
  fluencyScore: FluencyScore | null;
  adminReviews: AdminReview[];
  passed: boolean;
}

export async function getAttemptSummary(
  attemptId: number
): Promise<AttemptSummary | null> {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return null;

  const mcAnswers = await getMcAnswers(attemptId);
  const mcCorrect = mcAnswers.filter((a) => a.is_correct).length;
  const labResults = await getLabResults(attemptId);
  const labPassed = labResults.filter((r) => r.passed).length;
  const fluencyScore = await getFluencyScore(attemptId);
  const adminReviews = await getAdminReviews(attemptId);

  const fluencyAvg = fluencyScore
    ? ((fluencyScore.delegation ?? 0) +
        (fluencyScore.description ?? 0) +
        (fluencyScore.discernment ?? 0) +
        (fluencyScore.diligence ?? 0)) /
      4
    : 0;

  const passed =
    attempt.human_reviewed === 1
      ? attempt.final_result === "pass"
      : mcCorrect >= 3 && labPassed >= 3 && fluencyAvg >= 3.0;

  return {
    attempt,
    mcScore: { correct: mcCorrect, total: mcAnswers.length || 5 },
    labResults,
    fluencyScore,
    adminReviews,
    passed,
  };
}
