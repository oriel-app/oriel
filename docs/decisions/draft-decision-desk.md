# Draft: the decision desk: a choice the agent finds, with evidence Oriel checks

Draft, from the decision-desk spike (branch `decision-desk`, 2026-11-03). Not accepted. Would amend 0024 (two actions), 0030 (one more element under an answer) and 0032 (a quote checked as the agent hands it over), and add "choice" to SPEC §2.

Adds: none

**Decision (proposed).**

- **A choice** is a question a workstream's items discuss and haven't settled: its options, the evidence for each, and what nobody has answered. "Decision" already names a change set's approve or reject, and the ADRs, so the word is "choice"; the surface may still be called the decision desk.
- **Found on demand, in a run Oriel starts.** "What's undecided?" in a thread's header says Oriel's fixed question, "What's still undecided here?", as the user's. Only that turn's module has `choices.add(c)`, as only the window chat's has `window` (0027). Every other module, and the system prompt, are byte for byte as they were. No model call happens on a page view, and none after a sync.
- **Two voices, kept apart.**
  - The agent's reading: the question, each option's label and standing (proposed, agreed, superseded), what each quote does for its option (proposes, agrees, objects, amends, asks), and what's unanswered. The card captions each "agent's reading".
  - Oriel's: each quote is checked word for word against its item, read live, as the turn runs, and a choice with any quote not found, or from an item outside the region, is refused with why, as a block is (0030). Oriel dates each quote from the source's own panel view (0025): the message it is in, its author and time; or the item's body, which has no one date, "as of" the item's last change. Who said it and when are never the agent's.
- **Stale, not regenerated.** Each quote keeps its item's update time as the index had it. When any cited item changes since, the card says so and offers Check again, a new run. Nothing reruns by itself.
- **The person settles it.** Choose, Defer, Ask for clarification and Reopen are Oriel's controls, through one person-only action, `choice.settle`; `choice.find` is closed to the agent and outside tools. Oriel writes its own line in the thread for each, naming the option by its letter. Choose and Ask then start a turn with fixed words, so no label or quote is ever the user's message; the agent reads the choice from Oriel's line, as a tool result. What the turn writes is a change set, approved as any is.
- **"Why is it this way?"** under the card orders every dated quote and Oriel's own records (each item's last change, Oriel's check, what the user did) by their real times. The agent's role for each quote shows beside it, never in place of it.
- Stored with its turn as an agent event, as a block is: no migration.

**Why.**

- The biggest risk is reading the latest or loudest reply as agreement. In the fixtures, Farid's later reply says "ops agreed" to next-day sailings and "I've updated SYN-45"; nobody from ops says so, and SYN-45 last changed in June. Oriel can't judge who agreed, but it can put each quote's real date and author beside the agent's reading, so the person sees the amendment came weeks after the decision, from someone else, and that SYN-45 never changed.
- Live round 01M6JG1V4JVKM1ZBRTJWFGNT1Z, five cases, 3 trials each, $0.67: 12 of 15. The 3 failures were one wrong expectation (it forbade quoting SYN-45's planted injection, which the system prompt asks for), since removed. No trial stood an option agreed on the hearsay reply or on support's "happy" as sign-off, none invented a choice in three settled bugs, none wrote anything in a choices run, and every Choose trial proposed the SYN-45 description and the reply.
- Without the standings' one-line definition in the module, 1 of 9 trials stood "next day too" agreed on the hearsay reply (ablation round 01M6JGPB5HNH0F4ZYF72NDP5HM, $0.52). Too few to call; the line costs nothing outside a choices run.
- A choices run's module is 668 bytes bigger (7,892 to 8,560 on the weather epic). In every module, that would take the base past its 4,950 budget.
- Synced text steering the structure is the threat (security review, two lows, both fixed): a quote must be the item's own words, an item must be in the region, dates come from the source, the agent can't settle, and Oriel's own lines never repeat the agent's label.

**Rejected.**

- **A block of the agent's choice.** A block is built from a read; a choice is a judgement, and must say so.
- **A one-shot structured call outside a thread.** The command-line providers run Oriel's one tool and nothing else, and Choose needs a thread for its change set anyway.
- **`choices.add` in every module.** Over budget, and every cassette recorded again, for a question asked on purpose.
- **Regenerating after a sync.** A model call nobody asked for, on text that may have been written to steer it. Stale plus Check again costs nothing until used.
- **The agent settling a choice.** Its reading may be steered; choosing is the person's.

**Consequences.**

- SPEC §2 gains "choice"; 0024's registry gains `choice.find` and `choice.settle`; SPEC §7 gains `choice.shown`, `choice.refused` and `choice.settled`, counts only.
- Carrying a choice into Jira rewrites a whole description: in 2 of 3 Choose trials the new SYN-45 description kept the planted injection paragraph, unexecuted. An append-only write, such as a comment, would carry a decision without retyping others' words.
- "Why is it this way?" beside an item, in the panel, needs choices findable by item: a small table, with a migration.
