# 0062 A message says what it is about: looking at an item adds nothing

Accepted 2026-11-09 (OA-334, epic OA-332). Changes SPEC §2. Amends 0027 and 0030 only in what reaches the agent with a message; cite (OA-137) is unchanged.

Adds: none

**Decision.**

- **Looking at.** The item open beside a chat's composer (the item panel) is offered over its field as "Looking at SYN-99". Sending with it makes the message **about** that item. × leaves it out of the next message ("Not sending", with Add back). With the field empty, opening another item swaps it. With words typed, the draft keeps its item and the newly opened one is offered dashed ("+ SYN-104"); + adds it, so the message is about both. A typed question never changes subject behind the person's back. Closing the item takes its chip only while nothing is typed. The composer's foot says it: "Reads your whole window, and SYN-99". It works in the window chat and in a thread's composer.
- **What is kept.** A user message has a nullable `about`: up to four items, each by ID, marked `outside` when it wasn't in the thread's region as the message was sent (Oriel marks it, once the thread has caught up with its workstream, never the window), and with `under`, the chat entry it was opened from, if any. It is stored in the message's own content, beside its text, so no migration is needed; a message stored before has none. The thread shows it under the message as "about SYN-99", which a reload keeps, and so does anything that shows the thread later.
- **How the agent gets it.** Never in the system prompt and never as the person's words. Just before the message, Oriel's note says what it is about, by ID, as a tool result of a stand-in call, as Oriel's other notes are (OA-91): which items are in the region, and which are outside it and read-only. The agent reads them with `items.read()`.
- **Looking adds nothing to the workstream.** Cite stays a separate act: "a cited item joins the thread's workstream" (OA-137). The composer offers Cite beside a read-only item, which adds it as the panel's Add to workstream does, with its Undo. The agent may still add it itself, with Undo, as 0024 allows.
- **Outside the region is read-only,** as the escape hatch's results are (SPEC §6). A thread whose messages were about items outside its region has `items.read()` take them too, declared as `LookedId`, read-only, and the host reaches them as it reaches what a run's `search()` found. No write takes them: a source's write binds only the region's IDs, and the change-set engine checks its targets against the region again. The note says read-only, so the agent proposes no change it can't make. In the window chat every item is read as the window is, so the chip says nothing of read-only there.

**Why.**

- "I might want to keep chatting about the thing I just opened": the chat never knew what was open, so the person had to name it, or paste it.
- An ID in a tool result keeps synced text out of the person's words (SPEC §5), as 0030's questions to start from do.
- Looking isn't curating. A cite changes a workstream; reading an item while asking about it shouldn't.
- The read-only rule is the one Oriel already has for what's outside the region; a third state would be one more thing to learn.

**Rejected.**

- A column of its own on `messages`: a message's content already holds its parts as JSON, and an old row reads as having none.
- The open item's title in the person's message: synced text as their words.
- Declaring what the latest message is about in the module: it would change the tool's text with every message. The module changes only once a thread has looked outside its region, by the IDs alone.
- Sending the open item with every message automatically, with no chip: the person couldn't see or undo what went.

**Consequences.**

- The base module and system prompt are unchanged. A thread that looked at items outside its region has about 150 bytes more in its module, and each message with an about has Oriel's note, about 200 bytes.
- OA-137's cite can carry its item to the agent the same way, without a second pipe.
- Story OA-333 keeps the window chat beside an open item; until it lands, the window chat's chip shows once the item closes with words typed.
- Telemetry: none new. What a message is about is never counted by its items.
