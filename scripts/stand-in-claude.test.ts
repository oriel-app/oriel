import assert from "node:assert/strict";
import { test } from "node:test";
import { readResponse } from "../packages/agent/src/anthropic.ts";
import { harnessRunTool, harnessServer, signedIn } from "../packages/agent/src/claude-code.ts";
import { accountOf } from "../packages/server/src/setup/cli.ts";
import { command, endlessScript, session, type StandIn } from "./stand-in-claude.ts";

const out: StandIn = { version: "2.1.314", updatesTo: "2.1.314", signedIn: false, signIn: "works" };

test("the stand-in signs in, or fails to, as its state says", () => {
  assert.deepEqual(command(out, ["--version"]).out, ["2.1.314 (Claude Code)"]);
  const works = command(out, ["auth", "login", "--claudeai"]);
  assert.equal(works.code, 0);
  assert.equal(works.next?.signedIn, true);
  const fails = command({ ...out, signIn: "fails" }, ["auth", "login", "--claudeai"]);
  assert.equal(fails.code, 1);
  assert.equal(fails.next, undefined);
  // As Oriel reads `claude auth status`.
  assert.equal(accountOf(command(out, ["auth", "status", "--json"]).out.join("\n")), null);
  assert.deepEqual(accountOf(command(works.next!, ["auth", "status", "--json"]).out.join("\n")), {
    plan: "Claude Pro",
    email: "pm@example.com",
  });
  assert.equal(command(out, ["mcp", "list"]).code, 2);
});

test("a stand-in too old updates to the version it's given", () => {
  const old = { ...out, version: "2.1.0" };
  const updated = command(old, ["update"]);
  assert.equal(updated.code, 0);
  assert.equal(updated.next?.version, "2.1.314");
  assert.deepEqual(command(updated.next!, ["update"]).out, ["Claude Code is up to date."]);
});

test("a session says whether there's an account, and answers a turn with no tools", () => {
  const init = { type: "control_request", request_id: "init", request: { subtype: "initialize" } };
  const response = (state: StandIn) =>
    (session(state, "m", init)[0]!.response as Record<string, unknown>).response;
  assert.equal(signedIn(response(out)), false);
  assert.equal(signedIn(response({ ...out, signedIn: true })), true);
  const usage = {
    type: "control_request",
    request_id: "oriel-1",
    request: { subtype: "get_usage" },
  };
  assert.equal((session(out, "m", usage)[0]!.response as Record<string, unknown>).subtype, "error");
  const [init2, result] = session(out, "claude-haiku-5-5", { type: "user", message: {} });
  assert.deepEqual(
    [init2?.subtype, init2?.tools, init2?.permissionMode, init2?.model],
    ["init", [], "dontAsk", "claude-haiku-5-5"],
  );
  assert.deepEqual([result?.type, result?.subtype, result?.is_error], ["result", "success", false]);
});

test("a thread's turn runs a script that never ends, and ends once Oriel answers it", async () => {
  const ready = { ...out, signedIn: true };
  const [init, ...rest] = session(ready, "m", { type: "user", message: {} }, true);
  assert.deepEqual(
    [init?.tools, init?.mcp_servers],
    [[harnessRunTool], [{ name: harnessServer, status: "connected" }]],
  );
  const asks = rest.at(-1)!;
  const events = rest.slice(0, -1).map((line) => line.event);
  // As the harness reads the CLI's relay of the model's stream.
  const reader = readResponse(
    (async function* () {
      yield* events;
    })(),
    "m",
  );
  let step = await reader.next();
  while (!step.done) step = await reader.next();
  assert.deepEqual(step.value.calls, [
    { id: "toolu_stand_in_run", name: harnessRunTool, input: { script: endlessScript } },
  ]);
  const request = asks.request as { subtype: string; message: { params: { arguments: unknown } } };
  assert.equal(request.subtype, "mcp_message");
  assert.deepEqual(request.message.params.arguments, { script: endlessScript });
  const answered = { type: "control_response", response: { request_id: asks.request_id } };
  const ending = session(ready, "m", answered, true).map((line) => line.event as { type: string });
  assert.equal(ending.at(-1)?.type, "message_stop");
  assert.deepEqual(session(ready, "m", { type: "control_response", response: {} }, true), []);
});
