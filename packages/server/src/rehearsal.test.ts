// Release rehearsals (the release-rehearsal spike): Rehearse the release
// opens a thread asked with Oriel's fixed words; its run hands Oriel the
// situations, which Oriel keeps only with every ID reachable and every quote
// word for word; the workstream's rehearsal view draws each item from the
// index; and Prepare follow-up work proposes its change set in that thread.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { followUpAsk, rehearsalAsk } from "@oriel/core";
import type { RehearsalView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const situations = [
  {
    title: "The passenger rebooks onto a dearer sailing",
    evidence: [
      {
        id: "jira:SYN-45",
        says: "intent",
        quote: "We absorb the difference; we never charge it.",
        against: null,
      },
      { id: "jira:SYN-102", says: "claim", quote: null, against: null },
    ],
    unanswered: [{ question: "Do vehicle supplements carry over?", id: null, quote: null }],
  },
];

// What each run's rehearsal.record() answered, in order.
const answers: string[] = [];
const recording =
  (given: unknown): Script =>
  async (bindings) => {
    const said = (await bindings.read("rehearsal.record", [given])).value;
    answers.push(String(said));
    return { value: said };
  };

const followUp: Script = async (bindings) => ({
  value: (await bindings.read("rehearsal.read", [])).value,
  writes: [["jira.setDescription", ["jira:SYN-45", "Acceptance: supplements carry over."]]],
});

async function app(t: TestContext, given: unknown = situations) {
  answers.length = 0;
  const it = await testApp(t, {
    plan: (input) =>
      input.text === rehearsalAsk
        ? [{ run: "rehearse" }, { text: "Kept." }]
        : input.text === followUpAsk(1)
          ? [{ run: "followUp" }, { text: "Proposed." }]
          : [{ text: "Hello." }],
    scripts: { rehearse: recording(given), followUp },
  });
  const { id: workstream } = json<{ id: string }>(
    await it.post("/api/workstreams", {
      kind: "picked",
      name: "Rebooking",
      items: ["jira:SYN-45", "jira:SYN-102", "jira:SYN-47"],
    }),
  );
  const view = async () =>
    json<{ rehearsal: RehearsalView | null }>(
      await it.get(`/api/workstreams/${workstream}/rehearsal`),
    ).rehearsal;
  return { ...it, workstream, view };
}

test("a workstream nobody rehearsed has no rehearsal, and the view makes none", async (t) => {
  const it = await app(t);
  assert.equal(await it.view(), null);
});

test("Rehearse the release asks with Oriel's words, and the page shows what Oriel kept, drawn from the index", async (t) => {
  const it = await app(t);
  const opened = await it.post(`/api/workstreams/${it.workstream}/rehearsals`, {});
  assert.equal(opened.status, 201);
  const { id: thread } = json<{ id: string }>(opened);
  await it.app.settled();

  const chat = json<ThreadView>(await it.get(`/api/threads/${thread}`));
  assert.ok(JSON.stringify(chat).includes("Rehearse this workstream's release"));
  assert.equal(chat.title, "Release rehearsal");
  assert.match(answers[0] ?? "", /^Oriel keeps this rehearsal: 1 situations, 2 items/);

  const view = await it.view();
  assert.equal(view?.thread.id, thread);
  assert.equal(view?.thread.running, false);
  assert.deepEqual(view?.rehearsal?.situations, situations);
  assert.deepEqual(view?.rehearsal?.stale, []);
  // States are Oriel's, from the index: SYN-45 is To Do whatever the agent said.
  const chip = view?.chips["jira:SYN-45"];
  assert.equal(chip?.kind === "item" ? chip.state?.name : null, "To Do");
  assert.equal(view?.chips[thread]?.kind, "thread");
});

test("Oriel keeps nothing with a misquote, an item the run can't reach, or what was observed without its words", async (t) => {
  const misquoted = structuredClone(situations);
  const [first] = misquoted;
  if (!first?.evidence[0]) throw new Error("no evidence");
  first.evidence[0].quote = "We charge the difference.";
  first.evidence.push(
    { id: "jira:SYN-1", says: "intent", quote: null, against: null },
    { id: "jira:SYN-47", says: "observed", quote: null, against: null },
  );
  const it = await app(t, misquoted);
  await it.post(`/api/workstreams/${it.workstream}/rehearsals`, {});
  await it.app.settled();
  const said = answers[0] ?? "";
  assert.match(said, /^Oriel kept nothing: /);
  assert.match(said, /jira:SYN-47 is observed with no quote/);
  assert.match(said, /jira:SYN-1 isn't in this region/);
  const view = await it.view();
  assert.equal(view?.rehearsal, null);
});

test("Oriel refuses a misquote, naming the situation and the item", async (t) => {
  const misquoted = structuredClone(situations);
  const quoted = misquoted[0]?.evidence[0];
  if (!quoted) throw new Error("no evidence");
  quoted.quote = "We charge the difference.";
  const it = await app(t, misquoted);
  await it.post(`/api/workstreams/${it.workstream}/rehearsals`, {});
  await it.app.settled();
  assert.match(
    answers[0] ?? "",
    /situation 1: the quote from jira:SYN-45 isn't in it word for word/,
  );
});

test("Prepare follow-up work reads the rehearsal and proposes a change set, which the view ties to its situation", async (t) => {
  const it = await app(t);
  const { id: thread } = json<{ id: string }>(
    await it.post(`/api/workstreams/${it.workstream}/rehearsals`, {}),
  );
  await it.app.settled();
  assert.equal(
    (await it.post(`/api/workstreams/${it.workstream}/rehearsal/follow-up`, { situation: 2 }))
      .status,
    404,
  );
  const asked = await it.post(`/api/workstreams/${it.workstream}/rehearsal/follow-up`, {
    situation: 1,
  });
  assert.equal(asked.status, 202);
  assert.equal(json<{ id: string }>(asked).id, thread);
  await it.app.settled();
  const view = await it.view();
  const [up] = view?.followUps ?? [];
  assert.equal(up?.situation, 1);
  assert.equal(up?.changeSets.length, 1);
  const set = up?.changeSets[0] ?? "";
  assert.equal(view?.chips[set]?.kind, "change-set");
});
