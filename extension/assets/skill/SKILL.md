---
name: terminal-title
description: Update the Cursor / VS Code terminal tab title to reflect the current high-level task. Use at session start, when the user names a new task ("let's do X", "switching to Y"), or after a git checkout. Don't re-title on every prompt — only when the topic genuinely shifts.
---

# Terminal Title

When the active task shifts, run:

```
bash ~/.claude/skills/terminal-title/scripts/set_title.sh "<short title>"
```

## Title format

Just `<topic>`. Keep under 40 characters. Don't prefix with the repo or folder name — the tab icon and window already convey that.

Good:
- `Auth Refactor`
- `BUG-42 Login Fix`
- `review PR #42`
- `settings sidebar`

Bad:
- `myapp · settings sidebar` (repo prefix is redundant)
- `Working on the auth refactor feature for the app` (too long)
- `Helping the user with their task` (vague)
- `Bash` / `node` / `zsh` (default editor names — pointless)

## When to call

- **First substantive prompt of any session — including resumed ones.** Always re-set the title at session start. The cwd-based default from the SessionStart hook is a placeholder; refine it once you understand the topic.
- **Topic switch** — user pivots to a new ticket, file, or feature. Re-title.
- **Branch checkout** — if the new branch implies a new topic. Re-title.

## When NOT to call

- Every prompt. Don't be noisy. The whole point is the tab name actually means something.
- For trivial follow-up questions inside the current topic.
- Inside a tool result (the script will be invoked, but no need to announce it).

## Verification

After calling the script, briefly confirm to the user only if the rename was the *user's explicit ask*. Otherwise stay silent — the tab speaks for itself.

## Companion

Requires the `claude-terminal-title` Cursor / VS Code extension. Without it, `set_title.sh` is a no-op (it just writes to a file nothing reads).
