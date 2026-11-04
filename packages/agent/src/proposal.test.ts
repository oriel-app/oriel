// One proposal per turn, for Oriel's actions as for writes (decision 0024):
// the last finished run that recorded intents gives them, after the change
// set is captured, and a stopped turn applies none.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent } from "./contract.ts";
import type { ToolResult } from "./provider.ts";
import { fixtureRegion, harness, kinds, regionBindings, thread, waitingSlack } from "./testing.ts";

const weather = fixtureRegion("weather-epic");
const content = (results: readonly ToolResult[] | undefined) => results?.[0]?.content ?? "";
const remove = (...keys: string[]) =>
  `workstream.remove({ items: ${JSON.stringify(keys.map((key) => `jira:${key}`))} });`;

test("the last run that asked for actions gives the turn's, after the change set from the last that wrote", async () => {
  const { turn, model, records } = harness([
    { scripts: [`${remove("SYN-26")}\nreturn 1;`] },
    { scripts: [`${remove("SYN-29")}\nthread.done();\nreturn 2;`] },
    { scripts: [`jira.setEstimate("jira:SYN-26", 3);\nreturn 3;`] },
    { scripts: [`${remove("SYN-47")}\nthrow new Error("changed my mind");`] },
    { text: ["Asked Oriel to take SYN-29 out, and proposed an estimate."] },
  ]);
  const events = await turn({ region: weather, text: "Tidy up." });
  // The change set first, then what became of the actions, before the end.
  assert.deepEqual(kinds(events).slice(-3), ["change-set", "actions", "done"]);
  const [changeSet] = records.changeSets;
  assert.deepEqual(records.applied, [
    {
      changeSetId: changeSet?.changeSet.id,
      intents: [
        {
          action: "workstream.remove",
          input: { workstream: weather.workstreamId, items: ["jira:SYN-29"] },
        },
        { action: "thread.done", input: { thread: thread.id } },
      ],
    },
  ]);
  const actions = events.find(
    (e): e is Extract<AgentEvent, { kind: "actions" }> => e.kind === "actions",
  );
  const second = events.filter((e) => e.kind === "run.started")[1];
  assert.equal(actions?.runId, second?.kind === "run.started" ? second.runId : null);
  // The model reads what each run asked for, and what replaced what.
  const results = model.conversations[0]?.results ?? [];
  assert.match(
    content(results[1]),
    /Recorded 1 of Oriel's actions:\n\{"action":"workstream\.remove".*\nThey apply when this turn ends, unless a later run/,
  );
  assert.match(
    content(results[2]),
    /They replace the 1 of Oriel's actions an earlier run in this turn recorded/,
  );
  assert.doesNotMatch(content(results[3]), /Oriel's actions/);
  assert.match(
    content(results[4]),
    /It recorded 1 of Oriel's actions before it stopped; they were discarded\./,
  );
});

test("a stopped turn applies none of what it asked for", async () => {
  const { turn, records } = harness([
    { scripts: [`${remove("SYN-26")}\nreturn 1;`] },
    { text: ["Done."] },
  ]);
  const events = await turn(
    { region: weather, text: "Tidy up." },
    { onEvent: (event, controller) => event.kind === "run.finished" && controller.abort() },
  );
  assert.deepEqual(records.applied, []);
  assert.ok(!kinds(events).includes("actions"));
});

// A waiting connection's drafts (decision 0051): the last finished run that
// drafted any gives the turn's, held once its actions are done, and the
// preview it read shows as a block, unasked.
const waiting = {
  bindings: (region, threadId, shown) =>
    regionBindings(region, threadId, shown, undefined, waitingSlack),
} satisfies Parameters<typeof harness>[1];
const draft = (channels: string[]) =>
  `source.configure({ connection: "01JC0NNECT10N0000000000000", options: { channels: ${JSON.stringify(channels)} } });`;

test("the last run that drafted gives the turn's drafts, held for the user once the turn ends", async () => {
  const { turn, model, records } = harness(
    [
      {
        scripts: [
          `const waiting = await source.preview();\n${draft(["random"])}\nreturn waiting.length;`,
        ],
      },
      { scripts: [`${draft(["weather-disruptions"])}\nreturn 2;`] },
      { scripts: [`${draft([])}\nreturn 3;`] },
      { text: ["I drafted the channels for you to apply."] },
    ],
    waiting,
  );
  const events = await turn({ region: weather, text: "Fix how Slack is read." });
  assert.deepEqual(records.held, [
    [
      {
        action: "source.configure",
        input: {
          connection: "01JC0NNECT10N0000000000000",
          options: { channels: ["weather-disruptions"] },
        },
      },
    ],
  ]);
  // The preview shows as its own block, built from what the read returned.
  const block = events.find((e): e is Extract<AgentEvent, { kind: "block" }> => e.kind === "block");
  assert.equal(block?.block.form, "preview");
  assert.deepEqual(block?.block.form === "preview" ? block.block.tables[0]?.rows : null, [
    ["weather-disruptions", "2026-09-27"],
    ["random", "2026-09-05"],
  ]);
  const results = model.conversations[0]?.results ?? [];
  assert.match(content(results[1]), /Drafted 1 draft:\n\{"action":"source\.configure"/);
  assert.match(content(results[2]), /They replace the 1 draft an earlier run in this turn made/);
  assert.match(content(results[3]), /expected 1 to 50 channels/);
});

test("a stopped turn holds none of its drafts", async () => {
  const { turn, records } = harness(
    [{ scripts: [`${draft(["random"])}\nreturn 1;`] }, { text: ["Done."] }],
    waiting,
  );
  await turn(
    { region: weather, text: "Fix how Slack is read." },
    { onEvent: (event, controller) => event.kind === "run.finished" && controller.abort() },
  );
  assert.deepEqual(records.held, []);
});
