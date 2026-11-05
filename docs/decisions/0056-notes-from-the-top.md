# 0056 Notes from the top

Accepted 2026-11-04, from the two note proposals the maintainer asked for ("the bead it is"). Amends 0034. Changes nothing in SPEC.

Adds: none

**Decision.**

- **The one stack of Undo notes (OA-142) shows in the bead.** The bead is an ink pill at the top centre of the page column, on the window's top line. What it says is still a note; "bead" names the place.
  - **Where.** It is fixed, centred on the page column, level with the sidebar head and the rail title. It stays clear of the sidebar, and of the item panel or window chat where either lies over the page (760–1100 px for the panel, any wide screen for the window chat): it centres on what's left, and wraps to fit. Below about 880 px with the panel open, what's left is under 10rem, and the bead keeps that width, reaching over their edges. In the narrow bar it sits centred, clear of the menu. It never reaches the composer, the ask bar or the window chat. Browse's bar for picked items no longer pushes it up.
  - **What it may cover.** The crumb's row, a page title on the top line, and on a phone the brand, for the note's life. Where it would cover a control on the page, the page moves down under it until the note goes, rather than be covered. A covered control is worse than it looks: pointing at it holds the bead open over it. Measured at 1280 and 1024 px, the cases today are: the overview's counts; Browse's grouping tabs, and its view tabs with the panel over it; a workstream's name, which is a field to rename it; and a thread's Mark done under a failure long enough to take two lines. A thread's crumb, the new thread page, Settings and the Done page lose nothing, and in the narrow bar it covers only the brand. Held open as a list, it may hang over the page: that is the person's doing.
  - **Look.** Ink in light: the page's text colour, written in the paper's. In the dark, darker than the page, with a `--line-strong` hairline. Its state colours are the theme's, mixed 45% toward `--bg` in light so they read on ink.
  - **Shape and motion.** It grows from a dot and changes shape between notes. A note that keeps its key changes in place: Applying becomes Applied, and a failed apply its problem. Its words lay out at their final width, centred, so the edges move and the words don't. Words come in with a 2px blur and go faster than they came. Going, it shrinks back to the dot and fades.
- **States.**
  - **A note:** what was done, with Undo and ⌘Z or Ctrl+Z (hidden on touch).
  - **An approval** with After you approve set to go on: "You approved “…”. Applying…", with a breathing dot and Back. It shows **Applied** with a check that draws itself only when the approval's own answer says the change set applied. Its words are never read for it: a note carries an optional `mark` (`applying`, `applied` or `caught-up`). If the answer says the apply stopped, or the approval was refused once accepted, the note becomes the failure. If the answer hasn't come when the note runs out, it simply goes, and the thread lands in Needs you as before.
  - **All caught up:** Oriel's mark draws, its three panes light one by one, and one glint crosses the pill, in about 1.6 s. It is the only whimsy beyond the spring, and it plays once.
  - **Several notes:** the newest, with a count and one or two edges underneath. Pointer or focus opens them as a list, newest first, each with its Undo.
  - **A failure:** a danger mark, the problem and Dismiss, with no spring. It stays until dismissed, wherever the page goes. It takes its place among the notes by when it showed, so a note made after it is the face, with the failure behind it until the note goes. A close from a list that failed is one of these now, not a box of its own.
  - **Time left:** a hairline at its foot drains over the note's time and stops while it is held. Notes still run 8 s, and none runs out while the pointer or focus is on the bead.
- **Keyboard and screen readers.**
  - **F8 shows the notes,** from anywhere, a text field included: it focuses the newest note's action, where focus holds the bead open. Escape goes back to where focus was. Measured: from a workstream's ask bar the bead's Undo was 11 Tab stops away, after a removal's × 3, and after the sidebar's menu 4. Tab can't reach it before a note runs out from where focus usually sits. F8 is free in Chrome and the desktop app, and is the key other apps use to jump to notifications.
  - One `role="status"` region, always there, announces each note once as it shows, and again only if what it says changes, as Applying to Applied. Its `heard` text, such as "Now on “…”", is read with it. A failure is announced through one `role="alert"`.
- **Tokens: 0034 amended.** 0034 dropped the 999px pills and allows radius only from tokens, and motion only from `--duration-quick`, `--duration-move` and `--ease-out`.
  - **Added theme tokens:** `--duration-morph` (440ms) and `--ease-spring`, a sampled damped spring about 5% over, as a `linear()` easing, for a shape that changes; `--bead-radius`, which Graphite sets to `1rem` (a dot at rest, a pill on one line, a card on two) and Broadsheet to `2px` (a printed slip); and `--bead`, the ink.
  - `--bead` is a colour token because the dark ink is darker than any token, and 0034 allows a literal colour only in a theme block. Each theme sets it in both schemes: its text in light, a near black in the dark.
  - **Shared and derived, on `html`:** `--bead-text`, `--bead-faint`, `--bead-ring`, `--bead-accent`, `--bead-working`, `--bead-done`, `--bead-danger` and `--bead-dot`.
  - The theme check gains what the bead writes on its ink: each of those colours on `--bead`, at 4.5:1 or more, in every theme and scheme.
  - Every other motion value in the bead's rules is one of the five motion tokens, or `calc()` over them. Two aren't tokens, by their nature: the hairline drains `linear` over the note's own time, and the breathing dot reuses the one `pulse`, which stays literal as 0034 says.
- **Reduced motion.** Only fades remain, in 0034's one block. The bead arrives at its size and fades in, swaps its words at once, shows its marks drawn, and fades out where it is. There is no spring, no glint and no hairline, and the page's move to make room is instant.

**Why.**

- The maintainer: "the little all done toast is ugly and i dont like that it covers the input, can our toast come in from the top… a little whimsy". The foot of the window is where the composer and the ask bar are, so the stack covered what the person was about to use. The top line is the one place every page shares and nobody types.
- Two designers proposed. The bead keeps the window clean at rest, with no permanent lane. The other proposal reserved an 88px lane under the top line on every page, and the bead takes two of its ideas: a key to reach the notes, and one live region.
- "Applied" from the answer, not the words: a note that says applied when nothing applied is the one thing a change-set tool can't say. The approval's answer is the change set's own state after its apply, so the bead reads that.
- Making room rather than covering: the bead must never hide a control someone needs for its 8 s, and on the overview and Browse the row under the top line is the ask bar or the search, so the bead has nowhere lower to go. The page moving down is the smaller cost, and scroll anchoring keeps a scrolled page still.

**Rejected.**

- **A permanent lane for notes** (the other proposal): about 88px of every page, always, for something that shows a few seconds at a time.
- **Inferring Applied from the note's words, or from the thread list's state.** The list says only that a thread no longer waits on an apply, not whether it applied.
- **A pill radius of 999px.** 0034 removed it; `--bead-radius` is a token each theme can set, and 1rem is a pill at one line.
- **Tab order alone.** It was 3 to 11 stops from where focus sits after making a note.

**Consequences.**

- `.undos`, `.undo`, `.undo-note` and `.closing-problem` go. `.undo-action` stays, as `UndoButton` also sits beside the changes it undoes (0024).
- `pnpm shots` has a scene for each state, `bead-…`, and one per page's top line, `bead-on-…`.
- The design system's toast and undo pages follow once the maintainer has reviewed it.
