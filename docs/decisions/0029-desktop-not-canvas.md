# 0029 No canvas and no zoom; the desktop app is phase 2

Accepted 2026-11-02. Supersedes 0005. Amends 0001, 0007 and 0027. Changes SPEC §1, §2, §3, §4, §6, §7, §8, §10, §13 and §14, AGENTS.md's checklist and the add-source skill. Amended by 0036, which settles its open questions: the shell, packaging and updates, the review link, whose model it uses, and the threat model.

Adds: none

**Decision.**

- **No canvas.** Oriel has no canvas, in phase 2 or later. The overview's cards stay where the overview lays them out: the user doesn't place them, and no links are drawn between them. `packages/canvas` is never built.
- **No semantic zoom.** What Browse called its two zoom levels is plain disclosure: a cluster row opens to its items, and an item opens in the panel (0025). Nothing is summarized on the way, and there is no zoomed-out view to generate.
  - The principle behind it stays: trust at the coarse level. The overview shows computed things with their rules (0027), and any generated summary cites the items it rests on: the right rail's, and a line on a workstream card if one comes (OA-139).
  - SPEC §8's eval 7, "zoom faithfulness", becomes "summary faithfulness": a generated summary against the items it cites, graded for unsupported claims.
- **The desktop app is phase 2, and the next milestone.** It wraps the same server, as 0001's Consequences foresaw, and runs it on the user's machine. It is in scope. Nobody else gets Oriel until it is ready: pilots (OA-3, OA-48) and onboarding (OA-2, OA-6) wait for it.
- **Phase 2's local-first client layer is dropped.** The desktop app runs the server, its index and its database on the user's machine, so the data is already local. A client-side copy on top of it would be a caching layer, which SPEC §14 leaves out for now and 0027 adds only when a measurement needs it.

**Why.**

- The overview (0027) moved the product away from the canvas and semantic zoom, but 0027 kept both on paper, as SPEC and AGENTS.md did, so agents kept saying "zoom" for a row that opens and planning for a canvas.
- What Browse does is open a row. Calling it a zoom promises a generated coarse view that nobody has built and the overview doesn't need. The trust it was meant to protect lives in the rules the overview shows and the items a summary cites.
- The maintainer would rather a first user meets the desktop app than a maintainer-run web instance. The desktop app also gives a connection an OS keychain, which 0022 waited for.
- 0001's reason still holds for the review link, which opens in a browser for someone who has installed nothing. Its other reason, onboarding, no longer rules out an install: the budget's clock starts when the first writable source connects (SPEC §4).

**Rejected.**

- **A canvas, in phase 2 or as the overview's cards placed by the user.** The overview (0027) is built to answer the "how do these relate" question that justified one, with workstream cards, Linked clusters and one ranking across sources, and SPEC §13 now asks whether it does. A canvas is a large surface to build and maintain: pan and zoom, hit testing, gestures, inline editing, undo and HiDPI rendering, all our own code (0005), kept up by agents around the clock.
- **Keeping "zoom level" as the name for opening a row.** It names a generated coarse view Oriel doesn't have, and invites building one.
- **Keeping the local-first client layer.** On the desktop app it duplicates data already on the machine.
- **Pilots on a maintainer-run web instance first.** The maintainer's call: a first user meets the desktop app.

**Consequences.**

- 0005 is superseded. 0007's line on how the phase 2 canvas mounts no longer applies. 0027's consequence "Phase 2's canvas becomes the overview's cards…" is withdrawn, and SPEC §13's canvas criterion is rewritten as a question for the overview: if pilot PMs ask "how do these relate" and the overview can't answer it, the overview is missing what a canvas was for.
- 0001 is amended: Oriel is a web app served by one Node process and, from phase 2, a desktop app wrapping that same server. Pilots get the desktop app, not a hosted instance, and it may use the OS where that helps, as a keychain does. A review link must still open in a browser for someone who has installed nothing.
- Phase 2 no longer waits for phase 1 to feel magical to pilot PMs: pilots now come with the desktop app, so that gate can't come before it. SPEC §13's kill criteria are asked of pilots once they have it.
- How the desktop app is built (its shell, packaging and updates) is a later decision, with its own dependency ADR (0008). That decision also settles what a server on the user's machine changes:
  - how a review link made there reaches someone who has installed nothing (SPEC §1.2);
  - whose model key it uses, since SPEC §7 keeps the key out of the user's onboarding and 0020 assumes one instance per pilot;
  - the security reviewer's threat model, which assumes a hosted instance behind a secret link.
- 0022's connection store is the first thing the desktop app supersedes: an OS keychain behind `ConnectionStore`.
- The code keeps its zoom words until a story of its own tidies them, after Browse (OA-129, OA-130) merges, because it touches the same files. Until then, read a zoom level in the code as a cluster's row, its opened items or the item panel. The tidy covers these, with their callers, styles and tests:
  - `packages/core/src/zoom.ts`: `ZoomLevel`, `ZoomId` and the unused `Summary` and `summarize` go; the presentation types that share the file move.
  - `packages/groupings/src/zoom.ts` and the view types' comments: plain view builders for a cluster's row, its items and an item.
  - The web side's `Zoom`, `zoomOf` and `data-zoom`: a cluster is open or closed.
  - The `zoom.changed` telemetry event becomes a cluster opened or closed event. Events stored before keep their name, and a report maps them, as OA-98's renames are mapped.
  - Eval category 7's name in `packages/evals/src/case.ts`, and the fixture generator's "zoom stress" comment.
