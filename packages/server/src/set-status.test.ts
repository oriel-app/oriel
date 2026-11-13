import assert from "node:assert/strict";
import { test } from "node:test";
import type { TurnInput } from "@oriel/agent";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { scriptedAgent } from "./scripted-agent.ts";
import { estimate, json, testApp } from "./testing.ts";

test("a turn reads each change set's state as the window shows it, after it was applied or rejected between turns (OA-310)", async (t) => {
  const inputs: TurnInput[] = [];
  const app = await testApp(t, {
    memory: true,
    scripts: { estimate },
    agent: (deps) => {
      const scripted = scriptedAgent(deps, (input) =>
        input.text === "Estimate" ? [{ run: "estimate" }] : [{ text: "Noted." }],
      );
      return {
        turn: (input, options) => {
          inputs.push(input);
          return scripted.turn(input, options);
        },
      };
    },
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hello" }),
  );
  await app.app.settled();
  const ask = async (text: string) => {
    app.advance(1000);
    await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    return json<ThreadView>(await app.get(`/api/threads/${id}`));
  };
  const proposed = async () => {
    const view = await ask("Estimate");
    const entry = view.entries.findLast((e) => e.kind === "change-set");
    assert.ok(entry?.kind === "change-set");
    return entry.changeSetId;
  };
  const decide = async (set: string, kind: "approve" | "reject") => {
    const { hash } = json<DiffView>(await app.post(`/api/change-sets/${set}/diff`));
    app.advance(1000);
    const decided = await app.post(`/api/change-sets/${set}/${kind}`, { hash });
    assert.equal(decided.status, 200);
    await app.app.settled();
  };
  const applied = await proposed();
  await decide(applied, "approve");
  await ask("Is it waiting?");
  const rejected = await proposed();
  await decide(rejected, "reject");
  await ask("And that one?");
  const states = inputs.map((input) => {
    const last = input.history.at(-1);
    return last?.role === "states" ? last.changeSets.map((set) => [set.id, set.state]) : null;
  });
  assert.deepEqual(states, [
    null,
    null,
    [[applied, "applied"]],
    [[applied, "applied"]],
    [
      [rejected, "rejected"],
      [applied, "applied"],
    ],
  ]);
});
