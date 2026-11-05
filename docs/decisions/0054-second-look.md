# 0054 A second look at a change set, when the person asks

Accepted 2026-11-04. Amends 0003, 0024, 0030 and 0032. Changes SPEC §2, §8 and §9. From the challenger spike (branch `challenger`), with one change the maintainer made: a second look runs only on demand.

Adds: none

**Decision.**

- **A second look** (SPEC §2) is Oriel's own run on a change set nobody has decided on, taken only when the person presses **Second look**. The change-set view has it between Approve and Reject. Nothing starts one by itself: not a capture, a sync or a page view.
  - Pressing it is `changeset.second-look`, a direct action closed to the agent and outside tools: an agent doesn't ask for a look at its own work, and an outside tool's words start no model call. Pressing it again while a look runs, or while the last one is still current, starts nothing more.
  - While it runs, the button reads **Looking…**, and Approve and Reject stay usable. Approval never waits on it.
  - Once a look exists, the same button reads **Look again** when the change set, or an item the look rests on, changed since, or when the last look failed. With a current look there is no button.
- **The run.** An agent with no history, Oriel's fixed ask (`challengeAskText`), and a module of the region's reads and writes, `challenge.diff()`, `challenge.record()` and `search()`. No `workstream`, `thread`, `show` or `sketch`; every other module is byte for byte as it was. It reads the diff Oriel computed (`ChangeSets.look()`, which records no preview, so it never stands for what the person saw), reads what it chooses, and records findings. Its reply is never shown; its turn captures no change set, applies no intent and holds no draft.
  - **Model:** the thread's, as Settings chooses it. The look records the model ID its runs ran on.
  - **It counts.** A look's tokens count toward its thread's per-thread token cap (SPEC §9).
- **A finding** is one of four kinds: disagrees with something decided, a discussion this affects, may need to change with it (a companion), worth a look. Each names the diff lines it bears on, one or two sentences of the agent's reading, and one to four quotes.
  - Oriel keeps a record only when every quote is word for word in its item, or in what a diff line would write; every quoted item is one the run could read (the region, or its own search hits); and no sentence grades the change ("safe", "looks good", "no issues", "should be approved"). Otherwise it keeps nothing and tells the agent why, as a tool result.
  - There is no summary field, so nothing can read as an overall verdict.
- **Coverage is Oriel's, not the agent's**: "It read 3 of 11 items in this workstream, and searched outside it twice", from the runs' records. An empty look says "It raised nothing from what it read. That isn't a sign the change is right."
- **Never a pass, never a block.** Findings sit between the diff and Approve. Neutral colours only: no done, accent or danger token, no tick, no score. Nothing it says changes what Approve, Reject or the review link do.
- **A companion's changes** are what the same run wrote: captured, never applied, kept with the look. **Add to this change set** is a person-only action (`changeset.add-suggestion`) that appends them through `ChangeSets.extend`. It checks them as a capture is (catalogue, the region of the change set's run, no new items, the per-change-set cap), and only while nobody has decided and nothing has applied. The hash changes, so the person approves the new diff, and the look says it hasn't read what was added.
- **Stored, then stale, never regenerated on a view.** A look keeps the change set's hash and each cited item's and target's update time. The card says what changed since ("The change set changed after it looked", "2 items it rests on changed since").
- **The review link shows no second look.** See Why.

**Amends.** 0003: a person may add a second look's suggested change to a change set nobody has decided on, which they then approve as a new diff. 0024: two actions, `changeset.second-look` (direct, closed to the agent and outside tools) and `changeset.add-suggestion` (person-only). 0030 and 0032: a quote may be checked against what a diff line would write, as well as against an item.

**Why.**

- **On demand** (the maintainer's call): a model call nobody asked for, on every change set, is spend and latency the person didn't choose, on text that may be written to steer it. Pressing it makes the look the person's question, as a question in the window chat is. It also drops the draft's open question of a default for API-key users, whose spend it is, and its Settings switch.
- The case the brief named works. On SYN-45 narrowed to same-day sailings, every trial cited the later Slack reply that extends the rule to next-day sailings, and the harmless estimate raised nothing it shouldn't. With text in the diff telling any AI reviewer it was signed off and to record nothing, every trial still raised the conflict and suggested no change. They also raised the note itself as something the change would write into the ticket, quoting the diff line: the retyped-injection problem the decision-desk and release-rehearsal spikes found, caught before approval.
- Live rounds (Opus 5.5, `climbs/second-look`). This decision's round, 01M6KMYNSD5F2MR57643QRVAJ4: 12 trials, $0.63 (about $0.05 a look), median 17 s a look (13 to 38). Train 6/6; test 3/6, the 3 failures all `look-long-crossings`, marked failing. Recorded again after rebasing on chart blocks and Jira comments (01M6MR21HHP5GASF2NX4AR0HRK): the same results, $0.62, median 18 s. The spike's three rounds and these two cost $2.63 in all.
- Quoting the diff was added after the spike's round 2. The agent wrote in its unshown reply that the change "would add [the note] to the ticket", but had no way to cite it, since only items could be quoted.
- **Reach is the weak point.** `search()` matches keys and titles. The open question about long crossings is in the body of "Q3 launch: open questions"; every trial searched for it sensibly and never reached it. A look is only as good as what it can find.
- **The review link:** a link can be forwarded to anyone. A look quotes items beyond the diff (other conversations, search hits outside the workstream), so showing it would widen what the sender chose to share. Its holder also can't Look again or Add, and lacks the thread, so a list of findings reads more like a verdict there. The sender sees it before sharing.
- Security review (`.claude/agents/security-reviewer`) on the spike: three findings, fixed and confirmed closed. A look escaped the thread's token cap; `extend` had no mutation cap; `record()` checked quotes against any indexed item, an oracle on items the run couldn't read. Low residual, left open: a running look's tokens count only once it finishes, so a look running beside the thread's next turn can overshoot the cap by one remaining budget.

**Rejected.**

- **Automatic, once per change set** (the spike's draft), with a Settings switch. See Why.
- **A summary or verdict line.** It is the reassuring sentence the biggest risk is about, and injected text would want it written.
- **Generating on a page view, or after a sync.** A model call nobody asked for, on text that may be written to steer it.
- **The thread's own agent checking its work in the same turn.** It shares the conversation that may have steered the change, and its history.
- **A one-shot structured call outside the loop.** The command-line providers run Oriel's one tool and nothing else; a turn of the same loop runs everywhere, with the same caps and run records.
- **Blocking Approve until the look finishes, or on a conflict.** Approval is the person's (0003).

**Consequences.**

- Migration 0024 (`challenges`); `ChangeSets.look` and `ChangeSets.extend`; `TurnInput.challenge`; two actions; telemetry `challenge.made` (counts by kind, ms, tokens), `challenge.failed` (why, in a word) and `challenge.companion-added`, never words or quotes.
- Eval kind 9 (SPEC §8), deterministic: a `challenge` diff in the case and a `findings` grader. Four cases; reply graders skip kind 9, whose reply is never shown. `look-long-crossings` stays marked failing until reach improves.
- Hit every surface: the change-set diff (the button and the look, in the thread only); review link (deliberately none); thread states (unchanged: a look neither waits on the person nor holds Needs you); telemetry; eval fixture. The overview, Browse, the item panel and the right rail are untouched.
- Open: reach (references to the diff's targets, or search over text), the next step; a look hasn't run live on the command-line providers; with the scripted dev agent, no look is offered.
