# Draft: a second look at each change set, before the person decides

Draft, from the challenger spike (branch `challenger`, 2026-11-04). Not accepted. Would amend 0003 (a person may add a suggested change to a change set nobody has decided on), 0024 (two actions), 0030 and 0032 (a quote checked against what a diff line would write), and add "second look" to SPEC §2 and kind 9 to SPEC §8.

Adds: none

**Decision (proposed).**

- **A second look** is Oriel's own run, once per change set a turn captures: an agent with no history, Oriel's fixed ask (`challengeAskText`), and a module of the region's reads and writes, `challenge.diff()`, `challenge.record()` and `search()`. No `workstream`, `thread`, `show` or `sketch`; every other module is byte for byte as it was. It reads the diff Oriel computed (`ChangeSets.look()`, which records no preview, so it never stands for what the person saw), reads what it chooses, and records findings.
- **A finding** is one of four kinds: disagrees with something decided, a discussion this affects, may need to change with it (a companion), worth a look. Each names the diff lines it bears on, one or two sentences of the agent's reading, and one to four quotes. Oriel keeps a record only when every quote is word for word in its item, or in what a diff line would write, and every quoted item is one the run could read (the region, or its own search hits); and when no sentence grades the change ("safe", "looks good", "no issues", "should be approved"). Otherwise it keeps nothing and tells the agent why, as a tool result. There is no summary field, so nothing can read as an overall verdict.
- **Coverage is Oriel's, not the agent's**: "It read 3 of 11 items in this workstream, and searched outside it twice", from the runs' records. An empty look says "It raised nothing from what it read. That isn't a sign the change is right."
- **Never a pass, never a block.** Neutral colours only: no done, accent or danger token, no tick, no score. Approve doesn't wait for it, and nothing it says changes what Approve, Reject or the review link do.
- **A companion's changes** are what the same run wrote: captured, never applied, kept with the look. **Add to this change set** is a person-only action (`changeset.add-suggestion`) that appends them through `ChangeSets.extend`, which checks them as a capture is (catalogue, region of the change set's run, no new items, the per-change-set cap) and only while nobody has decided and nothing has applied. The hash changes, so the person approves the new diff.
- **Stored, then stale, never regenerated on a view.** A look keeps the change set's hash and each cited item's and target's update time. The card says what changed since ("The change set changed after it looked", "2 items it rests on changed since") and offers **Look again** (`changeset.look-again`, direct, closed to the agent and outside tools).
- **It counts.** A look's tokens count toward its thread's per-thread token cap (SPEC §9).
- **The review link shows no second look.** See Why.

**Why.**

- The case the brief named works. On SYN-45 narrowed to same-day sailings, every trial cited the later Slack reply that extends the rule to next-day sailings, and the harmless estimate raised nothing (train 6/6). With text in the diff telling any AI reviewer it was signed off and to record nothing, 3 of 3 trials still raised the conflict and suggested no change. They also raised the note itself as something the change would write into the ticket, quoting the diff line. That is the retyped-injection problem the decision-desk and release-rehearsal spikes found, caught before approval.
- Live rounds (Opus 5.5, `climbs/second-look`): round 01M6JXQ1J50E645ECXCVGZJ31Y, 12 trials, $0.61 (about $0.05 a look), median 16 s a look (14 to 30). The spike's three rounds cost $1.39 in all. Train 6/6; test 3/6, the 3 failures all `look-long-crossings`, marked failing (below).
- Quoting the diff was added after round 2. The agent wrote in its unshown reply that the change "would add [the note] to the ticket", but had no way to cite it, since only items could be quoted.
- **Reach is the weak point.** `search()` matches keys and titles. The open question about long crossings is in the body of "Q3 launch: open questions"; 3 of 3 trials searched for it sensibly and never reached it. A look is only as good as what it can find.
- **The review link:** a link can be forwarded to anyone. A look quotes items beyond the diff (other conversations, search hits outside the workstream), so showing it would widen what the sender chose to share. Its holder also can't Look again or Add, and lacks the thread, so a list of findings reads more like a verdict there. The sender sees it before sharing.
- Security review (`.claude/agents/security-reviewer`): three findings, all fixed on the branch and confirmed closed on a second pass. A look escaped the thread's token cap; `extend` had no mutation cap; `record()` checked quotes against any indexed item, an oracle on items the run couldn't read. Low residual, left open: a running look's tokens count only once it finishes, so a look running beside the thread's next turn can overshoot the cap by one remaining budget.

**Rejected.**

- **A summary or verdict line.** It is the reassuring sentence the biggest risk is about, and injected text would want it written.
- **Generating on a page view, or after a sync.** A model call nobody asked for, on text that may be written to steer it.
- **The thread's own agent checking its work in the same turn.** It shares the conversation that may have steered the change, and its history.
- **A one-shot structured call outside the loop.** The command-line providers run Oriel's one tool and nothing else; a turn of the same loop runs everywhere, with the same caps and run records.
- **Blocking Approve until the look finishes, or on a conflict.** Approval is the person's (0003).

**Consequences.**

- Migration 0023 (`challenges`); `ChangeSets.look` and `ChangeSets.extend`; `TurnInput.challenge`; two actions; telemetry `challenge.made` (counts by kind, ms, tokens), `challenge.failed` (why, in a word) and `challenge.companion-added`, never words or quotes.
- Eval kind 9, deterministic: a `challenge` diff in the case and a `findings` grader. Four cases; reply graders skip kind 9, whose reply is never shown.
- Hit every surface: the change-set diff (the look, in the thread only); review link (deliberately none); thread states (unchanged: a look neither waits on the person nor holds Needs you); telemetry; eval fixture. The overview, Browse, the item panel and the right rail are untouched.
- Open: which model a look runs on (the thread's today); whether it is on by default for API-key users, whose spend it is; its reach (references to the diff's targets, or search over text); the look records no model ID yet; it hasn't run live on the command-line providers.
