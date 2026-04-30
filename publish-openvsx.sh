#!/usr/bin/env bash
# Publish the latest .vsix to Open VSX Registry — Cursor's default extension marketplace.
#
# One-time setup (browser):
#   1. Go to https://open-vsx.org and sign in with GitHub.
#   2. Profile → Settings → Generate New Token. Save it.
#   3. Profile → Namespaces → claim a namespace matching the publisher in
#      extension/package.json (currently: "ranmedina"). Or change the publisher
#      field to a namespace you control and re-package.
#   4. Export the token in your shell:
#        export OVSX_PAT="<token>"
#
# Then run: ./publish-openvsx.sh
set -euo pipefail

if [[ -z "${OVSX_PAT:-}" ]]; then
  echo "✗ OVSX_PAT env var not set." >&2
  echo "  Get a token at https://open-vsx.org → Profile → Settings → Generate New Token" >&2
  echo "  Then: export OVSX_PAT=\"<token>\"" >&2
  exit 1
fi

here=$(cd "$(dirname "$0")" && pwd)
ext_dir="$here/extension"
cd "$ext_dir"

vsix=$(ls claude-terminal-title-*.vsix 2>/dev/null | sort -V | tail -n1 || true)
if [[ -z "$vsix" ]]; then
  echo "✗ No .vsix found. Run ./publish.sh first or build with: cd extension && npx --yes @vscode/vsce package --no-dependencies" >&2
  exit 1
fi

if command -v ovsx >/dev/null 2>&1; then
  ovsx_cmd=(ovsx)
elif command -v npx >/dev/null 2>&1; then
  ovsx_cmd=(npx --yes ovsx)
else
  echo "✗ Need ovsx or npx." >&2
  exit 1
fi

"${ovsx_cmd[@]}" publish "$vsix" -p "$OVSX_PAT"
echo "✓ Published $vsix to Open VSX"
echo
echo "Cursor users can now install with:"
publisher=$(node -p "require('./package.json').publisher")
name=$(node -p "require('./package.json').name")
echo "  cursor --install-extension $publisher.$name"
echo
echo "Or search for \"Claude Terminal Title\" in the Cursor Extensions panel."
