// Choices on the server (the decision-desk spike): found only in a run Oriel
// starts for them, checked word for word against their items and dated from
// each source's own view, stored with their turn, and settled only by the
// user, by Oriel's own line in the thread and, for a choice made or a
// clarification asked, the fixed words that start the turn carrying it out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fareChoice } from "./scripted-agent.ts";
import type { ChatEntry, ThreadView } from "@oriel/web/view";
import type { Ulid } from "@oriel/core";
import { json, type Script, testApp } from "./testing.ts";
import { placeOf } from "./choices.ts";
import { devPlan } from "./scripted-agent.ts";

const conversation = "slack:C0FW1WEATHR-1788444000.000100";
const story = "jira:SYN-45";

const hand =
  (choice: unknown): Script =>
  async (bindings) => ({ value: (await bindings.read("choices.add", [choice])).value });

// A workstream of the fare conversation and its story, and a thread on it
// whose first turn asked what's undecided, run by `script`.
async function asked(t: Parameters<typeof testApp>[0], script: Script = hand(fareChoice)) {
  const said: string[] = [];
  const app = await testApp(t, {
    slack: { kind: "fixture" },
    writes: true,
    scripts: { hand: script, carry: carry() },
    plan: (input) => {
      said.push(input.text);
      if (input.choices) return [{ run: "hand" }, { text: "One choice is open." }];
      const last = input.history.findLast((m) => m.role === "note");
      return last?.role === "note" && last.note.kind === "choice"
        ? [{ run: "carry" }, { text: "Proposed." }]
        : [{ text: "Hello." }];
    },
  });
  const { id: workstream } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Fares",
      items: [conversation, story],
    }),
  );
  const { id } = json<{ id: Ulid }>(
    await app.post(`/api/workstreams/${workstream}/threads`, { text: "Hi" }),
  );
  await app.app.settled();
  const found = await app.post(`/api/threads/${id}/choices`);
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  return { app, id, said, found, view };
}

const carry = (): Script => async () => ({
  value: "proposed",
  writes: [["slack.reply", [conversation, "Decided: next day too."]]],
});

const choiceOf = (entries: readonly ChatEntry[]) => {
  const entry = entries.findLast((e) => e.kind === "choice");
  assert.ok(entry?.kind === "choice", "a choice shows");
  return entry.choice;
};

test("a run Oriel starts finds a choice, with each quote dated by the source, never by the agent", async (t) => {
  const { app, id, said, found, view } = await asked(t);
  assert.equal(found.status, 202);
  assert.equal(said.at(-1), "What's still undecided here?");
  const choice = choiceOf(view.entries);
  assert.equal(choice.question, fareChoice.question);
  assert.deepEqual(
    choice.options.map((o) => o.standing),
    ["agreed", "proposed"],
  );
  const [decided, , supplements] = choice.options[0]?.evidence ?? [];
  // The decision is the conversation's root message; supplements, a reply.
  assert.equal(decided?.author, "Dara Nikolaidis");
  assert.equal(decided?.at, "2026-09-03T14:00:00.000Z");
  assert.equal(supplements?.at, "2026-09-03T15:02:00.000Z");
  const [amended, , body] = choice.options[1]?.evidence ?? [];
  assert.equal(amended?.author, "Farid Haddad");
  assert.equal(amended?.at, "2026-09-20T09:30:00.000Z");
  // In the story's description, which has no one date: as of its last change.
  assert.equal(body?.at, null);
  assert.equal(body?.place, "Description");
  assert.equal(body?.asOf, "2026-06-05T05:12:00.000Z");
  assert.ok(choice.items.every((item) => !item.changed));
  const counted = app.app.telemetry().filter((e) => e.name.startsWith("choice."));
  assert.deepEqual(
    counted.map((e) => [e.name, e.data]),
    [["choice.shown", { threadId: id, options: 2, quotes: 6 }]],
  );
});

test("a quote not in its item word for word is refused, and nothing shows", async (t) => {
  const misquoted = structuredClone(fareChoice);
  const [first] = misquoted.options;
  if (first?.evidence[0]) first.evidence[0].quote = "Everyone agreed next-day sailings are free.";
  const { app, view } = await asked(t, hand(misquoted));
  assert.equal(
    view.entries.some((e) => e.kind === "choice"),
    false,
  );
  const run = view.entries.find((e) => e.kind === "run.finished");
  assert.ok(run?.kind === "run.finished");
  assert.match(run.run.returned ?? "", /aren't in their items word for word/);
  assert.ok(app.app.telemetry().some((e) => e.name === "choice.refused"));
});

test("a quote from an item outside the workstream is refused", async (t) => {
  const stray = structuredClone(fareChoice);
  const [first] = stray.options;
  if (first?.evidence[0]) first.evidence[0].id = "jira:SYN-61";
  const { view } = await asked(t, hand(stray));
  const run = view.entries.find((e) => e.kind === "run.finished");
  assert.ok(run?.kind === "run.finished");
  assert.match(run.run.returned ?? "", /isn't in this workstream/);
});

test("an ordinary turn's module has no choices, so it can't hand Oriel one", async (t) => {
  const app = await testApp(t, {
    slack: { kind: "fixture" },
    scripts: { hand: hand(fareChoice) },
    plan: () => [{ run: "hand" }],
  });
  const { id: workstream } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Fares", items: [conversation] }),
  );
  const { id } = json<{ id: Ulid }>(
    await app.post(`/api/workstreams/${workstream}/threads`, { text: "Decide for me" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.equal(
    view.entries.some((e) => e.kind === "choice"),
    false,
  );
  // The fake sandbox lets the read's refusal through as the turn's error.
  const error = view.entries.find((e) => e.kind === "error");
  assert.ok(error?.kind === "error");
  assert.match(error.message, /"choices\.add" isn't a read here/);
});

test("choosing is the user's: Oriel's line names the option, and fixed words start the turn", async (t) => {
  const { app, id, said, view } = await asked(t);
  const choice = choiceOf(view.entries);
  const reply = await app.post(`/api/threads/${id}/choices/${choice.id}`, {
    outcome: "chosen",
    option: 1,
  });
  assert.equal(reply.status, 202);
  await app.app.settled();
  assert.match(said.at(-1) ?? "", /^Carry my choice into the work/);
  const after = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const note = after.entries.findLast((e) => e.kind === "note");
  assert.ok(note?.kind === "note" && note.note.kind === "choice");
  assert.deepEqual(
    { outcome: note.note.outcome, option: note.note.option, label: note.note.label },
    { outcome: "chosen", option: 1, label: fareChoice.options[1]?.label },
  );
  assert.equal(after.changeSets.length, 1, "the turn proposed a change set");
  assert.ok(app.app.telemetry().some((e) => e.name === "choice.settled"));
});

test("deferring starts no turn; an option a choice doesn't have, or a choice the thread lacks, is refused", async (t) => {
  const { app, id, said, view } = await asked(t);
  const choice = choiceOf(view.entries);
  const turns = said.length;
  assert.equal(
    (await app.post(`/api/threads/${id}/choices/${choice.id}`, { outcome: "deferred" })).status,
    200,
  );
  await app.app.settled();
  assert.equal(said.length, turns);
  const bad = await app.post(`/api/threads/${id}/choices/${choice.id}`, {
    outcome: "chosen",
    option: 7,
  });
  assert.equal(bad.status, 400);
  const missing = await app.post(`/api/threads/${id}/choices/01JZZZZZZZZZZZZZZZZZZZZZZZ`, {
    outcome: "deferred",
  });
  assert.equal(missing.status, 404);
});

test("a quote is dated from the message it's in, and a body has no one date", () => {
  const blocks = [
    {
      kind: "text" as const,
      heading: "Description",
      text: "Keep the fare.",
      format: "plain" as const,
    },
    {
      kind: "messages" as const,
      heading: null,
      empty: "",
      messages: [
        { author: "Ines", at: "2026-09-02T10:15:00.000Z", text: "Keep the fare, please." },
        { author: "Dara", at: "2026-09-03T14:00:00.000Z", text: "Decision: keep the fare." },
      ],
    },
  ];
  assert.deepEqual(placeOf("Decision: keep the fare", blocks), {
    author: "Dara",
    at: "2026-09-03T14:00:00.000Z",
    place: "message",
  });
  assert.deepEqual(placeOf("Keep the fare.", blocks), {
    author: null,
    at: null,
    place: "Description",
  });
  assert.equal(placeOf("keep the fares", blocks), null);
});

test("the dev server's scripted agent finds the fare choice only where the conversation is", () => {
  const input = (items: string[], choices: boolean) =>
    ({
      text: "What's still undecided here?",
      history: [],
      region: { items: items.map((id) => ({ id })) },
      ...(choices ? { choices: true } : {}),
    }) as unknown as Parameters<typeof devPlan>[0];
  assert.ok(
    devPlan(input([conversation], true)).some((s) => "run" in s && s.run.includes("choices.add")),
  );
  assert.ok(
    devPlan(input([story], true)).every((s) => !("run" in s) || !s.run.includes("choices.add")),
  );
});
