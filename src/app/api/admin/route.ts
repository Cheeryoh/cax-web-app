import { NextRequest, NextResponse } from "next/server";
import { getSession, getCandidateById, getAllCandidates } from "@/lib/auth-service";
import { getAttemptsByCandidate, getAttemptSummary } from "@/lib/exam-service";
import { getSupabase } from "@/lib/supabase";
import { z } from "zod";

import { submitAdminTaskReview, requestLlmReEvaluation, checkAndFinalizeAttempt } from "@/lib/evaluation-service";

async function getAuthenticatedAdmin(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  const session = await getSession(token);
  if (!session) return null;
  const candidate = await getCandidateById(session.candidateId);
  if (!candidate || candidate.role !== "admin") return null;
  return candidate;
}

// GET /api/admin — get all candidates and their results
export async function GET(request: NextRequest) {
  const admin = await getAuthenticatedAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const candidateId = searchParams.get("candidateId");

  if (candidateId) {
    // Drill-down: specific candidate's attempts
    const candidate = await getCandidateById(Number(candidateId));
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    const attempts = await getAttemptsByCandidate(candidate.id);
    const summaries = await Promise.all(attempts.map((a) => getAttemptSummary(a.id)));
    return NextResponse.json({ candidate, attempts: summaries });
  }

  // List all candidates with their latest attempt summary
  const candidates = await getAllCandidates();
  const results = await Promise.all(
    candidates.map(async (c) => {
      const attempts = await getAttemptsByCandidate(c.id);
      const latestAttempt = attempts[0];
      const summary = latestAttempt ? await getAttemptSummary(latestAttempt.id) : null;
      return {
        candidate: c,
        totalAttempts: attempts.length,
        latestAttempt: summary,
      };
    })
  );

  return NextResponse.json({ candidates: results });
}

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

  const { action } = body as { action?: string };

  if (action === "get_task_evaluations") {
    const schema = z.object({ attemptId: z.number() });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { attemptId } = parsed.data;
    const supabase = getSupabase();

    const { data: evaluations, error: evalError } = await supabase
      .from("task_evaluations")
      .select("*")
      .eq("attempt_id", attemptId);
    if (evalError) {
      return NextResponse.json({ error: evalError.message }, { status: 500 });
    }

    const evalIds = (evaluations ?? []).map((e: { id: number }) => e.id);
    let dialogue: unknown[] = [];
    if (evalIds.length > 0) {
      const { data: dialogueRows, error: dialogueError } = await supabase
        .from("evaluation_dialogue")
        .select("*")
        .in("task_evaluation_id", evalIds);
      if (dialogueError) {
        return NextResponse.json({ error: dialogueError.message }, { status: 500 });
      }
      dialogue = dialogueRows ?? [];
    }

    return NextResponse.json({ evaluations: evaluations ?? [], dialogue });
  }

  if (action === "get_task_events") {
    const schema = z.object({ attemptId: z.number(), taskId: z.string() });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { attemptId, taskId } = parsed.data;
    const supabase = getSupabase();

    const { data: events, error: eventsError } = await supabase
      .from("validation_events")
      .select("*")
      .eq("attempt_id", attemptId)
      .eq("task_id", taskId);
    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    return NextResponse.json({ events: events ?? [] });
  }

  if (action === "submit_task_review") {
    const schema = z.object({
      taskEvaluationId: z.number(),
      reviewAction: z.enum(["confirm", "provide_context"]),
      comment: z.string(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    await submitAdminTaskReview(
      parsed.data.taskEvaluationId,
      parsed.data.reviewAction,
      parsed.data.comment,
      admin.id
    );
    return NextResponse.json({ success: true });
  }

  if (action === "request_reevaluation") {
    const schema = z.object({ taskEvaluationId: z.number() });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    await requestLlmReEvaluation(parsed.data.taskEvaluationId);
    return NextResponse.json({ success: true });
  }

  if (action === "check_finalization") {
    const schema = z.object({ attemptId: z.number() });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const result = await checkAndFinalizeAttempt(parsed.data.attemptId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
