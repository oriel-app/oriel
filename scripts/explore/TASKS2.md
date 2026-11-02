# Rounds 10 to 14: asking and acting

Written before round 10 and not changed after. Spike only (window-explore); nothing here merges.

Rounds 0 to 9 only scored reading: every task was an answer to find on the screen. The maintainer
asked how to chat with the window, ask for insights, change things, run tasks and ask for a chart.
This phase adds 0027's window chat to the overview and scores asking and acting.

## The chat is mocked

No model calls in the window. The rail's answers come from `ask.ts`: a fixed set of questions,
matched by pattern and answered from the world by the same kind of reads 0027 gives the window
chat's agent (`window.overview()`, `search()`). The answer has the shape a real agent's turn would
render: a few lines of text, and typed blocks (a table, a bar chart, rows of items), each block
built from a read's result, never from the agent's words. Anything else gets "I can't answer that
in this prototype" and the questions it can answer. What's scored is the design: where you ask,
how answers read, how acting and pinning work. Not the agent.

## The tasks

Each has one ground truth per world, computed by `askTruth()` in `ask.ts` from the world's data,
never from a design.

| #   | Task                                                                                                                  | Ground truth                                                                  | Judged        |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| A1  | Ask which sources changed most since you looked (a table). Which changed second most, and how many items?             | per source, items with a change-log entry after last-seen; the second most    | yes           |
| A2  | Ask for a chart of what moved since you looked, by workstream. Which moved second most, and how many?                 | the open workstream with the second most members changed after last-seen      | yes           |
| A3  | Make a workstream of the top thing not in a workstream. What is it called, and how many items does it hold?           | T4's epic: its title, and 1 + its children                                    | yes           |
| A4  | Pin A2's answer to the overview, so it is there next time.                                                            | after a reload, the top two workstreams and the top count on the first screen | measured only |
| A5  | Ask about the stalled workstream, with the workstream itself cited. Which item in it changed last, how many days ago? | T3's workstream; its member with the latest update, and the days since        | yes           |

A1 first asked who has items in progress in the workstream that moved most. Building the answers, before
round 10 ran, showed every person there has one, so it had no single answer; it became the sources
table above.

The judge sees the screen after the design's scripted path for that task: one viewport
screenshot, as the user sees it when the answer arrives. The judge doesn't see the path.

## Worlds, widths, views

The large world only (4,000 items, 10 sources, 40 workstreams), laptop 1280×800 and narrow
600×800. The chat's room matters most where the page is fullest, and dropping medium halves the
judging cost.

## Scores

- **reading**: T1–T4, T6, T7 judged on the large world at both widths, as in TASKS.md, with
  the chat present and empty: out of 12.
- **asking**: A1, A2, A3, A5 judged at both widths: out of 8.
- **score** = reading + asking, out of 20.
- Measured, large world at both widths: ttfup, dom, screens, visible (T1–T4, T6, T7 on the first
  screen) as in TASKS.md; **asking steps**: clicks, keys and typed strings per task A1–A5 (typing
  a question is 1, Enter is 1, a click is 1), or no path; **ask in view**: a place to ask is on
  the first screen without scrolling.

Round 9 is the baseline, without a chat. Its reading is round 9's judged answers on the large
world (11.5 of 12), not judged again. Its only asking path is A3, through Make a workstream; A1,
A2, A4 and A5 have no path and score 0 unjudged.

## Reviewer

One fresh reviewer per round, as in TASKS.md, seeing the overview's first two screens and each
asking task's screen, at both widths. TASKS.md's rubric, plus:

6. Asking: is it clear where to ask, are answers (tables, charts) readable at a glance, and are
   they clearly set apart from the overview's own facts?

## The keep rule

A candidate replaces the current best only if **both**:

1. its **score** is strictly higher than the best's; or it is equal, its asking steps (summed
   over A1–A5 at both widths) are strictly fewer, and the reviewer's mean is not lower; and
2. on the large world, at both widths, it doesn't lose on the measured scores: ttfup no more than
   10% or 100 ms worse (whichever is larger), dom no more than 10% larger (25% in round 10, whose
   baseline has no chat), screens no more than 10% or 0.5 more, visible not fewer, ask in view not
   lost, and no task (T1–T7, A1–A5) gains a "no path".

Rounds 0 to 9 had no tie-break, and threw away rounds 8 and 9, which the reviewer preferred. The
step count is that tie-break: fewer steps to the same answers.
