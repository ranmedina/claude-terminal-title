#!/usr/bin/env bash
# Installer for claude-terminal-title.
# - Installs the Cursor / VS Code extension
# - Installs the Claude Code skill
# - Registers a Claude SessionStart hook so every new + resumed conversation auto-titles
# - Pre-populates the signal file so existing terminals see a title on next reload
# Idempotent — safe to re-run.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

# 1. Skill ------------------------------------------------------------------
skill_dest="$HOME/.claude/skills/terminal-title"
mkdir -p "$skill_dest/scripts"
cp "$here/skill/SKILL.md" "$skill_dest/SKILL.md"
cp "$here/skill/scripts/set_title.sh" "$skill_dest/scripts/set_title.sh"
chmod +x "$skill_dest/scripts/set_title.sh"
echo "✓ Skill installed to $skill_dest"

# 2. Claude SessionStart hook ----------------------------------------------
# Auto-titles every new + resumed Claude conversation to the cwd folder
# (or current git branch if in a repo). Skill refines this later.
settings="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$settings")"
[[ -s "$settings" ]] || echo '{}' > "$settings"

hook_cmd='title=$(git -C "$PWD" branch --show-current 2>/dev/null); [[ -z "$title" ]] && title="${PWD##*/}"; printf "%s" "$title" > "$HOME/.claude-terminal-title"'

if command -v jq >/dev/null 2>&1; then
  tmp=$(mktemp)
  jq --arg cmd "$hook_cmd" '
    .hooks //= {} |
    .hooks.SessionStart //= [] |
    # Replace any prior matcher we own; otherwise append.
    .hooks.SessionStart = (
      [ .hooks.SessionStart[] | select(.matcher != "claude-terminal-title") ]
      + [{ matcher: "claude-terminal-title", hooks: [{ type: "command", command: $cmd }] }]
    )
  ' "$settings" > "$tmp" && mv "$tmp" "$settings"
  echo "✓ Registered SessionStart hook in $settings"
else
  echo "⚠ jq not found — skipping SessionStart hook. Install jq and re-run for full auto-titling." >&2
fi

# 3. Pre-populate signal file ----------------------------------------------
# So existing Cursor windows show a meaningful title the moment you reload.
signal="$HOME/.claude-terminal-title"
initial_title=$(git -C "$PWD" branch --show-current 2>/dev/null || true)
[[ -z "$initial_title" ]] && initial_title="${PWD##*/}"
printf '%s' "$initial_title" > "$signal"
echo "✓ Pre-populated $signal with: $initial_title"

# 4. Extension --------------------------------------------------------------
ext_dir="$here/extension"
cd "$ext_dir"

editor=
if command -v cursor >/dev/null 2>&1; then editor=cursor
elif command -v code >/dev/null 2>&1; then editor=code
else
  echo "✗ Neither 'cursor' nor 'code' is on PATH. Install one or run vsce/install manually." >&2
  exit 1
fi

# Skip rebuild if a vsix matching the package version already exists.
ext_version=$(node -p "require('./package.json').version")
vsix="claude-terminal-title-$ext_version.vsix"
if [[ ! -f "$vsix" ]]; then
  if command -v vsce >/dev/null 2>&1; then
    vsce_cmd=(vsce)
  elif command -v npx >/dev/null 2>&1; then
    vsce_cmd=(npx --yes @vscode/vsce)
  else
    echo "✗ Need vsce or npx to build the extension." >&2
    exit 1
  fi
  "${vsce_cmd[@]}" package --no-dependencies >/dev/null
  echo "✓ Built $vsix"
else
  echo "✓ Reusing existing $vsix"
fi

"$editor" --install-extension "$ext_dir/$vsix" --force >/dev/null
echo "✓ Extension installed in $editor"

# 5. Final state ------------------------------------------------------------
cat <<EOF

Done.

If Cursor/VS Code is already running, reload the window once:
  Cmd+Shift+P → "Developer: Reload Window"

After that, every new session and every resumed conversation auto-titles to
your current branch or folder. Claude refines the title when you start a topic.

Manual title from any terminal:
  echo "My Title" > ~/.claude-terminal-title
EOF
