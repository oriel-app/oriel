# Proposal: amend 0027's window chat (answers with tables and charts, pinning, an ask bar)

A proposal from the window-explore spike, rounds 10 to 14 (TASKS2.md, LOG.md). Not a decision: the
maintainer approves, and an accepted version goes in docs/decisions/ as an amendment to 0027.

## What would change

1. **Ask from a bar at the top of the overview, not a standing rail.** "Ask about your window" is an
   input under the counts strip. The window chat opens beside the overview while it has a
   conversation, over the page's right side, and closes back to the full-width overview. On a
   narrow window it opens as a sheet. Everything else 0027 says about the window chat stands: it is
   short-lived, pinned to its own workstream, made by its first question or cite, and continues
   elsewhere through Continue in…. The item panel still covers it while an item is open.

2. **Questions to start from.** Under the bar, a few questions computed from the overview, never
   generated: the same superlatives the headlines use ("Why is Status page pilot stalled?", "Chart
   what moved since I looked, by workstream"). With a row cited, the bar offers questions about that
   row instead: "What's happening in it?" for a workstream, "Make a workstream of it" for a
   candidate.

3. **Answers can include blocks: a table, a bar chart, rows of items.** The agent's prose stays its
   own. A block is Oriel's: the agent asks for one by naming a read it ran in this turn and the
   block's form, and Oriel builds the block from that read's tool result. A model never writes a
   block's numbers, so it can't invent a figure. A block is typed data, never HTML, as the panel's
   rich text is (0025). Synced titles in it render as text. Each block carries a plain caption of
   where it came from ("Computed by Oriel from the change log: members changed since Tue, Oct 27").
   - Bars: one series, ranked, horizontal, each value labelled, at most 10 and then "and N more".
     Never two axes.
   - Table: at most 5 columns. Numbers right-aligned.
   - Rows: items as Browse shows them, and each can be opened in the panel or cited.

4. **An answer with a block can be pinned to the overview.** A pin is a saved read, not saved text:
   the read, its arguments (a cited workstream by ID) and the block's form. The overview reruns it on
   each look, with no model call, so 0027's "nothing on the overview needs a model" holds.
   - Pins show in their own Pinned strip under the headlines, keeping their form (bars or rows, top
     3), labelled "rerun each time you look", each with Unpin.
   - At most 4 pins. A fifth asks which to replace.
   - A pin whose cited workstream was deleted shows that and offers Unpin.
   - Pinning and unpinning are the user's actions. The agent may suggest a pin and never makes one.

## Glossary additions (SPEC §2)

- **block**: a table, bar chart or rows in a chat answer, built by Oriel from a read's result.
- **pin**: a block saved to the overview, its read rerun on each look.

## Why

From the spike's large world (4,000 items, 10 sources, 40 workstreams), at 1280px and 600px:

- **A rail costs the overview its width.** With 0027's rail (round 10), the overview drops to one
  column on a laptop. People fall below the workstreams, and one reading answer was lost. An ask
  bar with answers that open only while you ask (round 11) got the overview's full width back. The
  reviewer's other note: an empty rail is a quarter of the screen spent on nothing.
- **Blocks read well.** Judges read a figure off a chart or table at 95–97% confidence, every
  time, at both widths.
- **A pin must keep its form.** Rounds 10 and 11 pinned an answer as a line of text among the
  headlines. Both reviewers flagged it: cropped ("Map view redesign 23, Delivery slots pilot 1…")
  and indistinguishable from the overview's own facts. A strip that keeps the chart (rounds 12–14)
  fixed it.
- **Questions to start from cut the steps.** They took asking from 11 steps to 8 per width, and
  questions offered on a cited row took it to 7.
- **Numbers stay trustworthy.** SPEC §1's central risk is a coarse view the user can't trust. A
  model writing the figures in a chart would be exactly that. Blocks built from tool results, with
  their source in the caption, aren't.

## Considered

- **Keep 0027's rail.** It scored 19 of 20 against the ask bar's 19.5. The reviewer slightly
  preferred it for its always-visible input. It lost on width.
- **Answers in place on the overview** (round 12). Same score as the ask bar; it pushes Needs you
  below the fold while an answer is open.
- **Pinning the agent's text.** It goes stale, and rerunning it would need a model on every open.
- **Free-form rearranging of the overview by asking** ("hide people", "group by source"). Not
  tried. Pins are the bounded version: the user adds to the overview, and nothing reorders it.

## Consequences

- OA-136 (the window chat) takes the ask bar, blocks and questions to start from. OA-137 (Cite)
  takes questions about a cited row. Pins are a new story after OA-136.
- `HeldSender` and Continue in… are unchanged. A block in a quoted exchange reaches the next thread
  as part of the tool result, never as the user's words.
- New telemetry: a block shown (by form), an answer pinned and unpinned, and a question to start
  from used.
- Evals: a block whose numbers don't match its read's result fails, and so does a pin that needs a
  model to rerun.
