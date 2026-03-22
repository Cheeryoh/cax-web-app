import { getDb } from "./db";
import fs from "fs";
import path from "path";

export interface Attempt {
  id: number;
  candidate_id: number;
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

export function getQuestions(): Question[] {
  const filePath = path.join(process.cwd(), "data", "questions.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw).questions;
}

export function createAttempt(candidateId: number): Attempt {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO attempts (candidate_id) VALUES (?)")
    .run(candidateId);
  return db
    .prepare("SELECT * FROM attempts WHERE id = ?")
    .get(result.lastInsertRowid) as Attempt;
}

export function getAttempt(attemptId: number): Attempt | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as Attempt | undefined) ?? null;
}

export function getAttemptsByCandidate(candidateId: number): Attempt[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM attempts WHERE candidate_id = ? ORDER BY started_at DESC")
    .all(candidateId) as Attempt[];
}

export function updateAttemptStatus(attemptId: number, status: string): void {
  const db = getDb();
  if (status === "submitted" || status === "evaluated") {
    db.prepare("UPDATE attempts SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, attemptId);
  } else {
    db.prepare("UPDATE attempts SET status = ? WHERE id = ?").run(status, attemptId);
  }
}

export function submitMcAnswers(
  attemptId: number,
  answers: { questionId: string; selectedAnswer: string }[]
): { correct: number; total: number } {
  const db = getDb();
  const questions = getQuestions();
  let correct = 0;

  const insert = db.prepare(
    "INSERT INTO mc_answers (attempt_id, question_id, selected_answer, is_correct) VALUES (?, ?, ?, ?)"
  );

  const insertMany = db.transaction((items: typeof answers) => {
    for (const answer of items) {
      const question = questions.find((q) => q.id === answer.questionId);
      const isCorrect = question?.correctAnswer === answer.selectedAnswer ? 1 : 0;
      if (isCorrect) correct++;
      insert.run(attemptId, answer.questionId, answer.selectedAnswer, isCorrect);
    }
  });

  insertMany(answers);
  return { correct, total: answers.length };
}

export function getMcAnswers(attemptId: number): McAnswer[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM mc_answers WHERE attempt_id = ?")
    .all(attemptId) as McAnswer[];
}

export function getLabResults(attemptId: number): LabResult[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM lab_results WHERE attempt_id = ?")
    .all(attemptId) as LabResult[];
}

export function getFluencyScore(attemptId: number): FluencyScore | null {
  const db = getDb();
  return (
    db
      .prepare("SELECT * FROM fluency_scores WHERE attempt_id = ?")
      .get(attemptId) as FluencyScore | undefined
  ) ?? null;
}

export function getAdminReviews(attemptId: number): AdminReview[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM admin_reviews WHERE attempt_id = ? ORDER BY dimension")
    .all(attemptId) as AdminReview[];
}

export function upsertAdminReview(
  attemptId: number,
  reviewerId: number,
  dimension: string,
  originalScore: number,
  adjustedScore: number,
  weight: number,
  comment: string | null
): AdminReview {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO admin_reviews
      (attempt_id, reviewer_id, dimension, original_score, adjusted_score, weight, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(attemptId, reviewerId, dimension, originalScore, adjustedScore, weight, comment);
  return db
    .prepare("SELECT * FROM admin_reviews WHERE attempt_id = ? AND dimension = ?")
    .get(attemptId, dimension) as AdminReview;
}

export function completeReview(attemptId: number, finalResult: "pass" | "fail"): void {
  const db = getDb();
  db.prepare(
    "UPDATE attempts SET human_reviewed = 1, final_result = ? WHERE id = ?"
  ).run(finalResult, attemptId);
}

export interface AttemptSummary {
  attempt: Attempt;
  mcScore: { correct: number; total: number };
  labResults: LabResult[];
  fluencyScore: FluencyScore | null;
  adminReviews: AdminReview[];
  passed: boolean;
}

export function getAttemptSummary(attemptId: number): AttemptSummary | null {
  const attempt = getAttempt(attemptId);
  if (!attempt) return null;

  const mcAnswers = getMcAnswers(attemptId);
  const mcCorrect = mcAnswers.filter((a) => a.is_correct).length;
  const labResults = getLabResults(attemptId);
  const labPassed = labResults.filter((r) => r.passed).length;
  const fluencyScore = getFluencyScore(attemptId);
  const adminReviews = getAdminReviews(attemptId);

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
