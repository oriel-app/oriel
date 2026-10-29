// The script reaches the guest as data and runs as the body of an async
// function. These tests hold the line: what can't compile as a function body
// never starts, the typecheck refuses exactly what the compile step refuses,
// and runtime lines map back to the script.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { guestStart, scriptLineOffset } from "./shim.ts";
import { fixtureReader, fixtureRegion, issueTypes, runGuest, snapshotAfter } from "./testing.ts";
import { typecheck } from "./typecheck.ts";

const bindings = bindingsFor(fixtureRegion("picked"), {
  reader: fixtureReader(snapshotAfter(0)),
  issueTypes,
});

// The escape a joined entry allowed: close the wrapper, import a file
// statically, reopen.
const escape = [
  "});",
  "// @ts-ignore",
  'import d from "/Users/u/creds.json" with { type: "json" };',
  "__oriel.run(async () => { return d;",
].join("\n");

const refused: [string, string][] = [
  ["the static-import escape", escape],
  ["an import declaration", 'import x from "./x.ts";\nreturn x;'],
  ["a side-effect import", 'import "/etc/hosts";'],
  ["an export", "export const a = 1;"],
  ["an early close", "return 1;\n})"],
  ["a close and reopen", "}\nawait import('/etc/hosts');\nasync function again() {"],
  ["a brace that closes the body", "}"],
  ["an enum", "enum E { A }\nreturn E.A;"],
  ["a binding redeclared", "let jira = 1;\nreturn jira;"],
];

for (const [name, script] of refused) {
  test(`${name} is refused before any run, by the compile step and the typecheck alike`, async () => {
    const start = guestStart(script);
    assert.equal(start.ok, false);
    if (start.ok) return;
    assert.equal(start.error.phase, "typecheck");
    assert.match(
      start.error.message,
      /^The script doesn't compile as the body of an async function: /,
    );
    assert.deepEqual(await typecheck(script, bindings.dts), start.error);
    await assert.rejects(runGuest(bindings, script), /doesn't compile as the body/);
  });
}

test("a script is sent as data: types stripped in place, strict, nothing joined", () => {
  const script = "const n: number = 1;\nreturn n as number;";
  const start = guestStart(script);
  assert.ok(start.ok);
  assert.deepEqual(start.reply, {
    id: 0,
    ok: true,
    value: '"use strict";\nconst n         = 1;\nreturn n          ;',
  });
  assert.equal(bindings.shim.includes(script), false);
});

test("a dynamic import still compiles; the sandbox's permissions decide it", () => {
  assert.equal(guestStart('return await import("file:///etc/hosts");').ok, true);
});

test("a runtime error's line, less scriptLineOffset, is the script's line", async () => {
  const run = await runGuest(bindings, "const a: number = 1;\n\n  throw new Error('third line');");
  assert.equal(run.outcome?.kind, "threw");
  const message = run.outcome?.kind === "threw" ? run.outcome.message : "";
  const [, line, column] = /<anonymous>:(\d+):(\d+)/.exec(message) ?? [];
  assert.deepEqual([Number(line) - scriptLineOffset, Number(column)], [3, 9]);
});

test("the typecheck may be stricter on syntax a function body allows, never looser", async () => {
  // HTML-like comments parse in a function body but not in TypeScript.
  const script = "<!-- a comment to a browser\nreturn 1;";
  assert.equal(guestStart(script).ok, true);
  assert.equal((await typecheck(script, bindings.dts))?.phase, "typecheck");
});
