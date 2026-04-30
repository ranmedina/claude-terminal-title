#!/usr/bin/env bash
set -euo pipefail
rm -rf "$HOME/.claude/skills/terminal-title"
echo "✓ Skill removed"

# Drop the SessionStart hook we own.
settings="$HOME/.claude/settings.json"
if [[ -f "$settings" ]] && command -v jq >/dev/null 2>&1; then
  tmp=$(mktemp)
  jq '
    if .hooks.SessionStart then
      .hooks.SessionStart |= [ .[] | select(.matcher != "claude-terminal-title") ]
    else . end
  ' "$settings" > "$tmp" && mv "$tmp" "$settings"
  echo "✓ Removed SessionStart hook"
fi

for ext_id in ranmedina.claude-terminal-title; do
  command -v cursor >/dev/null 2>&1 && cursor --uninstall-extension "$ext_id" 2>/dev/null || true
  command -v code   >/dev/null 2>&1 && code   --uninstall-extension "$ext_id" 2>/dev/null || true
done

rm -f "$HOME/.claude-terminal-title"
echo "✓ Done"
