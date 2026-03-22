import { NextRequest, NextResponse } from "next/server";
import { getSession, getCandidateById, getAllCandidates } from "@/lib/auth-service";
import { getAttemptsByCandidate, getAttemptSummary, upsertAdminReview, completeReview } from "@/lib/exam-service";
import { z } from "zod";

function getAuthenticatedAdmin(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  const session = getSession(token);
  if (!session) return null;
  const candidate = getCandidateById(session.candidateId);
  if (!candidate || candidate.role !== "admin") return null;
  return candidate;
}

// GET /api/admin — get all candidates and their results
export async function GET(request: NextRequest) {
  const admin = getAuthenticatedAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const candidateId = searchParams.get("candidateId");

  if (candidateId) {
    // Drill-down: specific candidate's attempts
    const candidate = getCandidateById(Number(candidateId));
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    const attempts = getAttemptsByCandidate(candidate.id);
    const summaries = attempts.map((a) => getAttemptSummary(a.id));
    return NextResponse.json({ candidate, attempts: summaries });
  }

  // List all candidates with their latest attempt summary
  const candidates = getAllCandidates();
  const results = candidates.map((c) => {
    const attempts = getAttemptsByCandidate(c.id);
    const latestAttempt = attempts[0];
    const summary = latestAttempt ? getAttemptSummary(latestAttempt.id) : null;
    return {
      candidate: c,
      totalAttempts: attempts.length,
      latestAttempt: summary,
    };
  });

  return NextResponse.json({ candidates: results });
}

export async function POST(request: NextRequest) {
  const admin = getAuthenticatedAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body as { action?: string };

  if (action === "submit_review") {
    const schema = z.object({
      attemptId: z.number(),
      dimension: z.enum(["delegation", "description", "discernment", "diligence"]),
      originalScore: z.number().min(0).max(5),
      adjustedScore: z.number().min(0).max(5),
      weight: z.number().min(0).max(1).default(1.0),
      comment: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const d = parsed.data;
    const review = upsertAdminReview(d.attemptId, admin.id, d.dimension, d.originalScore, d.adjustedScore, d.weight, d.comment ?? null);
    return NextResponse.json({ review });
  }

  if (action === "complete_review") {
    const schema = z.object({
      attemptId: z.number(),
      finalResult: z.enum(["pass", "fail"]),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    completeReview(parsed.data.attemptId, parsed.data.finalResult);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
