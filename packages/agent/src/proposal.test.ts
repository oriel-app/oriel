import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent } from "./contract.ts";
import { fixtureRegion, harness, kinds, thread } from "./testing.ts";

const weather = fixtureRegion("weather-epic");
const remove = (...keys: string[]) =>
  `workstream.remove({ items: ${JSON.stringify(keys.map((key) => `jira:${key}`))} });`;

test("the last run that asked for actions gives the turn's, after the change set from the last that wrote", async () => {
  const { turn, records } = harness([
    { scripts: [`${remove("SYN-26")}\nreturn 1;`] },
    { scripts: [`${remove("SYN-29")}\nthread.done();\nreturn 2;`] },
    { scripts: [`jira.setEstimate("jira:SYN-26", 3);\nreturn 3;`] },
    { scripts: [`${remove("SYN-47")}\nthrow new Error("changed my mind");`] },
    { text: ["Asked Oriel to take SYN-29 out, and proposed an estimate."] },
  ]);
  const events = await turn({ region: weather, text: "Tidy up." });
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
