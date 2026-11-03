# 0045 The desktop app asks before quitting while Oriel works, and has its own icon

Accepted 2026-11-03. Amends 0036, 0039 and 0041.

Adds: none

**Decision.**

- **What counts as working.** A thread whose turn is running, or one of whose change sets is applying, a stalled apply and a done thread's revert included. Each thread counts once. The window chat is a thread here too.
- **The server tells the shell.** A channel request, `{"kind":"working","threads":N}`, each time the number changes, with 0 while the setting is off. The shell takes a server that has said nothing, or has stopped, as working on none. Settings changing makes the server look again.
- **Where it asks.** Quit in the app's menu (Cmd+Q) and the window's close button, while the number isn't 0: "Oriel is still working on N threads. Quit anyway?", with Quit, the default, and Cancel, which Escape picks. Quit quits as before. A quit from the Dock, the OS (logout or shutdown) or a signal doesn't ask.
- **The setting.** Ask before quitting while Oriel works, in a new General section of Settings, on by default, kept in `settings.json`. Only the desktop app shows the switch.
- **The icon.** `packages/desktop/icon.svg`, one file: an oriel, a bay window on its corbel, in Graphite's colours (0034), the panes in its dark accent. `pnpm desktop` draws it with `sips` and packs it with `iconutil` into `Oriel.icns`, in place of Electron's. The maintainer can replace the file.

**Why.**

- Quitting mid-turn throws the turn away, and quitting mid-apply leaves a change set partway written to its source. One question saves both.
- The server knows what's running and the shell knows when a quit comes. Telling the shell each change keeps the channel one way, the server asking, as 0036 has it, and the answer is there at once when Cmd+Q comes.
- Electron handles SIGTERM itself and emits `before-quit`, as it does for the Dock's Quit and a logout, with nothing to tell them from Cmd+Q. Asking there would hang a `kill` and hold up a logout behind a sheet, so it asks only from the person's own Quit and close.
- `sips` draws an SVG on macOS, so the icon needs no rasteriser and no dependency.

**Rejected.**

- **Asking in `before-quit`.** It asks on a signal too. Tried on the built app: a SIGTERM showed the question.
- **The shell asking the server when a quit comes.** A second direction on the channel, and an answer to wait for while the person waits.
- **A "Don't ask again" box in the question.** The shell can't change settings; the server keeps them. The switch is in Settings.
- **A PNG or .icns in the repo.** Binary, and drawn from something; the SVG is what the maintainer edits.

**Consequences.**

- 0036: the channel gains `working`; quitting asks first, from the menu and the window, while Oriel works.
- 0039: the app's icon is Oriel's.
- 0041: Settings gains a General section; "asking before quitting while a turn runs" is built.
