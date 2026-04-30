const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectClaude, formatLabel, truncateTitle } = require('./title');
const { decide } = require('./state');

const HOME = os.homedir();
const SIGNAL_FILE = path.join(HOME, '.claude-terminal-title');
const SKILL_DIR = path.join(HOME, '.claude', 'skills', 'terminal-title');
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const SESSION_HOOK_MATCHER = 'claude-terminal-title';
const SESSION_HOOK_CMD =
  'title=$(git -C "$PWD" branch --show-current 2>/dev/null); ' +
  '[[ -z "$title" ]] && title="${PWD##*/}"; ' +
  'printf "%s" "$title" > "$HOME/.claude-terminal-title"';

let output;
function log(...args) {
  if (!output) output = vscode.window.createOutputChannel('Claude Terminal Title');
  output.appendLine(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
}

// ────────────────────────────────────────────────────────────────────────────
// Per-terminal state — using WeakMap so closed terminals get GC'd
// ────────────────────────────────────────────────────────────────────────────
const states = new WeakMap();
function stateFor(t) {
  if (!states.has(t)) {
    states.set(t, {
      isClaude: false,            // confirmed: claude is/was running here
      placeholderApplied: false,  // we've applied "Claude • <folder>"
      titled: false,              // a real (Claude-picked) title is set; in firstOnly mode this locks
      lastAppliedTitle: null,     // remember our last write to avoid redundant renames
    });
  }
  return states.get(t);
}

// ────────────────────────────────────────────────────────────────────────────
// Single rename primitive — restores previously active terminal so we don't
// thrash the user's focus
// ────────────────────────────────────────────────────────────────────────────
async function applyTitle(terminal, title) {
  if (!terminal) return false;
  const t = truncateTitle(title);
  if (!t) return false;
  const st = stateFor(terminal);
  // Already at this title? Skip.
  if (st.lastAppliedTitle === t && terminal.name === t) return false;
  const previouslyActive = vscode.window.activeTerminal;
  terminal.show(true); // preserveFocus=true
  await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: t });
  st.lastAppliedTitle = t;
  // Restore visibility of whatever was focused before, unless it's the same terminal
  if (previouslyActive && previouslyActive !== terminal) {
    try { previouslyActive.show(true); } catch (_) {}
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Detect Claude in a terminal by walking the shell's process tree
// ────────────────────────────────────────────────────────────────────────────
function processTreeContainsClaude(pid) {
  return detectClaude(pid);
}

function folderHint(terminal) {
  const cwd = terminal.shellIntegration?.cwd?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) return null;
  return path.basename(cwd);
}

async function ensureClaudePlaceholder(terminal) {
  const st = stateFor(terminal);
  if (decide(st, null, { kind: 'placeholder', mode: 'firstOnly' }) !== 'apply-placeholder') return;
  const label = formatLabel(folderHint(terminal));
  const ok = await applyTitle(terminal, label);
  if (ok) st.placeholderApplied = true;
}

async function scanAllTerminals() {
  for (const t of vscode.window.terminals) {
    const st = stateFor(t);
    // Skip terminals we've already handled — this is what kills the focus thrash.
    if (st.titled || st.placeholderApplied) continue;
    try {
      const pid = await t.processId;
      if (!pid) continue;
      if (processTreeContainsClaude(pid)) {
        st.isClaude = true;
        await ensureClaudePlaceholder(t);
      }
    } catch (e) {
      log('scan failed', String(e));
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Signal file watcher
// ────────────────────────────────────────────────────────────────────────────
function setupSignalWatcher(context) {
  fs.mkdirSync(path.dirname(SIGNAL_FILE), { recursive: true });
  if (!fs.existsSync(SIGNAL_FILE)) fs.writeFileSync(SIGNAL_FILE, '');

  let lastSeen = '';
  const apply = async () => {
    let next;
    try { next = fs.readFileSync(SIGNAL_FILE, 'utf8').trim(); } catch (_) { return; }
    if (!next || next === lastSeen) return;
    lastSeen = next;

    const cfg = vscode.workspace.getConfiguration('claudeTerminalTitle');
    const mode = cfg.get('updateMode') || 'firstOnly';
    const target = vscode.window.activeTerminal;
    if (!target) return;
    const st = stateFor(target);
    const verdict = decide(st, next, { kind: 'signal', mode });
    if (verdict === 'skip-locked') {
      log(`firstOnly — skipping "${next}" (terminal already titled)`);
      return;
    }
    if (verdict === 'skip-noop') return;
    const ok = await applyTitle(target, next);
    if (ok) st.titled = true;
  };

  try {
    const watcher = fs.watch(SIGNAL_FILE, { persistent: false }, () => apply());
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (_) {
    const id = setInterval(apply, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(id) });
  }
  apply();
}

// ────────────────────────────────────────────────────────────────────────────
// One-time Claude Code wiring
// ────────────────────────────────────────────────────────────────────────────
function isWiredUp() {
  return fs.existsSync(path.join(SKILL_DIR, 'SKILL.md'));
}

async function offerToInstallClaudeIntegration(context) {
  if (isWiredUp()) return;
  const choice = await vscode.window.showInformationMessage(
    'Claude Terminal Title can install a small skill so Claude picks meaningful titles automatically. Install?',
    'Install',
    'Not now',
    "Don't ask again"
  );
  if (choice === 'Install') await installClaudeIntegration(context);
  else if (choice === "Don't ask again") {
    await vscode.workspace
      .getConfiguration('claudeTerminalTitle')
      .update('skipClaudeIntegrationPrompt', true, vscode.ConfigurationTarget.Global);
  }
}

// Refuse to write through a symlink — defends against a planted symlink redirecting our writes.
function refuseIfSymlink(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write through symlink at ${filePath}`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') return; // not a symlink — file just doesn't exist yet
    throw e;
  }
}

// Atomic JSON write: tmp + rename. Avoids leaving a half-written settings file if we crash.
function atomicWriteJSON(filePath, obj) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

async function installClaudeIntegration(context) {
  try {
    // 1. Read existing settings safely. NEVER silently overwrite a malformed file.
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    let settings = {};
    let settingsExisted = false;
    if (fs.existsSync(SETTINGS_FILE)) {
      settingsExisted = true;
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      if (raw.trim()) {
        try {
          settings = JSON.parse(raw);
          if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
            throw new Error('settings.json is not a JSON object');
          }
        } catch (e) {
          vscode.window.showErrorMessage(
            `Claude Terminal Title: ~/.claude/settings.json is malformed (${e.message}). ` +
            `Refusing to overwrite. Fix the file and run "Claude: Install Claude Code Integration" again.`
          );
          log('install aborted: settings.json malformed', String(e));
          return;
        }
      }
    }

    // 2. Install SKILL.md + script. Refuse to follow symlinks at any destination.
    const bundled = path.join(context.extensionPath, 'assets', 'skill');
    fs.mkdirSync(path.join(SKILL_DIR, 'scripts'), { recursive: true });
    const skillDest = path.join(SKILL_DIR, 'SKILL.md');
    const scriptDest = path.join(SKILL_DIR, 'scripts', 'set_title.sh');
    refuseIfSymlink(skillDest);
    refuseIfSymlink(scriptDest);
    fs.copyFileSync(path.join(bundled, 'SKILL.md'), skillDest);
    fs.copyFileSync(path.join(bundled, 'scripts', 'set_title.sh'), scriptDest);
    fs.chmodSync(scriptDest, 0o755);

    // 3. Update settings — backup then atomic-write.
    settings.hooks ||= {};
    settings.hooks.SessionStart ||= [];
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter((h) => h.matcher !== SESSION_HOOK_MATCHER);
    settings.hooks.SessionStart.push({
      matcher: SESSION_HOOK_MATCHER,
      hooks: [{ type: 'command', command: SESSION_HOOK_CMD }],
    });
    if (settingsExisted) {
      try { fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.bak'); } catch (_) { /* best-effort */ }
    }
    refuseIfSymlink(SETTINGS_FILE);
    atomicWriteJSON(SETTINGS_FILE, settings);

    // 4. /title slash command.
    const cmdsDir = path.join(HOME, '.claude', 'commands');
    fs.mkdirSync(cmdsDir, { recursive: true });
    const cmdSrc = path.join(context.extensionPath, 'assets', 'commands', 'title.md');
    const cmdDest = path.join(cmdsDir, 'title.md');
    if (fs.existsSync(cmdSrc)) {
      refuseIfSymlink(cmdDest);
      fs.copyFileSync(cmdSrc, cmdDest);
    }

    vscode.window.showInformationMessage('Claude Terminal Title — Claude Code skill installed.');
    log('Wired up skill + SessionStart hook + /title command');
  } catch (e) {
    vscode.window.showErrorMessage(`Claude Terminal Title — install failed: ${e.message}`);
    log('install failed', String(e));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Activate
// ────────────────────────────────────────────────────────────────────────────
function activate(context) {
  log('activated');

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeTerminalTitle.setTitle', async () => {
      const t = vscode.window.activeTerminal;
      if (!t) return;
      const title = await vscode.window.showInputBox({
        prompt: 'Terminal title',
        placeHolder: 'e.g. Auth Refactor',
        value: t.name || '',
      });
      if (title) {
        const ok = await applyTitle(t, title);
        if (ok) stateFor(t).titled = true;
      }
    }),
    vscode.commands.registerCommand('claudeTerminalTitle.resetTitle', async () => {
      const t = vscode.window.activeTerminal;
      if (!t) return;
      const st = stateFor(t);
      st.titled = false;
      st.placeholderApplied = false;
      st.lastAppliedTitle = null;
      await ensureClaudePlaceholder(t);
    }),
    vscode.commands.registerCommand('claudeTerminalTitle.installClaudeIntegration', () => installClaudeIntegration(context)),
    vscode.commands.registerCommand('claudeTerminalTitle.scanNow', () => scanAllTerminals())
  );

  setupSignalWatcher(context);

  scanAllTerminals();

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => {
      // give the shell ~1.5s to start a Claude child if it's going to
      setTimeout(() => {
        t.processId.then((pid) => {
          if (!pid) return;
          if (processTreeContainsClaude(pid)) {
            stateFor(t).isClaude = true;
            ensureClaudePlaceholder(t);
          }
        });
      }, 1500);
    }),
    vscode.window.onDidCloseTerminal((t) => states.delete(t))
  );

  if (vscode.window.onDidStartTerminalShellExecution) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((evt) => {
        const cmd = evt.execution?.commandLine?.value || '';
        if (/^\s*claude(\s|$)/.test(cmd)) {
          stateFor(evt.terminal).isClaude = true;
          ensureClaudePlaceholder(evt.terminal);
        }
      })
    );
  }

  // Periodic rescan at 30s — cheap because terminals already labeled are skipped
  const rescan = setInterval(scanAllTerminals, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(rescan) });

  const cfg = vscode.workspace.getConfiguration('claudeTerminalTitle');
  if (!cfg.get('skipClaudeIntegrationPrompt')) {
    setTimeout(() => offerToInstallClaudeIntegration(context), 2500);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
