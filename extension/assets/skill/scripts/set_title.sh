#!/usr/bin/env bash
# Writes "<originPid>\t<title>" to the signal file watched by the
# claude-terminal-title VS Code/Cursor extension. The originPid lets the
# extension scope the rename to the terminal that issued the call, so a
# /title from one Claude session doesn't rename other windows' active terminals.
#
# Usage:
#   set_title.sh "Title"        — write a real Claude-picked title
#   set_title.sh --placeholder  — write "Claude • <branch-or-folder>"
set -euo pipefail

# Walk up the process tree to the terminal's shell PID — the same PID that
# VS Code's `terminal.processId` reports for the tab. Stops once the parent
# isn't a shell/node/claude process (i.e. we've hit the terminal emulator).
find_terminal_pid() {
  local pid=$$
  local parent pcmd pname
  while :; do
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    [[ -z "$parent" || "$parent" -le 1 ]] && break
    pcmd=$(ps -o comm= -p "$parent" 2>/dev/null || true)
    pname=${pcmd##*/}
    pname=${pname#-}
    case "$pname" in
      bash|zsh|sh|fish|dash|node|claude) pid=$parent ;;
      *) break ;;
    esac
  done
  printf '%s' "$pid"
}

if [[ "${1:-}" == "--placeholder" ]]; then
  label=$(git -C "$PWD" branch --show-current 2>/dev/null || true)
  [[ -z "$label" ]] && label="${PWD##*/}"
  title="Claude • $label"
else
  title=${1:-}
fi

if [[ -z "$title" ]]; then
  echo "usage: set_title.sh <title> | --placeholder" >&2
  exit 1
fi

pid=$(find_terminal_pid)
signal_file=${CLAUDE_TERMINAL_TITLE_FILE:-"$HOME/.claude-terminal-title"}
mkdir -p "$(dirname "$signal_file")"
printf '%s\t%s' "$pid" "$title" > "$signal_file"
