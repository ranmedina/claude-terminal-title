#!/usr/bin/env bash
# Publish the latest .vsix to the Visual Studio Code Marketplace.
#
# One-time setup (browser):
#   1. Sign in at https://dev.azure.com with the Microsoft account that owns
#      (or will own) your VS Code publisher.
#   2. User Settings (top-right) → Personal Access Tokens → New Token.
#        Organization: "All accessible organizations"
#        Scopes: "Custom defined" → check Marketplace → Manage
#      Save the token.
#   3. Create the publisher (once) at https://marketplace.visualstudio.com/manage
#      using the same publisher ID as extension/package.json (currently:
#      "ranmedina"). Or change the publisher field and re-package.
#   4. Export the token in your shell:
#        export VSCE_PAT="<token>"
#
# Then run: ./publish-vscode.sh
set -euo pipefail

if [[ -z "${VSCE_PAT:-}" ]]; then
  echo "✗ VSCE_PAT env var not set." >&2
  echo "  Get a token at https://dev.azure.com → User Settings → Personal Access Tokens" >&2
  echo "  Scope: Marketplace → Manage. Then: export VSCE_PAT=\"<token>\"" >&2
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

if command -v vsce >/dev/null 2>&1; then
  vsce_cmd=(vsce)
elif command -v npx >/dev/null 2>&1; then
  vsce_cmd=(npx --yes @vscode/vsce)
else
  echo "✗ Need vsce or npx." >&2
  exit 1
fi

"${vsce_cmd[@]}" publish --packagePath "$vsix" --pat "$VSCE_PAT"
echo "✓ Published $vsix to VS Code Marketplace"
echo

publisher=$(node -p "require('./package.json').publisher")
name=$(node -p "require('./package.json').name")
echo "VS Code users can now install with:"
echo "  code --install-extension $publisher.$name"
echo
echo "Or visit: https://marketplace.visualstudio.com/items?itemName=$publisher.$name"
echo "(Listing may take a minute or two to appear.)"
