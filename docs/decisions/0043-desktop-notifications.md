# 0043 Desktop notifications when a thread needs the person, and the folder picker

Accepted 2026-11-03 (OA-184). Amends 0036 and 0041.

Adds: none

**Decision.**

- **When.** A thread that newly waits on the person, by the same test as Needs you (`waitsOnUser`): a change set to review, an answer waiting for their reply, a message held for them, or an apply that stalled. A thread that waits on them in a new way, such as a change set after an answer, is new again. Nothing is said for what already waited when the server started or while notifications were off, or for a thread with no message yet. The window chat follows Needs you too: a change set or a held message there is told, an answer never is (0027).
- **Only when the window isn't in front.** The server asks the shell for each one; the shell shows it only while its window isn't focused, since the person is otherwise looking at the window already.
- **What it says.** The title is Oriel's own wording for the reason, such as "A change set waits for your review". The body is the thread's title, which may come from synced content, so it is plain text: the shell puts it on one line, and on Linux, whose notification servers read a body's tags, escapes `&`, `<` and `>`.
- **A click** brings the window forward on the thread: the request names a path on the server's origin, which the shell checks before it loads it.
- **The setting.** One switch, Notifications in Settings, on by default, kept in `settings.json` (0041). Only the desktop app shows it.
- **The folder picker.** On the desktop app, adding a folder opens the system's folder picker, through the shell (`folder.pick`), and the folder picked is connected exactly as a typed path is, through `source.connect`. Cancelling changes nothing. `pnpm dev` keeps the typed path.

**Why.**

- The person leaves Oriel while the agent works. Needs you already says what waits on them; a notification says it when they aren't looking.
- Asking the server, which asks the shell, keeps 0036's rule that the page has no bridge to the shell, and the focus rule in the shell, the only part that knows it.

**Rejected.**

- **Notifying while the window is in front.** The sidebar's Needs you already shows it.
- **One switch per reason.** One switch until someone asks for more.

**Consequences.**

- 0036: `notify` gains `open`, the path a click shows.
- 0041: Settings gains a Notifications section; "a desktop notification when something needs the person" is built.
- The first run's folder step (0038) posts to the same `POST /api/folder/pick`.
