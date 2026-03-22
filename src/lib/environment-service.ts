import { getDb } from "./db";

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
  const db = getDb();

  // Insert initial row with status 'creating'
  const insert = db.prepare(
    `INSERT INTO environments (attempt_id, status) VALUES (?, 'creating')`
  );
  const result = insert.run(attemptId);
  const envId = result.lastInsertRowid as number;

  if (process.env.USE_MOCK === "true") {
    const mockName = `mock-cs-${attemptId}`;
    const mockUrl = "https://mock-codespace.github.dev";
    db.prepare(
      `UPDATE environments SET codespace_name = ?, codespace_url = ?, status = 'ready' WHERE id = ?`
    ).run(mockName, mockUrl, envId);

    const row = db
      .prepare("SELECT * FROM environments WHERE id = ?")
      .get(envId) as Record<string, unknown>;
    return rowToEnvironment(row);
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

    db.prepare(
      `UPDATE environments SET codespace_id = ?, codespace_name = ?, status = 'creating' WHERE id = ?`
    ).run(codespaceId, codespace_name, envId);
  } catch (err) {
    db.prepare(`UPDATE environments SET status = 'failed' WHERE id = ?`).run(envId);
    const row = db
      .prepare("SELECT * FROM environments WHERE id = ?")
      .get(envId) as Record<string, unknown>;
    // Re-throw after recording failure so caller knows something went wrong
    throw new Error(
      `Failed to create GitHub Codespace: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const row = db
    .prepare("SELECT * FROM environments WHERE id = ?")
    .get(envId) as Record<string, unknown>;
  return rowToEnvironment(row);
}

export function getEnvironmentByAttempt(attemptId: number): Environment | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE attempt_id = ? ORDER BY id DESC LIMIT 1")
    .get(attemptId) as Record<string, unknown> | undefined;
  return row ? rowToEnvironment(row) : null;
}

export function getEnvironmentByCodespaceName(name: string): Environment | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE codespace_name = ?")
    .get(name) as Record<string, unknown> | undefined;
  return row ? rowToEnvironment(row) : null;
}

export async function pollEnvironmentStatus(envId: number): Promise<Environment> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE id = ?")
    .get(envId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Environment ${envId} not found`);
  }

  const env = rowToEnvironment(row);

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

    db.prepare(
      `UPDATE environments SET status = ?, codespace_url = ? WHERE id = ?`
    ).run(newStatus, newUrl, envId);
  } catch (err) {
    db.prepare(`UPDATE environments SET status = 'failed' WHERE id = ?`).run(envId);
    throw new Error(
      `Failed to poll GitHub Codespace status: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const updated = db
    .prepare("SELECT * FROM environments WHERE id = ?")
    .get(envId) as Record<string, unknown>;
  return rowToEnvironment(updated);
}

export async function destroyEnvironment(envId: number): Promise<void> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE id = ?")
    .get(envId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Environment ${envId} not found`);
  }

  const env = rowToEnvironment(row);
  const destroyedAt = new Date().toISOString();

  if (process.env.USE_MOCK === "true") {
    db.prepare(
      `UPDATE environments SET status = 'deleted', destroyed_at = ? WHERE id = ?`
    ).run(destroyedAt, envId);
    return;
  }

  if (!env.codespace_name) {
    db.prepare(
      `UPDATE environments SET status = 'deleted', destroyed_at = ? WHERE id = ?`
    ).run(destroyedAt, envId);
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

  db.prepare(
    `UPDATE environments SET status = 'deleted', destroyed_at = ? WHERE id = ?`
  ).run(destroyedAt, envId);
}
