import { NextRequest, NextResponse } from "next/server";
import { getEnvironmentByCodespaceName } from "@/lib/environment-service";
import { getDb } from "@/lib/db";
import { z } from "zod";

// POST /api/validation/events — receive Claude Code hook events from a Codespace
// Auth is via X-Codespace-Name header, NOT session cookies
export async function POST(request: NextRequest) {
  const codespaceNameHeader = request.headers.get("x-codespace-name");
  if (!codespaceNameHeader) {
    return NextResponse.json(
      { error: "Missing X-Codespace-Name header" },
      { status: 401 }
    );
  }

  const env = getEnvironmentByCodespaceName(codespaceNameHeader);
  if (!env) {
    return NextResponse.json({ error: "Unknown codespace" }, { status: 401 });
  }

  const body = await request.json();
  const schema = z.object({}).passthrough();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const data = parsed.data as Record<string, unknown>;
  const event_type =
    typeof data["event_type"] === "string" ? data["event_type"] : "tool_use";
  const tool_name =
    typeof data["tool_name"] === "string" ? data["tool_name"] : null;
  const tool_input =
    data["tool_input"] != null ? JSON.stringify(data["tool_input"]) : null;
  const tool_output =
    data["tool_output"] != null ? JSON.stringify(data["tool_output"]) : null;
  const raw_json = JSON.stringify(data);

  const db = getDb();
  db.prepare(
    `INSERT INTO validation_events (attempt_id, event_type, tool_name, tool_input, tool_output, raw_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(env.attempt_id, event_type, tool_name, tool_input, tool_output, raw_json);

  return NextResponse.json({ received: true });
}
