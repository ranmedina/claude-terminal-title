// Pure logic — no VS Code APIs — so it can be unit-tested with `node:test`.
const { spawnSync } = require('child_process');

const MAX_TITLE = 80;
const MAX_PROCESS_TREE_VISITED = 200;

function truncateTitle(input) {
  return (input == null ? '' : String(input))
    // Strip ASCII control characters so a title can't corrupt the UI
    // or smuggle escape sequences into the tab label.
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, MAX_TITLE);
}

function formatLabel(folder) {
  return folder ? `Claude • ${folder}` : 'Claude';
}

// No-shell process runner. Array args = no injection surface, ever.
function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2000 });
  return r && r.stdout ? r.stdout : '';
}

// Allow tests to inject a fake runner of shape (cmd, args) => string.
function detectClaude(pid, run = defaultRun) {
  const root = Number(pid);
  if (!Number.isInteger(root) || root <= 0) return false;
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    if (seen.size >= MAX_PROCESS_TREE_VISITED) break;
    const p = stack.pop();
    if (!Number.isInteger(p) || p <= 0 || seen.has(p)) continue;
    seen.add(p);
    let cmd = '';
    try { cmd = String(run('ps', ['-o', 'command=', '-p', String(p)])).trim(); } catch (_) {}
    if (isClaudeCommand(cmd)) return true;
    let kids = '';
    try { kids = String(run('pgrep', ['-P', String(p)])).trim(); } catch (_) {}
    if (kids) {
      for (const k of kids.split('\n')) {
        const n = Number(k);
        if (Number.isInteger(n) && n > 0) stack.push(n);
      }
    }
  }
  return false;
}

function isClaudeCommand(cmd) {
  if (!cmd) return false;
  // Bare invocation: "claude" or "/usr/local/bin/claude --some-flag"
  if (/(^|\/)claude(\s|$)/.test(cmd)) return true;
  // Node CLI: ".../node .../@anthropic-ai/claude-code/cli.js ..."
  if (/\.claude\b.*\bcli\.js/.test(cmd)) return true;
  if (/\bclaude-code\/cli\.js/.test(cmd)) return true;
  return false;
}

module.exports = { truncateTitle, formatLabel, detectClaude, isClaudeCommand, MAX_TITLE };
