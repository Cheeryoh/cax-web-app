import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, createSession, getSession, getCandidateById, destroySession, seedDemoData } from "@/lib/auth-service";

// POST /api/auth — login
export async function POST(request: NextRequest) {
  try {
    // Ensure demo data exists
    await seedDemoData();

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const candidate = await validateCredentials(username, password);
    if (!candidate) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = createSession(candidate.id);
    const redirectUrl = candidate.role === "admin" ? "/admin" : "/candidate";

    const response = NextResponse.json({
      candidate: {
        id: candidate.id,
        username: candidate.username,
        displayName: candidate.display_name,
        role: candidate.role,
      },
      redirectUrl,
    });

    response.cookies.set("session", token, {
      httpOnly: true,
      secure: false, // demo: no HTTPS
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/auth — check session
export async function GET(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = getSession(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const candidate = getCandidateById(session.candidateId);
  if (!candidate) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    candidate: {
      id: candidate.id,
      username: candidate.username,
      displayName: candidate.display_name,
      role: candidate.role,
    },
  });
}

// DELETE /api/auth — logout
export async function DELETE(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (token) {
    destroySession(token);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete("session");
  return response;
}
