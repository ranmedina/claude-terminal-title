#!/usr/bin/env bash
# Cuts a release: bumps version, packages the .vsix, creates a GitHub release.
# Usage: ./publish.sh [patch|minor|major]    (default: patch)
set -euo pipefail

bump=${1:-patch}
here=$(cd "$(dirname "$0")" && pwd)
ext_dir="$here/extension"

cd "$ext_dir"

# Bump version in package.json
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const [maj, min, pat] = p.version.split('.').map(Number);
  const next = '$bump' === 'major' ? \`\${maj+1}.0.0\`
              : '$bump' === 'minor' ? \`\${maj}.\${min+1}.0\`
              : \`\${maj}.\${min}.\${pat+1}\`;
  p.version = next;
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  console.log(next);
" > /tmp/.next-version
new_version=$(cat /tmp/.next-version)
echo "✓ Bumped to v$new_version"

# Package
rm -f claude-terminal-title-*.vsix
vsce_cmd=(vsce)
command -v vsce >/dev/null 2>&1 || vsce_cmd=(npx --yes @vscode/vsce)
"${vsce_cmd[@]}" package --no-dependencies >/dev/null
vsix=$(ls claude-terminal-title-*.vsix | head -n1)
echo "✓ Packaged $vsix"

# Commit + tag
cd "$here"
git add -A
git commit -m "release v$new_version" >/dev/null
git tag "v$new_version"
echo "✓ Committed and tagged v$new_version"

# Push + release
git push origin HEAD --tags
gh release create "v$new_version" "$ext_dir/$vsix" \
  --title "v$new_version" \
  --notes "Install: download the .vsix and run \`cursor --install-extension <path>\`."
echo "✓ Released v$new_version on GitHub"

cat <<EOF

Done. Teammates can install with:

  curl -L -o /tmp/cct.vsix \\
    https://github.com/ranmedina/claude-terminal-title/releases/download/v$new_version/$vsix
  cursor --install-extension /tmp/cct.vsix

Or via UI: Extensions panel → ⋯ → "Install from VSIX...".
EOF
