// The script reaches the guest as data and runs as the body of an async
// function. These tests hold the line: what can't compile as a function body
// never starts, the typecheck refuses exactly what the compile step refuses,
// and runtime lines map back to the script.
import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { bindingsFor } from "./bindings.ts";
import { guestStart, maxNesting, maxScriptBytes, nesting, scriptLineOffset } from "./shim.ts";
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
  ["an enum", "enum E { A }\nreturn E.A;"],
  ["a binding redeclared", "let search = 1;\nreturn search;"],
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

const parens = (depth: number) => `return ${"(".repeat(depth)}1${")".repeat(depth)};`;

test("bracket nesting is counted roughly: every bracket, strings included", () => {
  assert.equal(nesting("f(a[0], { b: [1] });"), 3);
  assert.equal(nesting('const s = "((((";'), 4);
  assert.equal(nesting(parens(maxNesting)), maxNesting);
});

test("nesting deeper than the bound is refused; at the bound it compiles", async () => {
  assert.equal(guestStart(parens(maxNesting)).ok, true);
  const deep = guestStart(parens(maxNesting + 1));
  assert.deepEqual(deep.ok ? null : [deep.error.phase, deep.error.message], [
    "typecheck",
    `The script nests brackets more than ${maxNesting} deep.`,
  ]);
  assert.deepEqual(
    await typecheck(parens(maxNesting + 1), bindings.dts),
    deep.ok ? null : deep.error,
  );
});

test("a script over the size bound is refused as a limit", () => {
  const big = guestStart(`// ${"x".repeat(maxScriptBytes)}`);
  assert.equal(big.ok ? null : big.error.phase, "limit");
});

// Deep enough to overflow the stripper and leave it failing in its thread, so
// it runs in a worker: had it reached the stripper, the second call would fail.
test("deep nesting never reaches the stripper, and its thread stays well", async () => {
  const shim = new URL("./shim.ts", import.meta.url).href;
  const source = [
    'import { parentPort } from "node:worker_threads";',
    `import { guestStart } from ${JSON.stringify(shim)};`,
    'const deep = guestStart("(".repeat(8000) + "1" + ")".repeat(8000));',
    'const after = guestStart("const a: number = 1;\\nreturn a;");',
    "parentPort.postMessage({ deep: deep.ok ? null : deep.error.message, after: after.ok });",
  ].join("\n");
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
  const [result] = await once(worker, "message");
  assert.deepEqual(result, {
    deep: `The script nests brackets more than ${maxNesting} deep.`,
    after: true,
  });
});
