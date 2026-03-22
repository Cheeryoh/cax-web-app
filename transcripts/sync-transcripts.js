#!/usr/bin/env node
/**
 * Sync and pretty-print Claude Code conversation transcripts.
 * Converts JSONL files to pretty-printed JSON arrays.
 * Run manually or via Claude Code hook for real-time updates.
 */

const fs = require("fs");
const path = require("path");

const TRANSCRIPT_DIR = "/workspace/transcripts";
const SESSION_ID = "a13664ed-a12a-4151-ab89-b6af5416dac8";
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

// Pretty-print main conversation
const mainJsonl = path.join(SOURCE_DIR, `${SESSION_ID}.jsonl`);
if (fs.existsSync(mainJsonl)) {
  const messages = jsonlToArray(mainJsonl);
  fs.writeFileSync(
    path.join(TRANSCRIPT_DIR, "main-conversation.json"),
    JSON.stringify(messages, null, 2)
  );
  console.log(`Main conversation: ${messages.length} messages`);
}

// Pretty-print subagent transcripts
const subagentDir = path.join(SOURCE_DIR, SESSION_ID, "subagents");
const subagentOutDir = path.join(TRANSCRIPT_DIR, "subagents");
fs.mkdirSync(subagentOutDir, { recursive: true });

if (fs.existsSync(subagentDir)) {
  const jsonlFiles = fs
    .readdirSync(subagentDir)
    .filter((f) => f.endsWith(".jsonl"));

  for (const file of jsonlFiles) {
    const agentId = file.replace(".jsonl", "");
    const metaPath = path.join(subagentDir, `${agentId}.meta.json`);

    // Build a meaningful filename from metadata
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

    const messages = jsonlToArray(path.join(subagentDir, file));
    fs.writeFileSync(
      path.join(subagentOutDir, `${agentName}.json`),
      JSON.stringify(messages, null, 2)
    );
    console.log(`  ${agentName}: ${messages.length} messages`);
  }
}

console.log(
  `\nTranscripts synced to ${TRANSCRIPT_DIR}/ at ${new Date().toISOString()}`
);
