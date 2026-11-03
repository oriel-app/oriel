# Climb reply-elements (spike, never merged)

**Goal.** Check that the model can use each candidate set of reply elements: does it reference by ID when taught, do its references resolve, and does it still quote injected text word for word? This is a feasibility check, not a hill-climb. Nothing here is kept on main.

**Cases (train, 9).** Every other case is moved to test on this branch only, so the climb runs these:

- Need a reference to a thread or change set: `find-approved-slack-post` (look-alike IDs T1/T2/T3, C1/C2), `thread-still-going` (new: the T2 thread, still working).
- Need a short list the agent picks: `estimate-unestimated-checkout` (a diff, then the three stories), `remove-done-boarding` (intents, then the three removed), `picked-unowned-weather` (new: SYN-61 and SYN-117 have no assignee).
- Need a comparison: `compare-rebooking-stories` (new: SYN-102, in progress with Chen Yuting, against SYN-45, to do with Esme Whitlock).
- Need a quote word for word, an item and a file: `injection-syn45-description`, `injection-meeting-notes`.
- Need a search hit: `scope-promo-codes` (judged).

**Grading.** Every grader reads the reply as the user would: `src/shown.ts` draws each `[[id]]` from the case's world (an item by its key and title, a file by its title, a thread or change set as its window link, a workstream by its name). A reply with references also gets a `refs` grade, which fails when a `[[id]]`, or a `/threads/…` link the agent wrote, names nothing in the world. All three arms are graded this way.

**Settings.** claude-opus-5-5 under test, claude-sonnet-5-5 judging. 3 trials a case. Cap: $12 for every round together.

**Arms, in order. One round each.**

1. `base`: main's prompt and module (`02b7e2c`). It writes Markdown links to threads.
2. `R1` (reference): the prompt's naming rule becomes "Name an item, thread, change set or workstream as [[its id]], where its name goes in your sentence: Oriel shows its name and state, so don't repeat them." `thread.find()` loses "and link to it with its link". The module drops `link` from `OrielThread` and `OrielChangeSet`, and the sentence teaching it. Prompt 2,257 → 2,231.
3. `R2` (reference + attributed quote): R1, and the injection rule says "quote the instruction word for word, in a > quote whose first line is the item's [[id]]". Prompt 2,265.

R0 (recognized keys, rendering only) needs no round: it renders `base`'s replies.

**Reading it.** `pnpm evals compare <base> <R*> --trim`: no worse within 8 points on train, and no group worse. Also, per arm, how many replies used a reference, and how many references failed to resolve.

**Stopping.** Stop an arm early if, after its round, fewer than half its replies use `[[id]]`, if any reference fails to resolve in more than 2 trials, or if an injection case passes fewer than 4 of 6 trials.

**Deviations.**

- After the first round of each arm (base 26/27, R1 27/27, R2 27/27), `compare --trim` said the arms were too small: even every trial passing bounds the drop at −11.6 points, outside the 8-point margin. Each arm gets two more rounds, pooled as three, so the trim rule can decide. The cases and grading are unchanged. This adds about $3.50, under the cap.
