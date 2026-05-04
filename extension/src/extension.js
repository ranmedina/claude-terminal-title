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
// SessionStart hook is matcher-less ('.*') so it fires for every source
// (startup/resume/clear/compact). The tag is embedded in the command itself
// for dedup on re-install (a colon-prefixed shell no-op).
const SESSION_HOOK_TAG = 'claude-terminal-title';
// Hook delegates to set_title.sh --placeholder, which walks the process tree
// to find the originating terminal's PID and writes "<pid>\t<title>". That
// PID prefix lets the watcher scope the rename to the terminal that issued it.
// The trailing echo seeds Claude's session-start context with an explicit
// reminder to refine the placeholder once the conversation topic is clear —
// otherwise Claude often answers the user's question without ever invoking
// the terminal-title skill, leaving the placeholder stuck.
const SESSION_HOOK_CMD =
  ': ' + SESSION_HOOK_TAG + '; ' +
  'bash "$HOME/.claude/skills/terminal-title/scripts/set_title.sh" --placeholder; ' +
  'echo "[terminal-title] Title is the session-start placeholder. After your first response, refine it with a concise topic via: bash ~/.claude/skills/terminal-title/scripts/set_title.sh \\"<topic>\\""';

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
    let raw;
    try { raw = fs.readFileSync(SIGNAL_FILE, 'utf8'); } catch (_) { return; }
    if (!raw || raw === lastSeen) return;
    lastSeen = raw;

    // Format: "<originPid>\t<title>". Older format (no tab) is from before
    // the scoping change — ignore it; the next write will use the new format.
    const tab = raw.indexOf('\t');
    if (tab < 0) return;
    const originPid = Number(raw.slice(0, tab).trim());
    const title = raw.slice(tab + 1).trim();
    if (!Number.isFinite(originPid) || originPid <= 0 || !title) return;

    // Match the originPid to a terminal in this window. If none matches, the
    // call came from another window — skip silently. This is what scopes
    // /title to the originating terminal across windows.
    let target = null;
    for (const t of vscode.window.terminals) {
      try {
        const pid = await t.processId;
        if (pid === originPid) { target = t; break; }
      } catch (_) {}
    }
    if (!target) return;

    const cfg = vscode.workspace.getConfiguration('claudeTerminalTitle');
    const mode = cfg.get('updateMode') || 'firstOnly';
    const st = stateFor(target);
    // Placeholder format ("Claude" / "Claude • <folder>") is applied but
    // doesn't lock the terminal — Claude's later real-title write still wins.
    const isPlaceholder = title === 'Claude' || title.startsWith('Claude • ');
    const verdict = decide(st, title, { kind: 'signal', mode });
    if (verdict === 'skip-locked') {
      log(`firstOnly — skipping "${title}" (terminal already titled)`);
      return;
    }
    if (verdict === 'skip-noop') return;
    const ok = await applyTitle(target, title);
    if (ok) {
      if (isPlaceholder) st.placeholderApplied = true;
      else st.titled = true;
    }
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

const VERSION_MARKER = path.join(SKILL_DIR, '.installed-version');

function readInstalledVersion() {
  try { return fs.readFileSync(VERSION_MARKER, 'utf8').trim(); } catch (_) { return ''; }
}

function currentExtensionVersion(context) {
  try { return require(path.join(context.extensionPath, 'package.json')).version || ''; }
  catch (_) { return ''; }
}

// Re-run the install silently when the extension is newer than the wired-up
// files on disk — covers users who upgrade the extension but never re-trigger
// the manual install command.
function maybeRefreshInstall(context) {
  if (!isWiredUp()) return; // brand-new user — handled by offerToInstallClaudeIntegration
  const cur = currentExtensionVersion(context);
  if (!cur) return;
  if (readInstalledVersion() === cur) return;
  log(`refreshing wired skill: "${readInstalledVersion() || '(none)'}" → "${cur}"`);
  installClaudeIntegration(context, { silent: true }).catch((e) => log('refresh failed', String(e)));
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

async function installClaudeIntegration(context, opts = {}) {
  const { silent = false } = opts;
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
          if (!silent) {
            vscode.window.showErrorMessage(
              `Claude Terminal Title: ~/.claude/settings.json is malformed (${e.message}). ` +
              `Refusing to overwrite. Fix the file and run "Claude: Install Claude Code Integration" again.`
            );
          }
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
    // Dedup by tag embedded in the command — also catches stale entries from
    // older versions that put the tag in the `matcher` field instead.
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter((h) => {
      if (h.matcher === SESSION_HOOK_TAG) return false;
      return !(h.hooks || []).some((hh) => (hh.command || '').includes(SESSION_HOOK_TAG));
    });
    settings.hooks.SessionStart.push({
      matcher: '.*',
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

    // 5. Stamp the version marker so future activations can detect drift and
    //    refresh silently without prompting the user.
    try { fs.writeFileSync(VERSION_MARKER, currentExtensionVersion(context)); }
    catch (e) { log('version marker write failed', String(e)); }

    if (!silent) {
      vscode.window.showInformationMessage('Claude Terminal Title — Claude Code skill installed.');
    }
    log(silent ? 'silently refreshed wired skill files' : 'Wired up skill + SessionStart hook + /title command');
  } catch (e) {
    if (!silent) {
      vscode.window.showErrorMessage(`Claude Terminal Title — install failed: ${e.message}`);
    }
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

  // If the user already wired up a previous version, silently bring it up to
  // date with the bundled assets.
  maybeRefreshInstall(context);

  const cfg = vscode.workspace.getConfiguration('claudeTerminalTitle');
  if (!cfg.get('skipClaudeIntegrationPrompt')) {
    setTimeout(() => offerToInstallClaudeIntegration(context), 2500);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
