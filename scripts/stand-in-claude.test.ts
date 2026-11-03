import assert from "node:assert/strict";
import { test } from "node:test";
import { signedIn } from "../packages/agent/src/claude-code.ts";
import { accountOf } from "../packages/server/src/setup/cli.ts";
import { command, session, type StandIn } from "./stand-in-claude.ts";

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
