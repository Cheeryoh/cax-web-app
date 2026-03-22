import { NextRequest, NextResponse } from "next/server";
import { getSession, getCandidateById } from "@/lib/auth-service";
import { getAttempt } from "@/lib/exam-service";
import { runFullEvaluation } from "@/lib/evaluation-service";
import { z } from "zod";

async function getAuthenticatedAdmin(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  const session = await getSession(token);
  if (!session) return null;
  const candidate = await getCandidateById(session.candidateId);
  if (!candidate || candidate.role !== "admin") return null;
  return candidate;
}

const EvaluateSchema = z.object({
  attemptId: z.number(),
});

// POST /api/evaluate — trigger evaluation for a submitted attempt
export async function POST(request: NextRequest) {
  const admin = await getAuthenticatedAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = EvaluateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { attemptId } = parsed.data;

  const attempt = await getAttempt(attemptId);
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  if (attempt.status !== "submitted" && attempt.status !== "evaluated") {
    return NextResponse.json(
      {
        error: "Attempt must be in 'submitted' or 'evaluated' status to trigger evaluation",
        currentStatus: attempt.status,
      },
      { status: 422 }
    );
  }

  // Fire-and-forget: evaluation runs asynchronously
  runFullEvaluation(attemptId).catch((err) => {
    console.error(
      `POST /api/evaluate: runFullEvaluation failed for attempt ${attemptId}:`,
      err instanceof Error ? err.message : String(err)
    );
  });

  return NextResponse.json({ status: "evaluation_started" });
}
