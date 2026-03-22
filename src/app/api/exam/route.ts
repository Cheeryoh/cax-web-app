import { NextRequest, NextResponse } from "next/server";
import { getSession, getCandidateById } from "@/lib/auth-service";
import {
  createAttempt,
  getQuestions,
  submitMcAnswers,
  updateAttemptStatus,
  getAttemptsByCandidate,
  getAttemptSummary,
} from "@/lib/exam-service";
import { createEnvironment } from "@/lib/environment-service";
import { runFullEvaluation } from "@/lib/evaluation-service";

async function getAuthenticatedCandidate(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  const session = await getSession(token);
  if (!session) return null;
  return getCandidateById(session.candidateId);
}

// GET /api/exam — get questions or attempt history
export async function GET(request: NextRequest) {
  const candidate = await getAuthenticatedCandidate(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "questions") {
    // Return questions without correct answers
    const questions = getQuestions().map(({ correctAnswer: _unused, ...q }) => q);
    return NextResponse.json({ questions });
  }

  if (action === "attempts") {
    const attempts = await getAttemptsByCandidate(candidate.id);
    const summaries = await Promise.all(attempts.map((a) => getAttemptSummary(a.id)));
    return NextResponse.json({ attempts: summaries });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// POST /api/exam — create attempt or submit answers
export async function POST(request: NextRequest) {
  const candidate = await getAuthenticatedCandidate(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (action === "start") {
    const attempt = await createAttempt(candidate.id);
    const env = await createEnvironment(attempt.id).catch(() => null);
    return NextResponse.json({ attempt, environment: env });
  }

  if (action === "submit_mc") {
    const { attemptId, answers } = body;
    if (!attemptId || !answers) {
      return NextResponse.json({ error: "Missing attemptId or answers" }, { status: 400 });
    }
    const result = await submitMcAnswers(attemptId, answers);
    await updateAttemptStatus(attemptId, "mc_completed");
    return NextResponse.json({ result });
  }

  if (action === "submit_lab") {
    const { attemptId } = body;
    if (!attemptId) {
      return NextResponse.json({ error: "Missing attemptId" }, { status: 400 });
    }
    await updateAttemptStatus(attemptId, "submitted");
    // Fire-and-forget: run evaluation asynchronously after submission
    runFullEvaluation(attemptId).catch((err) =>
      console.error("Auto-evaluation failed:", err)
    );
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
