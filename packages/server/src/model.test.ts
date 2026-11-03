// Which model the server runs the agent and titles on: the key when there is
// one, else the person's Claude Code, else none, which says how to set one up.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HarnessProblem } from "@oriel/agent";
import { chooseModel, modelOptions, setupAgent } from "./model.ts";

const cli = { path: "/usr/local/bin/claude", version: "2.1.314" };
const found = async () => ({ ok: true as const, cli });
const problem: HarnessProblem = {
  kind: "missing",
  message:
    "Oriel's agent runs on Claude Code, which isn't installed here. Install Claude Code and sign in to it, then restart Oriel.",
};
const absent = async () => ({ ok: false as const, problem });
const unchecked = async (): Promise<never> => {
  throw new Error("the CLI was checked");
};

test("with a key, nothing changes: the API, and the CLI isn't even looked for", async () => {
  assert.deepEqual(await chooseModel({ key: "sk-ant-key", check: unchecked }), {
    kind: "api",
    key: "sk-ant-key",
  });
});

test("without a key, a supported, signed-in Claude Code; without one, none", async () => {
  assert.deepEqual(await chooseModel({ key: null, check: found }), { kind: "claude-code", cli });
  assert.deepEqual(await chooseModel({ key: null, check: absent }), { kind: "none", problem });
});

test("a later settings page can prefer Claude Code over a key, and falls back to the key", async () => {
  assert.equal(
    (await chooseModel({ key: "k", prefer: "claude-code", check: found })).kind,
    "claude-code",
  );
  assert.equal((await chooseModel({ key: "k", prefer: "claude-code", check: absent })).kind, "api");
});

test("with no model, every turn says how to set one up and names no credential", async () => {
  const events = [];
  for await (const event of setupAgent(problem).turn({} as never, {
    signal: new AbortController().signal,
    log: () => {},
  }))
    events.push(event);
  assert.deepEqual(events, [
    { kind: "error", message: problem.message },
    { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
  ]);
  assert.doesNotMatch(problem.message, /key|token|password|credential/i);
  const none = modelOptions({ kind: "none", problem });
  assert.equal(none.titler, undefined);
  assert.ok(none.agent);
});

test("each choice builds an agent and a titler, and says which it is without the key", () => {
  const api = modelOptions({ kind: "api", key: "sk-ant-secret-value" });
  assert.ok(api.agent && api.titler);
  assert.doesNotMatch(api.describe, /sk-ant-secret-value/);
  const harness = modelOptions({ kind: "claude-code", cli });
  assert.ok(harness.agent && harness.titler);
  assert.match(harness.describe, /Claude Code 2\.1\.314/);
});
