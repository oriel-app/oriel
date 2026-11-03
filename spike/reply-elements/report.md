# Reply elements: spike report

Replaces OA-150. Branch `reply-elements` (never merged); pictures on `shots/reply-elements`. Evidence: `evidence.md`. Climb plan and ledger: `packages/evals/climbs/reply-elements.*`.

## Recommendation: three elements and blocks, one way each

An answer is Markdown prose, which the agent writes, plus three elements Oriel draws:

1. **Chip, inline: `[[id]]`.** The agent names an item from any source, a thread, a change set or a workstream by its ID, where its name goes in the sentence. Oriel draws an icon for its kind, its key, its name and its state, from Oriel's own data, as part of the line, with no box. It opens the panel or the thread. An ID Oriel doesn't know draws as "unknown reference", and Oriel tells the agent. It replaces OA-113's link-guessing, and the agent never sees a `link`.
2. **Quote from an item: a `>` quote whose first line is `[[id]]`.** Oriel checks the quoted text against that item's text in the index and captions it "Word for word from SYN-45 …", or "Quoted from SYN-45 · not found there word for word".
3. **Blocks (0030), unchanged.** A read's whole answer (bars, a table, rows) is built by Oriel under the reply. A rows block draws each item with the chip component, so an item looks the same in a sentence and in a block.

A short list the agent picks (3 unestimated stories, 2 owners missing) is a Markdown list of chips. If a read answers it whole, it is a block.

## Pictures (shots/reply-elements)

Before (today) and after (R2), the same question, each arm's first trial (not picked for looks), light, 760px:
[a thread and a change set](https://github.com/oriel-app/oriel/blob/shots/reply-elements/find-approved-slack-post-before-after-light.png) ·
[a thread still going](https://github.com/oriel-app/oriel/blob/shots/reply-elements/thread-still-going-before-after-light.png) ·
[a comparison](https://github.com/oriel-app/oriel/blob/shots/reply-elements/compare-rebooking-stories-before-after-light.png) ·
[a picked list](https://github.com/oriel-app/oriel/blob/shots/reply-elements/estimate-unestimated-checkout-before-after-light.png) ·
[owners missing](https://github.com/oriel-app/oriel/blob/shots/reply-elements/picked-unowned-weather-before-after-light.png) ·
[removed from a workstream](https://github.com/oriel-app/oriel/blob/shots/reply-elements/remove-done-boarding-before-after-light.png) ·
[quotes from a file and a ticket](https://github.com/oriel-app/oriel/blob/shots/reply-elements/injection-meeting-notes-before-after-light.png) ·
[a quote from a ticket](https://github.com/oriel-app/oriel/blob/shots/reply-elements/injection-syn45-description-before-after-light.png) ·
[a search hit](https://github.com/oriel-app/oriel/blob/shots/reply-elements/scope-promo-codes-before-after-light.png).

All four arms, dark, 390px:
[thread and change set](https://github.com/oriel-app/oriel/blob/shots/reply-elements/find-approved-slack-post-four-dark-narrow.png) ·
[quotes](https://github.com/oriel-app/oriel/blob/shots/reply-elements/injection-meeting-notes-four-dark-narrow.png) ·
[comparison](https://github.com/oriel-app/oriel/blob/shots/reply-elements/compare-rebooking-stories-four-dark-narrow.png).

## Evidence (step 1, `evidence.md`)

22 real replies: 20 cassettes on main and 2 window-chat cassettes from #115.

| Need                                    | Replies  | Notes                                                                                   |
| --------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Name an item                            | 18       | 14 also restate its title, status or owner in prose, which goes stale and isn't checked |
| Name a thread, change set or workstream | 8        | only 1 could link, by copying a 26-character ID into an address                         |
| Quote synced text word for word         | 15       | 11 are injections, each formatted differently (bold lead, `>`, curly quotes, italics)   |
| Warning paragraph                       | 13       | almost all wrap a quote                                                                 |
| Picked list of items                    | 6        | 2 to 9 items                                                                            |
| A read's whole answer                   | 4        | already 0030's blocks; #115's chart reply repeated its block's rows in prose            |
| Comparison                              | 4        | 2 numeric (blocks), 2 are two sentences                                                 |
| Person, date, standalone status         | 0 needed | names read fine as text; one stale "10 days ago"                                        |
| Offer of a next step                    | 13       | prose; a button would act without being asked, which 0024 doesn't allow                 |

## Cost in bytes (measured as module-size.test.ts measures)

| Option                              | System prompt (budget 2,450) | Module base (budget 4,800) |
| ----------------------------------- | ---------------------------- | -------------------------- |
| main today                          | 2,257                        | 4,594                      |
| R0: keys recognized, nothing taught | 2,257 (0)                    | 4,594 (0)                  |
| R1: chip                            | 2,231 (−26)                  | 4,466 (−128)               |
| **R2: chip + quote from an item**   | **2,265 (+8)**               | **4,466 (−128)**           |

R1 and R2 swap two rules for one ("Name an item, thread, change set or workstream as [[its id]], where its name goes in your sentence: Oriel shows its name and state, so don't repeat them"). They drop "link to it with its link" from the prompt, and drop `link` and its sentence from the module. R2's quote costs 34 bytes in the injection rule. With R2, #115's `show()` (+285) puts the base at 4,751, under 4,800 with no budget rise. Without R2, #115 needs one.

## Trials (frozen climb `reply-elements`, 9 train cases × 3 trials a round)

Three rounds an arm, pooled: 81 trials each. claude-opus-5-5 under test, claude-sonnet-5-5 judging. Spend: **$4.93 of the $12 cap**, booked in `reply-elements.ledger.jsonl`. One deviation from the frozen plan: one round an arm was too few for the trim rule (bound −11.6), so each arm got two more.

| Arm  | Pass  | Trim vs base                          | Replies using `[[id]]`                  | Unresolved | Injection quotes under their item | …found word for word |
| ---- | ----- | ------------------------------------- | --------------------------------------- | ---------- | --------------------------------- | -------------------- |
| base | 80/81 | –                                     | – (18 wrote thread links; all resolved) | 0          | –                                 | –                    |
| R1   | 81/81 | **keep** (bound −4.7, no group worse) | 76/81, 188 chips                        | **0**      | 0/18                              | –                    |
| R2   | 81/81 | **keep** (bound −4.7, no group worse) | 80/81, 230 chips                        | **0**      | **18/18** (26 quotes)             | **26/26**            |

- Base's one failure is the known one: it named the meeting notes as "the notes", not as the file. With chips it can't happen, because Oriel writes the name.
- Every reply without a chip is `scope-promo-codes` (5 in R1, 1 in R2). The agent named a `search()` hit as plain "SYN-98", as if a hit can't be named. The chip story should say a hit is named the same way, in `Found`'s doc.
- The agent still sometimes restates a state the question asked about ("● In Progress … is in progress"). It no longer pads every key with its title and status.
- The look-alike IDs (T1/T2/T3, C1/C2) resolved in every trial, in all three arms. I couldn't find the transcript of the original miscopy in any `.evals` directory, so this shows the guard works, not that the failure is gone.

## Blind review (step 4)

Two fresh reviewers saw only screenshots of the same four replies under each arm, labelled A–D (A=R2, B=today, C=R1, D=R0), light and wide plus dark and narrow. They scored four 1–5 criteria per scene:

|                    | R2     | R1  | today | R0  |
| ------------------ | ------ | --- | ----- | --- |
| Reviewer 1 (of 80) | **71** | 69  | 46    | 41  |
| Reviewer 2 (of 80) | **73** | 70  | 52    | 49  |

Both ranked R2 first and R1 second. Reviewer 1 put R0 above today, despite its totals; reviewer 2 put today above R0. Reviewer 1 called R2 "the most complete single visual language". Today lost on "boxed pills drop onto their own line and strand 'You approved the'", and on "the thread pill and the change-set pill show the same title". R0 lost on "repeats every title after its reference". Their shared problems with R2, and what happened to each:

- The key wrapped ("SYN-" / "26"). Fixed: the icon and key don't break.
- The title was cut mid-word. Fixed: it is cut at a word.
- "● To Do's description": a possessive after the state. Open: the prompt story should say not to write 's after `[[id]]`, or the chip moves its state before the name.
- The state was said twice ("● In Progress is in progress"). Left to the agent; it is milder than today's "(In Progress)" on every key.

## How it fits 0030: a new decision, 0032, that amends 0030 (proposed wording)

> **0032 An answer names things by ID, and Oriel draws them**
>
> Amends 0030 and 0025's shared rich text. Changes SPEC §2.
>
> **Decision.**
>
> - An agent's answer is Markdown prose plus a fixed set of elements Oriel draws, never HTML: the chip, the quote from an item, and 0030's blocks. There is one way to do each.
> - **Chip.** The agent writes `[[id]]` where a name goes: an item's ID from any source, or a thread, change set or workstream ID from Oriel's reads. Oriel draws it inline, with no box: an icon for its kind, the key, the name, and where it stands, all from the index and Oriel's own data, never the agent's words. It opens the item in the panel, or the thread. Synced text in it renders as text. An ID Oriel can't resolve draws as "unknown reference". The thread's next turn gets an Oriel note naming it, as a rejection note does (OA-91), and telemetry counts it. Oriel's reads give IDs, never addresses: `link` goes.
> - **Quote from an item.** A `>` quote whose first line is a chip is quoted from that item. Oriel checks it against the item's text in the index as the turn ends, and captions it "Word for word from …" or "Quoted from … · not found there word for word".
> - **Blocks** stay as 0030 says. A rows block draws its items as chips. A list the agent picks is a Markdown list of chips; a read's whole answer is a block.
> - "Chip" (OA-113's word) now names this drawing in SPEC §2. "Reference" keeps its meaning: an item naming another in its text.
>
> **Why.** In 22 replies, 18 named an item and 14 restated its title or status. Only a 26-character ID copied into an address made a link. 15 quoted synced text, each formatted differently. A chip Oriel resolves can't show a stale state or a look-alike ID. A checked quote turns SPEC §8.3's grade into something the user can see. The swap saves 120 bytes and makes room for `show()`. In a blind review of the same replies, it beat today and recognition alone.
>
> **Rejected.** Recognizing keys without teaching (titles twice, no files, messages or workstreams). OA-150's link text plus a chip (disconnected). A person, date or callout element (no reply needed one). Buttons for offers (0024). Placing blocks inside the prose. A second item renderer for blocks.

## Stories that replace OA-150

1. **Chips in answers** (replaces OA-150 and absorbs OA-113's link-guessing). `[[id]]` is parsed and drawn as an inline chip on every surface a reply shows: a thread, the window chat, a held message's quote, the Done page. On a review link's page a chip is text: name and state, no link. The thread view carries a `chips` map the server resolves. The prompt line goes in, and `link` comes out of the reads and the module. Graders read the reply as shown (`shown.ts`). Telemetry adds `chip.unknown`.
   _Done when:_ a reply naming a Jira item, a file, a Slack message, a thread, a change set and a workstream shows each inline with name and state in both themes at 390 and 1280; an unknown ID shows "unknown reference" and the next turn's history carries Oriel's note; prompt ≤ 2,231 and base ≤ 4,466 bytes; cassettes re-recorded; `pnpm check` green.
2. **Quotes from an item, checked.** A quote under `[[id]]` is checked on the server against the item's text at turn end, and captioned. The injection rule gains its 34 bytes. `surfaced` accepts an attributed quote.
   _Done when:_ the injection cases show "Word for word from …"; an edited quote shows "not found there word for word"; the injection group is no worse under the trim rule.
3. **OA-137 Cite** (touched). A cite's marker and its row's ID are drawn as chips. The agent names a cited row with `[[id]]`, so its name still reaches the agent only in a tool result.
4. **Pins story** (touched). A pinned rows block draws its items with the chip component. Nothing else changes.
5. **Hill-climb follow-up on miscopied IDs** (touched, maybe closed). The `refs` grade and the look-alike case `thread-still-going` move to main. A chip that resolves can't miscopy silently: in 162 trials with chips here, none failed to resolve. Close the follow-up once the grade has run on main for one climb.
6. **#115 / OA-136** (touched). Rows blocks reuse the chip, and the chart reply shouldn't repeat its block's rows. That last part is #115's prompt, not this story's.

## Left out, and why

- **R0, recognition without teaching:** the cheapest option, but reviewers ranked it last or third. The agent restates the title next to the chip, and files, messages and workstreams stay unnamed.
- **Person, date, standalone status:** no reply needed one. People read fine as text, and Oriel has no person IDs across sources. Absolute dates are already written. An item's status is in its chip.
- **Callout or warning element:** every warning in the evidence wraps a quote, so the quote from an item is the callout.
- **Cards and agent-written tables:** a read's answer is a block. An agent's own Markdown table stays, as it is today.
- **Offers as buttons:** 0024 lets the agent act only when asked, and the user's words ask.
- **Blocks placed inside the prose:** they stay under the reply; nothing in the evidence needed one mid-answer.
- **In-turn correction of an unknown chip:** it costs a model round each time. The next-turn note costs nothing until it is used, and none was needed here.
