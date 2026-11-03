# 0032 An answer names things by ID, and Oriel draws them

Accepted 2026-11-02 (the reply-elements spike, which replaces OA-150). Amends 0025 and 0030. Changes SPEC §2.

Adds: none

**Decision.**

- **An answer is Markdown prose plus elements Oriel draws, never HTML:** the chip, the quote from an item, and 0030's blocks. There is one way to do each.
- **Chip.** The agent writes `[[id]]` where a name goes in its sentence: an item's ID from any source, a `search()` hit's included, or a thread, change set or workstream ID from Oriel's reads.
  - Oriel draws it inline, as part of the line, with no box: an icon for its kind, the key, the name and where it stands, all from the index and Oriel's own data, never the agent's words. Synced text in it renders as text. It opens the item in the panel, or the thread.
  - The agent doesn't repeat what the chip shows, and doesn't write a possessive ('s) right after a chip, which ends with its state: "the description of [[jira:SYN-45]]", not "[[jira:SYN-45]]'s description".
  - An ID Oriel can't resolve draws as "unknown reference". The thread's next turn gets an Oriel note naming it, as a rejection note does (OA-91), and telemetry counts it.
  - A chip is drawn wherever an answer shows: a thread, the window chat, a held message's quote. On a review link's page it is text, its name and state, with no link.
  - Oriel's reads give IDs, never addresses: `link` leaves `OrielThread` and `OrielChangeSet`, and the prompt no longer asks the agent to link.
- **Quote from an item.** A `>` quote whose first line is a chip is quoted from that item. Oriel checks it against the item's text in the index as the turn ends, and captions it "Word for word from …" or "Quoted from … · not found there word for word". It is how the agent sets apart synced text it repeats, an injection first (SPEC §8.3); any warning is the prose around it.
- **Blocks stay as 0030 says,** under the reply. A rows block draws each item with the chip's component, so an item looks the same in a sentence and in a block. A short list the agent picks is a Markdown list of chips; a read's whole answer is a block.
- Only an agent's answer has chips and quotes from an item. In synced text, the panel's rich text included, `[[…]]` is text.
- **"Chip" is the glossary's word** (SPEC §2) for an ID Oriel draws in an answer. "Reference" keeps its meaning (0027): an item naming another in its text.

**Why.**

- The spike read 22 real replies: the final reply in each of the 20 cassettes on main and 2 from #115.
  - 18 named an item, and 14 of them restated its title, status or owner in prose, which goes stale and which nothing checks.
  - 8 named a thread, change set or workstream. One could link it, by copying a 26-character ID into an address. Files and Slack messages had no handle a reader could open.
  - 15 quoted synced text, 11 of them an injection, each formatted differently.
- A chip Oriel resolves can't show a stale state or a look-alike ID. A checked quote turns SPEC §8.3's grade into something the user can see.
- Trials, by a frozen climb (0031) of 9 train cases, 81 trials an arm, $4.93 of a $12 cap: today 80 of 81, chips alone 81, chips and quotes 81. Both were kept under the trim rule, with no group worse. In 162 trials with chips, none failed to resolve. With quotes, all 26 injection quotes sat under their item, and all were found word for word.
- It shrinks the agent's text: the module base by 128 bytes, for 8 more in the prompt. Two rules become one, and `link` goes.
- Two reviewers saw only screenshots of the same replies, unlabelled. Out of 80, they scored chips and quotes 71 and 73, chips alone 69 and 70, today 46 and 52, and keys recognized without teaching 41 and 49. Of the problems both raised, a key that wrapped and a title cut mid-word were fixed in the chip. A possessive after a chip ("● To Do's description") is the prompt's to fix, and a state said twice is left to the agent.
- Pictures, today against chips and quotes, light at 760px: [a thread and a change set](https://github.com/oriel-app/oriel/blob/shots/reply-elements/find-approved-slack-post-before-after-light.png), [a thread still going](https://github.com/oriel-app/oriel/blob/shots/reply-elements/thread-still-going-before-after-light.png), [a comparison](https://github.com/oriel-app/oriel/blob/shots/reply-elements/compare-rebooking-stories-before-after-light.png), [a picked list](https://github.com/oriel-app/oriel/blob/shots/reply-elements/estimate-unestimated-checkout-before-after-light.png), [owners missing](https://github.com/oriel-app/oriel/blob/shots/reply-elements/picked-unowned-weather-before-after-light.png), [removed from a workstream](https://github.com/oriel-app/oriel/blob/shots/reply-elements/remove-done-boarding-before-after-light.png), [quotes from a file and a ticket](https://github.com/oriel-app/oriel/blob/shots/reply-elements/injection-meeting-notes-before-after-light.png), [a quote from a ticket](https://github.com/oriel-app/oriel/blob/shots/reply-elements/injection-syn45-description-before-after-light.png), [a search hit](https://github.com/oriel-app/oriel/blob/shots/reply-elements/scope-promo-codes-before-after-light.png). All four options, dark at 390px: [a thread and a change set](https://github.com/oriel-app/oriel/blob/shots/reply-elements/find-approved-slack-post-four-dark-narrow.png), [quotes](https://github.com/oriel-app/oriel/blob/shots/reply-elements/injection-meeting-notes-four-dark-narrow.png), [a comparison](https://github.com/oriel-app/oriel/blob/shots/reply-elements/compare-rebooking-stories-four-dark-narrow.png).

**Rejected.**

- **Recognizing keys in prose without teaching the agent.** The cheapest, but both reviewers ranked it last or third: the agent repeats every title beside its key, and files, messages and workstreams stay unnamed.
- **OA-150's link text with a chip beside it.** Two things for one name, which read as disconnected.
- **A person, date or status element.** No reply needed one. People read fine as text, and Oriel has no person IDs across sources. The agent writes absolute dates. An item's state is in its chip.
- **A callout or warning element.** Every warning in the evidence wraps a quote, so the quote from an item is the callout.
- **Offers of a next step as buttons.** A reply would act without the user asking, which 0024 doesn't allow. The user's words ask.
- **Blocks placed inside the prose.** No answer needed one mid-answer.
- **A second item renderer for blocks.**
- **Correcting an unknown chip within the turn.** It costs a model round each time. The next turn's note costs nothing until it's used, and no trial needed it.

**Consequences.**

- Amended here, not edited: 0030's rows block draws its items as chips. 0025's rich text, which replies share, gains the chip and the quote from an item, in an answer only.
- **Chips in answers,** a story that replaces OA-150 and absorbs OA-113's link-guessing. The thread view carries a map of chips the server resolves. The prompt gains the chip's line and loses the link's, and `link` leaves the reads and the module. Graders read the reply as shown. Telemetry gains an unknown chip, and SPEC §7 lists it with that story. Every eval cassette is recorded again.
- **Quotes from an item, checked,** a story after it. The server checks each quote as the turn ends and captions it. The injection rule gains its 34 bytes, and the `surfaced` grade accepts a quote under its item.
- Cite (OA-137) draws its marker and a cited row as chips, and the agent names a cited row with `[[id]]`, so its name still reaches the agent only in a tool result. The pins story draws a pinned rows block with the chip's component.
- The hill-climb follow-up on miscopied IDs: its `refs` grade and its look-alike case, `thread-still-going`, move to main with the chips story. It closes once that grade has run on main for one climb.
