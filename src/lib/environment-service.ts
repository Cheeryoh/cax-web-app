import { getSupabase } from "./supabase";

export interface Environment {
  id: number;
  attempt_id: number;
  codespace_id: string | null;
  codespace_name: string | null;
  codespace_url: string | null;
  status: "creating" | "ready" | "active" | "stopped" | "deleted" | "failed";
  created_at: string;
  destroyed_at: string | null;
}

const GITHUB_API_BASE = "https://api.github.com";
const CODESPACE_REPO = "Cheeryoh/exam-template-alex-rivera";

function rowToEnvironment(row: Record<string, unknown>): Environment {
  return {
    id: row.id as number,
    attempt_id: row.attempt_id as number,
    codespace_id: (row.codespace_id as string | null) ?? null,
    codespace_name: (row.codespace_name as string | null) ?? null,
    codespace_url: (row.codespace_url as string | null) ?? null,
    status: row.status as Environment["status"],
    created_at: row.created_at as string,
    destroyed_at: (row.destroyed_at as string | null) ?? null,
  };
}

export async function createEnvironment(attemptId: number): Promise<Environment> {
  const supabase = getSupabase();

  // Insert initial row with status 'creating'
  const { data: insertedRow, error: insertError } = await supabase
    .from("environments")
    .insert({ attempt_id: attemptId, status: "creating" })
    .select()
    .single();

  if (insertError) throw new Error(`createEnvironment insert failed: ${insertError.message}`);
  const envId = (insertedRow as Record<string, unknown>).id as number;

  if (process.env.USE_MOCK === "true") {
    const mockName = `mock-cs-${attemptId}`;
    const mockUrl = "https://mock-codespace.github.dev";

    const { data: updatedRow, error: updateError } = await supabase
      .from("environments")
      .update({ codespace_name: mockName, codespace_url: mockUrl, status: "ready" })
      .eq("id", envId)
      .select()
      .single();

    if (updateError) throw new Error(`createEnvironment mock update failed: ${updateError.message}`);
    return rowToEnvironment(updatedRow as Record<string, unknown>);
  }

  // Real mode: call GitHub API to create the codespace
  try {
    const displayName = `cax-${attemptId}-${Date.now()}`;
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${CODESPACE_REPO}/codespaces`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "master", display_name: displayName }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as { id: number | string; name: string };
    const codespaceId = String(data.id);
    const codespace_name = data.name;

    await supabase
      .from("environments")
      .update({ codespace_id: codespaceId, codespace_name, status: "creating" })
      .eq("id", envId);
  } catch (err) {
    await supabase
      .from("environments")
      .update({ status: "failed" })
      .eq("id", envId);
    throw new Error(
      `Failed to create GitHub Codespace: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { data: finalRow, error: finalError } = await supabase
    .from("environments")
    .select("*")
    .eq("id", envId)
    .single();

  if (finalError) throw new Error(`createEnvironment fetch final failed: ${finalError.message}`);
  return rowToEnvironment(finalRow as Record<string, unknown>);
}

export async function getEnvironmentByAttempt(
  attemptId: number
): Promise<Environment | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("environments")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getEnvironmentByAttempt failed: ${error.message}`);
  return data ? rowToEnvironment(data as Record<string, unknown>) : null;
}

export async function getEnvironmentByCodespaceName(
  name: string
): Promise<Environment | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("environments")
    .select("*")
    .eq("codespace_name", name)
    .maybeSingle();

  if (error) throw new Error(`getEnvironmentByCodespaceName failed: ${error.message}`);
  return data ? rowToEnvironment(data as Record<string, unknown>) : null;
}

export async function pollEnvironmentStatus(envId: number): Promise<Environment> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from("environments")
    .select("*")
    .eq("id", envId)
    .maybeSingle();

  if (fetchError) throw new Error(`pollEnvironmentStatus fetch failed: ${fetchError.message}`);
  if (!row) {
    throw new Error(`Environment ${envId} not found`);
  }

  const env = rowToEnvironment(row as Record<string, unknown>);

  // In mock mode or if status is terminal/already-ready, return as-is
  if (
    process.env.USE_MOCK === "true" ||
    env.status === "ready" ||
    env.status === "deleted" ||
    env.status === "failed"
  ) {
    return env;
  }

  if (!env.codespace_name) {
    return env;
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/user/codespaces/${env.codespace_name}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}`);
    }

    const data = (await response.json()) as { state: string; web_url?: string };
    const githubState = data.state;

    let newStatus: Environment["status"];
    let newUrl: string | null = env.codespace_url;

    switch (githubState) {
      case "Available":
        newStatus = "ready";
        newUrl = data.web_url ?? env.codespace_url;
        break;
      case "Queued":
      case "Provisioning":
      case "Created":
      case "Starting":
        newStatus = "creating";
        break;
      case "Failed":
        newStatus = "failed";
        break;
      case "Shutdown":
      case "ShuttingDown":
        newStatus = "stopped";
        break;
      default:
        newStatus = env.status;
    }

    await supabase
      .from("environments")
      .update({ status: newStatus, codespace_url: newUrl })
      .eq("id", envId);
  } catch (err) {
    await supabase
      .from("environments")
      .update({ status: "failed" })
      .eq("id", envId);
    throw new Error(
      `Failed to poll GitHub Codespace status: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { data: updated, error: updatedError } = await supabase
    .from("environments")
    .select("*")
    .eq("id", envId)
    .single();

  if (updatedError) throw new Error(`pollEnvironmentStatus re-fetch failed: ${updatedError.message}`);
  return rowToEnvironment(updated as Record<string, unknown>);
}

export async function destroyEnvironment(envId: number): Promise<void> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from("environments")
    .select("*")
    .eq("id", envId)
    .maybeSingle();

  if (fetchError) throw new Error(`destroyEnvironment fetch failed: ${fetchError.message}`);
  if (!row) {
    throw new Error(`Environment ${envId} not found`);
  }

  const env = rowToEnvironment(row as Record<string, unknown>);
  const destroyedAt = new Date().toISOString();

  if (process.env.USE_MOCK === "true") {
    const { error } = await supabase
      .from("environments")
      .update({ status: "deleted", destroyed_at: destroyedAt })
      .eq("id", envId);
    if (error) throw new Error(`destroyEnvironment mock update failed: ${error.message}`);
    return;
  }

  if (!env.codespace_name) {
    const { error } = await supabase
      .from("environments")
      .update({ status: "deleted", destroyed_at: destroyedAt })
      .eq("id", envId);
    if (error) throw new Error(`destroyEnvironment update failed: ${error.message}`);
    return;
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/user/codespaces/${env.codespace_name}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    // 204 No Content is success; 404 means already gone — both are acceptable
    if (!response.ok && response.status !== 404) {
      throw new Error(`GitHub API error ${response.status}`);
    }
  } catch (err) {
    // Still mark as deleted in DB even if the API call fails, to avoid leaving
    // orphaned DB rows. Log the error for operator awareness.
    console.error(
      `Warning: GitHub Codespace delete call failed for env ${envId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  const { error } = await supabase
    .from("environments")
    .update({ status: "deleted", destroyed_at: destroyedAt })
    .eq("id", envId);
  if (error) throw new Error(`destroyEnvironment final update failed: ${error.message}`);
}
