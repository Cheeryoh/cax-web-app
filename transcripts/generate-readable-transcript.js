#!/usr/bin/env node
/**
 * Generate a readable Human-AI transcript from the raw conversation JSON.
 * Filters to main-thread human/Claude exchanges only (no agent-to-agent).
 * Summarizes long Claude responses, strips system tags, redacts secrets.
 */

const fs = require("fs");
const path = require("path");

const INPUT = path.join(__dirname, "main-conversation.json");
const OUTPUT = path.join(__dirname, "human-ai-transcript.md");

// Secrets to redact (patterns)
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36}/g,
  /sk-ant-api03-[A-Za-z0-9_-]{80,}/g,
  /eyJhbGciOiJIUzI1Ni[A-Za-z0-9_.\-/+=\s]{20,}/g,
];

function redact(text) {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function formatTime(isoTimestamp) {
  if (!isoTimestamp) return "??:??";
  const d = new Date(isoTimestamp);
  return d.toISOString().substring(11, 16) + " UTC";
}

function stripSystemTags(text) {
  // Remove <system-reminder>...</system-reminder> blocks
  let result = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  // Remove <local-command-caveat>...</local-command-caveat>
  result = result.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  // Convert <command-name>/X</command-name> to /X
  result = result.replace(/<command-name>\/?([^<]*)<\/command-name>/g, "/$1");
  // Remove other XML-like tags from system
  result = result.replace(/<command-message>[^<]*<\/command-message>/g, "");
  result = result.replace(/<command-args>[^<]*<\/command-args>/g, "");
  // Remove <local-command-stdout> wrappers but keep content
  result = result.replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, "$1");
  // Remove <bash-input>/<bash-stdout>/<bash-stderr> wrappers
  result = result.replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, "```\n$1\n```");
  result = result.replace(/<bash-stdout>([\s\S]*?)<\/bash-stdout>/g, "$1");
  result = result.replace(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/g, "");
  // Remove <task-notification> blocks
  result = result.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "[Agent completed]");
  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

function extractUserText(msg) {
  const content = msg.message?.content;
  if (!content) return null;

  if (typeof content === "string") {
    const cleaned = stripSystemTags(content);
    return cleaned.length > 3 ? cleaned : null;
  }

  if (Array.isArray(content)) {
    // Skip if it's purely tool_result blocks (not human input)
    const hasText = content.some((c) => c.type === "text");
    const onlyToolResults = content.every(
      (c) => c.type === "tool_result" || c.type === "tool_use_rejection"
    );
    if (onlyToolResults) return null;

    const texts = [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        const cleaned = stripSystemTags(block.text);
        if (cleaned.length > 3) texts.push(cleaned);
      }
    }
    return texts.length > 0 ? texts.join("\n\n") : null;
  }

  return null;
}

function extractAssistantContent(msg) {
  const content = msg.message?.content;
  if (!content || !Array.isArray(content)) return null;

  const texts = [];
  const toolCalls = [];
  const agentLaunches = [];

  for (const block of content) {
    if (block.type === "text" && block.text) {
      const cleaned = stripSystemTags(block.text);
      if (cleaned.length > 3) texts.push(cleaned);
    }
    if (block.type === "tool_use") {
      const name = block.name;
      if (name === "Agent") {
        const desc = block.input?.description || "task";
        const type = block.input?.subagent_type || "general";
        agentLaunches.push(`[Launched ${type} agent: ${desc}]`);
      } else {
        if (!toolCalls.includes(name)) toolCalls.push(name);
      }
    }
  }

  if (texts.length === 0 && toolCalls.length === 0 && agentLaunches.length === 0) {
    return null;
  }

  let fullText = texts.join("\n\n");

  // Summarize long responses
  if (fullText.length > 1000) {
    // Take first 500 chars and add truncation note
    const firstParagraph = fullText.split("\n\n")[0];
    if (firstParagraph.length > 300) {
      fullText = firstParagraph.substring(0, 300) + "...";
    } else {
      // Take first few paragraphs up to ~500 chars
      const paragraphs = fullText.split("\n\n");
      let summary = "";
      for (const p of paragraphs) {
        if (summary.length + p.length > 500) break;
        summary += (summary ? "\n\n" : "") + p;
      }
      fullText = summary + "\n\n*[Response truncated — original was " + texts.join("").length + " chars]*";
    }
  } else if (fullText.length > 300) {
    // Keep as-is for medium responses
  }

  // Append tool/agent info
  const extras = [];
  if (toolCalls.length > 0) extras.push(`[Used ${toolCalls.join(", ")}]`);
  for (const launch of agentLaunches) extras.push(launch);

  if (extras.length > 0) {
    fullText = (fullText ? fullText + "\n\n" : "") + extras.join("\n");
  }

  return fullText || null;
}

// Main
console.log("Reading", INPUT);
const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));

const lines = [];
lines.push("# CAX Web App — Human-AI Collaboration Transcript");
lines.push("");
lines.push("**Project:** Candidate Assessment Experience (CAX)");
lines.push("**Date:** 2026-03-22");
lines.push("**Duration:** ~9.5 hours");
lines.push("**Total raw messages:** " + data.length);
lines.push("");
lines.push("---");
lines.push("");

let sessionNum = 0;
let lastTimestamp = null;
let messageCount = 0;

// First pass: collect all main-thread messages
const mainMessages = [];
for (const msg of data) {
  if (!["user", "assistant"].includes(msg.type) || msg.isSidechain) continue;
  mainMessages.push(msg);
}

// Second pass: merge consecutive Claude messages into single entries
// Tool-only Claude messages get their tools merged into the next text response
let i = 0;
while (i < mainMessages.length) {
  const msg = mainMessages[i];
  const timestamp = msg.timestamp;

  // Detect session breaks (>30 min gap)
  if (timestamp && lastTimestamp) {
    const gap = new Date(timestamp) - new Date(lastTimestamp);
    if (gap > 30 * 60 * 1000) {
      sessionNum++;
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push(`## Session Break (${Math.round(gap / 60000)} min gap)`);
      lines.push("");
    }
  }

  if (msg.type === "user") {
    const text = extractUserText(msg);
    if (!text) { i++; continue; }

    const redacted = redact(text);
    const quoted = redacted.split("\n").map((l) => "> " + l).join("\n");

    lines.push(`### [${formatTime(timestamp)}] Human`);
    lines.push("");
    lines.push(quoted);
    lines.push("");
    messageCount++;
    if (timestamp) lastTimestamp = timestamp;
    i++;
    continue;
  }

  if (msg.type === "assistant") {
    // Collect consecutive assistant messages and merge them
    const mergedTools = [];
    const mergedAgents = [];
    let mergedText = "";
    let firstTimestamp = timestamp;

    while (i < mainMessages.length && mainMessages[i].type === "assistant" && !mainMessages[i].isSidechain) {
      const aMsg = mainMessages[i];
      const content = aMsg.message?.content;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            const cleaned = stripSystemTags(block.text);
            if (cleaned.length > 3) {
              mergedText += (mergedText ? "\n\n" : "") + cleaned;
            }
          }
          if (block.type === "tool_use") {
            if (block.name === "Agent") {
              const desc = block.input?.description || "task";
              const type = block.input?.subagent_type || "general";
              mergedAgents.push(`[Launched ${type} agent: ${desc}]`);
            } else {
              if (!mergedTools.includes(block.name)) mergedTools.push(block.name);
            }
          }
        }
      }

      if (aMsg.timestamp) lastTimestamp = aMsg.timestamp;
      i++;
    }

    // Skip if nothing meaningful
    if (!mergedText && mergedTools.length === 0 && mergedAgents.length === 0) continue;

    // If only tools, no text — show as a brief tool summary
    if (!mergedText && mergedTools.length === 0 && mergedAgents.length > 0) {
      lines.push(`### [${formatTime(firstTimestamp)}] Claude`);
      lines.push("");
      lines.push(mergedAgents.join("\n"));
      lines.push("");
      messageCount++;
      continue;
    }

    // Skip tool-only entries with no text and no agents
    if (!mergedText && mergedAgents.length === 0) continue;

    // Summarize long text
    if (mergedText.length > 1000) {
      const paragraphs = mergedText.split("\n\n");
      let summary = "";
      for (const p of paragraphs) {
        if (summary.length + p.length > 500) break;
        summary += (summary ? "\n\n" : "") + p;
      }
      mergedText = summary + "\n\n*[Response truncated — original was " + mergedText.length + " chars]*";
    }

    // Build final output
    let finalText = mergedText;
    const extras = [];
    if (mergedTools.length > 0) extras.push(`*[Used ${mergedTools.join(", ")}]*`);
    for (const launch of mergedAgents) extras.push(launch);
    if (extras.length > 0) {
      finalText = (finalText ? finalText + "\n\n" : "") + extras.join("\n");
    }

    if (!finalText) continue;

    const redacted = redact(finalText);
    lines.push(`### [${formatTime(firstTimestamp)}] Claude`);
    lines.push("");
    lines.push(redacted);
    lines.push("");
    messageCount++;
    continue;
  }

  if (timestamp) lastTimestamp = timestamp;
  i++;
}

// Post-process: deduplicate and merge consecutive same-speaker entries
const rawOutput = lines.join("\n");

// Parse into structured entries
const entries = [];
let currentEntry = null;
for (const line of rawOutput.split("\n")) {
  const headerMatch = line.match(/^### \[([^\]]+)\] (Human|Claude)$/);
  if (headerMatch) {
    if (currentEntry) entries.push(currentEntry);
    currentEntry = { time: headerMatch[1], speaker: headerMatch[2], content: "" };
  } else if (currentEntry) {
    currentEntry.content += line + "\n";
  } else {
    // Preamble (before first entry)
    if (!entries._preamble) entries._preamble = "";
    entries._preamble = (entries._preamble || "") + line + "\n";
  }
}
if (currentEntry) entries.push(currentEntry);

// Deduplicate: remove exact content duplicates and merge consecutive same-speaker
const deduped = [];
for (let j = 0; j < entries.length; j++) {
  const entry = entries[j];
  const prev = deduped[deduped.length - 1];

  // Skip exact duplicates (same speaker, same time, same content)
  if (prev && prev.speaker === entry.speaker && prev.time === entry.time && prev.content.trim() === entry.content.trim()) {
    continue;
  }

  // Skip [Request interrupted by user] if the next entry is from the same user
  if (entry.content.trim() === "> [Request interrupted by user]" || entry.content.trim() === "> [Request interrupted by user for tool use]") {
    // Keep only if it's meaningful context (between speaker switches)
    const next = entries[j + 1];
    if (next && next.speaker === entry.speaker) {
      continue; // Skip — same speaker continues
    }
  }

  // Merge consecutive same-speaker entries
  if (prev && prev.speaker === entry.speaker && prev.time === entry.time) {
    prev.content = prev.content.trimEnd() + "\n\n" + entry.content.trimStart();
    continue;
  }

  deduped.push({ ...entry });
}

// Deduplicate paragraphs within each entry
for (const entry of deduped) {
  const paragraphs = entry.content.split("\n\n").map((p) => p.trim()).filter(Boolean);
  const seen = new Set();
  const uniqueParagraphs = [];
  for (const p of paragraphs) {
    // Normalize whitespace for comparison
    const normalized = p.replace(/\s+/g, " ");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueParagraphs.push(p);
  }
  entry.content = uniqueParagraphs.join("\n\n") + "\n";
}

// Also deduplicate consecutive lines within entries (for line-level dupes)
for (const entry of deduped) {
  const entryLines = entry.content.split("\n");
  const dedupedLines = [];
  for (let k = 0; k < entryLines.length; k++) {
    const line = entryLines[k];
    const prevLine = dedupedLines[dedupedLines.length - 1];
    // Skip if exact same as previous non-empty line
    if (line.trim() && prevLine && line.trim() === prevLine.trim()) continue;
    dedupedLines.push(line);
  }
  entry.content = dedupedLines.join("\n");
}

// Rebuild output
const finalLines = [];
finalLines.push((entries._preamble || "").trimEnd());
finalLines.push("");

for (const entry of deduped) {
  finalLines.push(`### [${entry.time}] ${entry.speaker}`);
  finalLines.push("");
  finalLines.push(entry.content.trimEnd());
  finalLines.push("");
}

const output = finalLines.join("\n");
fs.writeFileSync(OUTPUT, output);

const finalCount = deduped.length;
console.log(`Written ${finalCount} conversation turns to ${OUTPUT} (before dedup: ${messageCount})`);
console.log(`File size: ${(output.length / 1024).toFixed(1)} KB`);

// Verify no secrets leaked
let hasSecrets = false;
for (const pattern of SECRET_PATTERNS) {
  pattern.lastIndex = 0;
  if (pattern.test(output)) {
    console.error("WARNING: Secret pattern found in output!");
    hasSecrets = true;
  }
}
if (!hasSecrets) console.log("No secrets detected in output.");
