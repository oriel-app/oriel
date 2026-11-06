# 0044 What building the first run settled: the Claude Code Oriel checks, and a cluster the window chat can make a workstream of

Accepted 2026-11-03 (OA-191). Amends 0030, 0037 and 0038. Amended by 0059: the first run's source step is what 0059 says.

Adds: none

**Decision.**

- **Which Claude Code Oriel checks before running it.** 0038 has Oriel check the binary its install leaves before Oriel first runs it, and again whenever the file changes. That check guards every Claude Code whose file is in the folder Anthropic's installer keeps its versions in, `~/.local/share/claude/`: the one the first run installs, and one the person installed the same way. Oriel checks before each look, turn, title and command that would run it, and remembers a file that passed by its path, size, time and inode, so a file changed since, as when Claude Code updates itself, is checked again before it runs.
  - The check is `/usr/bin/codesign --verify --strict` against a requirement naming Apple's Developer ID and Anthropic PBC's Team ID, `Q6L2SF6YDW`, then `/usr/sbin/spctl --assess --type open --context context:primary-signature`, which assesses a command-line binary; the default `--type execute` refuses anything that isn't an app. Both run by absolute path, with the system PATH.
  - A Claude Code anywhere else, such as Homebrew's, npm's or one at a path set in Settings, is the person's own, and runs as 0037 says.
  - macOS only, for now. Windows' Authenticode check comes with its build.
- **The window chat can make a workstream of a cluster.** Its `window.overview()` read gives each cluster candidate its items' IDs, at most the 500 an action takes. An action in that run may take them, as Make a workstream copies a cluster on the page. Nothing reads them: reading one still takes a `search()`, which shows it, so 0030's "every reach outside the region shows" holds. It is what lets the first run's "Make … a workstream" do what it says for an epic.
- **The first run's end.** The overview's one-time line and the instruction "Make … a workstream" last until the person has a workstream; the line can be dismissed sooner. Reading the first sources opens the overview as soon as one is read and none failed. A failure waits for the person, with Open with what's ready.
- **Jira from its project list, everywhere.** The window's own connect form asks for the same three things as the first run, then the project from Jira's list, under `pnpm dev` too, which still connects only the throwaway site.
- **No AI, no terminal.** On the desktop app, a turn with no AI says to set one up in Settings, never to open a terminal.
- **Where the setup keeps its progress:** `setup.json` in the data folder, written whole and renamed into place, as `settings.json` is. It holds no credential.

**Why.**

- The checked folder is the one Anthropic's installer writes, whoever ran it. A native Claude Code there is always Anthropic's signed binary, so a failure means the file isn't what it claims. npm installs a script, which has no signature to check, and Homebrew and a path in Settings are the person's own choices.
- Checking at each run, cached by the file as it is, costs a stat when nothing changed, and is the only way to keep "again whenever the file changes" while Claude Code updates itself between Oriel's looks.
- Without a cluster's items, the agent could make a workstream of an epic alone, and its threads couldn't reach the epic's stories.
- A workstream on the overview is what the line explains and the instruction asks for; once there is one, both have done their job.

**Rejected.**

- **Checking every Claude Code.** It would refuse npm installs, whose program is a script.
- **Letting the agent make a workstream from a cluster by its key.** 0024 keeps a cluster's input the user's: a cluster's items aren't the agent's to name. The IDs the read returns are.
- **Showing a cluster's items as rows in the read's block.** Eight candidates of up to forty items each would bury the answer, and the action's line under the reply names every item it took.

**Consequences.**

- 0030: the window module's `Overview` type gains `items` on a cluster candidate, about 17 bytes, in window chats only. The window chat's eval cassettes are recorded again.
- 0037: the harness runs a Claude Code from the installer's folder only once the check passes.
- 0038: its "and again whenever the file changes" is built as above.
