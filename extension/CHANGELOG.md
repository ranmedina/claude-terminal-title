# Changelog

## 1.1.0

**Breaking:** the signal file format changed from `<title>` to `<originPid>\t<title>`. Old extensions reading a new write (or new extensions reading an old write) will silently skip — no data loss, just a missed rename. After upgrading, the next `set_title.sh` call refreshes everything.

### Added
- **Cross-window scoping.** `set_title.sh` walks the process tree to the terminal's shell PID and embeds it in the signal file. Each window's watcher only renames the terminal whose PID matches — calling `/title` in window A no longer renames the active terminal in window B.
- **Silent auto-refresh on upgrade.** `~/.claude/skills/terminal-title/.installed-version` is stamped on install. On activation, if the marker is missing or stale, the extension re-runs the install logic silently to bring the wired-up `SKILL.md`, `set_title.sh`, `/title` command, and SessionStart hook in sync with the bundled assets.
- **SessionStart hook nudge.** The hook now writes a `Claude • <branch-or-folder>` placeholder *and* echoes a one-line reminder to the new session's context so Claude is prompted to refine the placeholder once the conversation topic is clear.
- **`set_title.sh --placeholder`** flag — single source of truth for the bootstrap title, used by the SessionStart hook.

### Fixed
- **SessionStart hook never fired.** The matcher was `"claude-terminal-title"`, which is regex-matched against the SessionStart source (`startup` / `resume` / `clear` / `compact`) and matched none — so the hook silently did nothing. Matcher is now `".*"`; dedup uses a tag embedded in the command itself.
- **Placeholder writes locked the terminal in `firstOnly` mode.** Bootstrap titles set `placeholderApplied` instead of `titled`, so a later real title from Claude can still take effect.

### Changed
- **Title format:** `SKILL.md` now recommends bare `<topic>` instead of `<repo> · <topic>` — the tab icon and window already convey the repo.

## 1.0.1

Initial public release.
