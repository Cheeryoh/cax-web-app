import { NextRequest, NextResponse } from "next/server";
import { getSession, getCandidateById } from "@/lib/auth-service";
import {
  createEnvironment,
  getEnvironmentByAttempt,
  pollEnvironmentStatus,
  destroyEnvironment,
} from "@/lib/environment-service";
import { z } from "zod";

async function getAuthenticatedCandidate(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  const session = await getSession(token);
  if (!session) return null;
  return getCandidateById(session.candidateId);
}

// POST /api/environments — create a Codespace for an attempt
export async function POST(request: NextRequest) {
  const candidate = await getAuthenticatedCandidate(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const schema = z.object({ attemptId: z.number() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const environment = await createEnvironment(parsed.data.attemptId);
  return NextResponse.json({ environment });
}

// GET /api/environments?attemptId=<n> — poll environment status
export async function GET(request: NextRequest) {
  const candidate = await getAuthenticatedCandidate(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("attemptId");
  const attemptId = raw ? parseInt(raw, 10) : NaN;
  if (isNaN(attemptId)) {
    return NextResponse.json({ error: "Missing or invalid attemptId" }, { status: 400 });
  }

  const env = await getEnvironmentByAttempt(attemptId);
  if (!env) {
    return NextResponse.json({ error: "Environment not found" }, { status: 404 });
  }

  if (env.status === "creating") {
    const updated = await pollEnvironmentStatus(env.id);
    return NextResponse.json({ environment: updated });
  }

  return NextResponse.json({ environment: env });
}

// DELETE /api/environments — destroy a Codespace for an attempt
export async function DELETE(request: NextRequest) {
  const candidate = await getAuthenticatedCandidate(request);
  if (!candidate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const schema = z.object({ attemptId: z.number() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const env = await getEnvironmentByAttempt(parsed.data.attemptId);
  if (!env) {
    return NextResponse.json({ error: "Environment not found" }, { status: 404 });
  }

  await destroyEnvironment(env.id);
  return NextResponse.json({ success: true });
}
