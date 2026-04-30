---
description: Set the active terminal tab title.
---

Set the terminal tab title to the user's argument.

Run:

```bash
bash ~/.claude/skills/terminal-title/scripts/set_title.sh "$ARGUMENTS"
```

Then briefly confirm the new title to the user (one short sentence).

If the extension's `updateMode` is set to `firstOnly` and the terminal has already been titled, the rename will be silently skipped — tell the user to run `Claude: Reset Terminal Title` from the Command Palette if they want Claude to be able to rename it again.
