// The script reaches the guest as data and runs as the body of an async
// function. These tests hold the line: what can't compile as a function body
// never starts, and the typecheck refuses exactly what the compile step refuses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { guestStart } from "./shim.ts";
import { fixtureReader, fixtureRegion, namespaces, runGuest, snapshotAfter } from "./testing.ts";
import { typecheck } from "./typecheck.ts";

const bindings = bindingsFor(fixtureRegion("picked"), {
  reader: fixtureReader(snapshotAfter(0)),
  namespaces,
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
];

for (const [name, script] of refused) {
  test(`${name} is refused before any run, by the compile step and the typecheck alike`, async () => {
    const start = guestStart(script);
    assert.equal(start.ok, false);
    if (start.ok) return;
    assert.equal(start.error.phase, "typecheck");
    assert.deepEqual(await typecheck(script, bindings.dts), start.error);
    await assert.rejects(runGuest(bindings, script));
  });
}
