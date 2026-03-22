#!/bin/bash
# Sync and pretty-print Claude Code conversation transcripts
# Run manually or via Claude Code hook for real-time updates

TRANSCRIPT_DIR="/workspace/transcripts"
SESSION_ID="a13664ed-a12a-4151-ab89-b6af5416dac8"
SOURCE_DIR="/home/node/.claude/projects/-workspace"

# Pretty-print main conversation
MAIN_JSONL="${SOURCE_DIR}/${SESSION_ID}.jsonl"
if [ -f "$MAIN_JSONL" ]; then
  # Convert JSONL to a JSON array, pretty-printed
  echo "[" > "${TRANSCRIPT_DIR}/main-conversation.json"
  first=true
  while IFS= read -r line; do
    if [ "$first" = true ]; then
      first=false
    else
      echo "," >> "${TRANSCRIPT_DIR}/main-conversation.json"
    fi
    echo "$line" | python3 -m json.tool 2>/dev/null >> "${TRANSCRIPT_DIR}/main-conversation.json" || echo "$line" >> "${TRANSCRIPT_DIR}/main-conversation.json"
  done < "$MAIN_JSONL"
  echo "]" >> "${TRANSCRIPT_DIR}/main-conversation.json"
fi

# Pretty-print each subagent transcript
SUBAGENT_DIR="${SOURCE_DIR}/${SESSION_ID}/subagents"
if [ -d "$SUBAGENT_DIR" ]; then
  mkdir -p "${TRANSCRIPT_DIR}/subagents"

  for jsonl_file in "$SUBAGENT_DIR"/agent-*.jsonl; do
    [ -f "$jsonl_file" ] || continue
    agent_id=$(basename "$jsonl_file" .jsonl)

    # Get agent name from meta.json if it exists
    meta_file="${SUBAGENT_DIR}/${agent_id}.meta.json"
    agent_name="$agent_id"
    if [ -f "$meta_file" ]; then
      name=$(python3 -c "import json; d=json.load(open('$meta_file')); print(d.get('name','$agent_id'))" 2>/dev/null)
      [ -n "$name" ] && agent_name="$name"
    fi

    output_file="${TRANSCRIPT_DIR}/subagents/${agent_name}.json"
    echo "[" > "$output_file"
    first=true
    while IFS= read -r line; do
      if [ "$first" = true ]; then
        first=false
      else
        echo "," >> "$output_file"
      fi
      echo "$line" | python3 -m json.tool 2>/dev/null >> "$output_file" || echo "$line" >> "$output_file"
    done < "$jsonl_file"
    echo "]" >> "$output_file"
  done
fi

echo "Transcripts synced to ${TRANSCRIPT_DIR}/ at $(date -Iseconds)"
