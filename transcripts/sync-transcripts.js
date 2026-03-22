#!/usr/bin/env node
/**
 * Sync and pretty-print Claude Code conversation transcripts.
 * Merges all project session JSONL files into a single sorted JSON array.
 * Run manually or via Claude Code hook for real-time updates.
 */

const fs = require("fs");
const path = require("path");

const TRANSCRIPT_DIR = "/workspace/transcripts";
const SOURCE_DIR = "/home/node/.claude/projects/-workspace";

function jsonlToArray(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  return lines
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { _raw: line };
      }
    });
}

// Discover all session JSONL files (exclude subagent dirs)
const allJsonl = fs
  .readdirSync(SOURCE_DIR)
  .filter((f) => f.endsWith(".jsonl"));

let allMessages = [];
for (const file of allJsonl) {
  const filePath = path.join(SOURCE_DIR, file);
  const messages = jsonlToArray(filePath);
  console.log(`  ${file}: ${messages.length} messages`);
  allMessages = allMessages.concat(messages);
}

// Sort by timestamp where available
allMessages.sort((a, b) => {
  const ta = a.timestamp || "";
  const tb = b.timestamp || "";
  if (!ta && !tb) return 0;
  if (!ta) return -1;
  if (!tb) return 1;
  return ta.localeCompare(tb);
});

fs.writeFileSync(
  path.join(TRANSCRIPT_DIR, "main-conversation.json"),
  JSON.stringify(allMessages, null, 2)
);

const timestamps = allMessages.filter((m) => m.timestamp).map((m) => m.timestamp);
console.log(`\nMain conversation: ${allMessages.length} messages`);
console.log(`First: ${timestamps[0] || "n/a"}`);
console.log(`Last: ${timestamps[timestamps.length - 1] || "n/a"}`);

// Pretty-print subagent transcripts from all sessions
const subagentOutDir = path.join(TRANSCRIPT_DIR, "subagents");
fs.mkdirSync(subagentOutDir, { recursive: true });

for (const file of allJsonl) {
  const sessionId = file.replace(".jsonl", "");
  const subagentDir = path.join(SOURCE_DIR, sessionId, "subagents");

  if (fs.existsSync(subagentDir)) {
    const jsonlFiles = fs
      .readdirSync(subagentDir)
      .filter((f) => f.endsWith(".jsonl"));

    for (const subFile of jsonlFiles) {
      const agentId = subFile.replace(".jsonl", "");
      const metaPath = path.join(subagentDir, `${agentId}.meta.json`);

      let agentName = agentId;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          const type = meta.agentType || "unknown";
          const desc = (meta.description || "")
            .replace(/[^a-zA-Z0-9 -]/g, "")
            .replace(/\s+/g, "-")
            .toLowerCase()
            .slice(0, 50);
          agentName = `${type}--${desc}`;
        } catch {
          // fall back to agent ID
        }
      }

      const messages = jsonlToArray(path.join(subagentDir, subFile));
      fs.writeFileSync(
        path.join(subagentOutDir, `${agentName}.json`),
        JSON.stringify(messages, null, 2)
      );
      console.log(`  subagent ${agentName}: ${messages.length} messages`);
    }
  }
}

console.log(
  `\nTranscripts synced to ${TRANSCRIPT_DIR}/ at ${new Date().toISOString()}`
);
