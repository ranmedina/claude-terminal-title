<p align="center">
  <img src="https://raw.githubusercontent.com/ranmedina/claude-terminal-title/main/assets/icon.png" width="128" height="128" alt="Claude Terminal Title icon" />
</p>

<h1 align="center">Claude Terminal Title</h1>

<p align="center">
  <em>Stop guessing which terminal is which.<br/>Let Claude give them real names — automatically.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ranmedina/claude-terminal-title/main/assets/before-after.png" width="640" alt="Before: tabs say 'node' / 'zsh'. After: tabs say 'Auth Refactor', 'review · PR #42', etc." />
</p>

---

## Install

**One step.** In Cursor / VS Code:

1. Open the **Extensions panel** (`Cmd+Shift+X`)
2. Search **"Claude Terminal Title"**
3. Click **Install**

That's it. No terminal commands. No config.

---

## What happens after you click Install

🔍 **The extension finds every terminal already running Claude** and labels them `Claude • <folder>`. New ones get labeled the moment Claude starts.

✨ **Claude renames its own tab** once it understands what you're working on — usually after the first prompt or two. It picks short, meaningful titles like `Auth Refactor` or `BUG-42 Login Fix`.

🔒 **Once renamed, the title sticks.** No more flip-flopping every prompt. (Switch this in settings if you want continuous updates.)

🎯 **Override anytime** — `/title <name>` from inside Claude, or `Cmd+Shift+P → Claude: Set Terminal Title`.

---

## Settings

Open settings → search "claude terminal title":

| Setting | What it does |
|---|---|
| `updateMode` | `firstOnly` *(default)* — Claude renames once per terminal, then it's locked. `always` — Claude can rename whenever. |
| `skipClaudeIntegrationPrompt` | Mute the one-time install prompt. |

---

## Commands

All under `Cmd+Shift+P`:

| Command | When to use |
|---|---|
| `Claude: Set Terminal Title` | Manual rename. Also on the terminal right-click menu. |
| `Claude: Reset Terminal Title` | Undo the lock — let Claude rename again. |
| `Claude: Re-scan Terminals For Claude` | Found a Claude terminal that didn't get labeled? Run this. |
| `Claude: Install Claude Code Integration` | Re-runs the one-time skill setup if you skipped it. |

---

## 🔒 Privacy & safety

Short version: tiny, local, easy to read.

- **No network calls. Ever.** The extension is fully offline.
- **No telemetry, no analytics, no error reporting.** Nothing leaves your machine.
- **Only touches `~/.claude/` and `~/.claude-terminal-title`.** That's the whole file-access scope.
- **Asks before installing anything.** The Claude Code integration is opt-in — you'll see a prompt with `Install` / `Not now` / `Don't ask again`.
- **Backs up `~/.claude/settings.json`** to `settings.json.bak` before changing it, and uses an atomic write (temp-file + rename) — a crash can't leave it half-written.
- **Refuses malformed settings.** If your `settings.json` is broken JSON, the extension tells you and aborts — never silently overwrites.
- **Refuses symlink redirection.** The installer `lstat`s every destination and refuses to write through a planted symlink.
- **No shell exec.** Process detection uses `spawn` with array arguments — no string interpolation, no injection surface.
- **Strips control characters from titles** so a hostile title can't corrupt your terminal UI.
- **Open source, MIT.** Read the source on [GitHub](https://github.com/ranmedina/claude-terminal-title).

---

## How it works (one diagram)

```
   Claude (or you)            file watcher              your tab
   ───────────────            ─────────────             ─────────
   writes a title    ─►   ~/.claude-terminal-title  ─►  renamed ✨
```

OSC `\e]0;TITLE\a` doesn't propagate reliably through Claude's Bash subshell. A file is dumb and reliable — anything that can write a file can rename your tab.

---

<details>
<summary>🤖 What gets installed in <code>~/.claude/</code>?</summary>

When you accept the one-time prompt:

- `~/.claude/skills/terminal-title/SKILL.md` — tells Claude when to rename
- `~/.claude/skills/terminal-title/scripts/set_title.sh` — what Claude actually runs
- `~/.claude/commands/title.md` — the `/title <name>` slash command
- `~/.claude/settings.json` — gets a `SessionStart` hook that auto-titles new + resumed conversations to the current folder/branch

All of it removable from the extension's command palette.

</details>

<details>
<summary>📦 Distribute to your team</summary>

Tell them to install the extension from the Cursor/VS Code marketplace. That's it.

</details>

<details>
<summary>🔧 Build from source</summary>

```bash
git clone https://github.com/ranmedina/claude-terminal-title.git
cd claude-terminal-title/extension
npx @vscode/vsce package --no-dependencies
cursor --install-extension ./claude-terminal-title-*.vsix --force
```

</details>

<details>
<summary>🚀 Cut a new release (maintainers)</summary>

```bash
./publish.sh           # patch bump
./publish.sh minor
./publish.sh major

export OVSX_PAT="<from https://open-vsx.org/user-settings/tokens>"
./publish-openvsx.sh
```

</details>

---

<sub>MIT · made because tabs that say <code>node</code> are an insult.</sub>
