# Draft: release rehearsal

Draft, not accepted (the release-rehearsal spike, 2026-11-03). No number until the maintainer takes it.

Adds: none

**Decision (proposed).**

- **Rehearse the release** on a workstream's page opens a thread on the workstream, titled "Release rehearsal" by Oriel, whose first message is Oriel's fixed ask (`rehearsalAsk`): walk the release as 3 to 6 situations a customer meets, and for each, the items that bear on it and what nobody has answered. It is a person's click; the agent can't start one (0024's `unsaid`).
- **What an item says is one of four things, kept apart:** intent (it says what should happen), claim (it says it's built or done; a Done state is a claim), observed (someone saw the product do it, in a test, a check or a real case such as a retro or a complaint, and what it showed), and contradiction (it disagrees with another item or its own state, named as `against`).
- **The agent hands it to Oriel with `rehearsal.record(situations)`,** a binding in a rehearsal thread's module only, as `window` is in the window chat's. Oriel keeps it only when every ID is in the region or this run's `search()` hits, every quote is in its item word for word (0032's check), and anything observed, or a contradiction, quotes its words. Otherwise it refuses with what to change, as a tool result. `rehearsal.read()` gives it back.
- **The page shows the newest kept rehearsal** under the workstream's ask box: a card per situation, its items as chips with each source's state now, then the four kinds, then Nobody has answered. Oriel computes everything around the agent's reading: states, Done in its source (a claim), "Nobody reports seeing it happen" where nothing was observed, and the stale marker. It never shows a score or a percentage, and nothing on the page is generated when it opens.
- **Stale** is computed from what the rehearsal kept: each member's update time then, against the index now, and the members then against now. It says how many changed, went, joined or left, and offers Rehearse again.
- **Prepare follow-up work** on a situation says Oriel's fixed `followUpAsk(n)` in the rehearsal thread. The agent reads the situation and proposes one change set (acceptance criteria on the story each question belongs to, a new story only where none covers it, no state changes), which the person reviews in the thread as any other. The card links each change set it proposed.
- **Storage:** `rehearsal_threads` marks the thread; `rehearsals` keeps each record (the situations, the region version, each member's update time). A run's record keeps a `rehearsal.record()` call as its count and item IDs, never its quotes, as a sketch's is kept as its size.

**Why.**

- PMs ask "are we ready?", and Done answers the wrong question. On the weather epic, the agent found, unprompted, three places where Done or a ticket's text disagreed with what people said: SYN-47 Done while Slack says the copy is still with ops; SYN-84 Done while the open bug SYN-54 says an alert went out for a sailing that had left; SYN-45 silent on next-day sailings though Slack says it was updated for them.
- "Test evidence" was the first taxonomy. In round 1, the agent read the disruption retro as test evidence and the judge failed it. PM sources almost never hold test reports; they hold real cases. "Observed" names what is there, and keeps a Done state out of it.
- A binding, not a second model call shape, so it runs on every provider (the command-line agents expose only `run`), with the same caps, runs and records as any thread.

**Rejected.**

- A readiness score or percentage. The model's number would be the untrustworthy coarse view SPEC §1 warns about.
- Generating on page view. It costs about $0.25 and 70 to 110 seconds for 15 items.
- Writing the situations into the agent's prose and parsing them. The checks need structure.

**Open, for the maintainer.** See the spike's report: where the rehearsal lives (section or page), whether the rehearsal thread sits in Needs you, whether the fixed ask shows in full, and the cost of a run on a 100-item workstream.

**Consequences.**

- Migration 0021 (renumber at merge). A new action, `workstream.rehearse`, closed to the agent and outside tools. Two routes, a GET and the follow-up POST, through the dispatcher.
- The module of a rehearsal thread grows by its `rehearsal` namespace; every other module is byte-identical, so no other cassette moves.
- Four eval cases, the first of kind 7 on main, and two graders: `rehearsal` (contradictions named, open questions, only these items observed) and `follow-up` (only these ops, touching these items).
- Telemetry: none new in the spike. A story adds rehearsal started, kept or refused (by why), stale shown, and follow-up asked.
