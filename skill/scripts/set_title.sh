#!/usr/bin/env bash
# Writes a title to the signal file watched by the claude-terminal-title VS Code/Cursor extension.
# Usage: set_title.sh "Title"
set -euo pipefail

title=${1:-}
if [[ -z "$title" ]]; then
  echo "usage: set_title.sh <title>" >&2
  exit 1
fi

signal_file=${CLAUDE_TERMINAL_TITLE_FILE:-"$HOME/.claude-terminal-title"}
mkdir -p "$(dirname "$signal_file")"
printf '%s' "$title" > "$signal_file"
