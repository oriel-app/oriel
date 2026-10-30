import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { fixtureReader, fixtureRegion, issueTypes, snapshotAfter } from "./testing.ts";
import { parseOutput, typecheck } from "./typecheck.ts";

const { dts } = bindingsFor(fixtureRegion("boarding-epic"), {
  reader: fixtureReader(snapshotAfter(0)),
  issueTypes,
});

test("a clean script passes", async () => {
  assert.equal(await typecheck("const s = await jira.listStories();\nreturn s.length;", dts), null);
});

test("type errors come back as a RunError, at the script's own lines", async () => {
  const script = [
    "const n: number = 'one';",
    "const stories = await jira.listStories();",
    'jira.setEstimate("jira:SYN-80", 3);',
  ].join("\n");
  const error = await typecheck(script, dts);
  assert.ok(error);
  assert.equal(error.phase, "typecheck");
  assert.deepEqual(error.logs, []);
  assert.ok(error.hint);
  assert.equal(
    error.message,
    [
      "2 type errors in the script:",
      "line 1:7: Type 'string' is not assignable to type 'number'. (TS2322)",
      `line 3:18: Argument of type '"jira:SYN-80"' is not assignable to parameter of type 'Target'. (TS2345)`,
    ].join("\n"),
  );
});

test("the types refuse search results, revert-only ops and edits to read results", async () => {
  const script = [
    'const [found] = await search("checkout");',
    "if (found) jira.setSummary(found.id, 'x');",
    'jira.deleteItem("jira:SYN-13");',
    'const item = await jira.getItem("jira:SYN-13");',
    "if (!item.gone) item.points = 3;",
  ].join("\n");
  const error = await typecheck(script, dts);
  assert.deepEqual(
    error?.message
      .split("\n")
      .slice(1)
      .map((line) => line.replace(/:.*\(/, " (")),
    ["line 2 (TS2345)", "line 3 (TS2339)", "line 5 (TS2540)"],
  );
});

test("lines count as tsc counts them, a U+2028 in a string included", async () => {
  const separator = String.fromCharCode(0x2028);
  const script = `const s = "a${separator}b";\nconst n: number = s;\nconst m: number = "x";`;
  const error = await typecheck(script, dts);
  assert.deepEqual(error?.message.split("\n").slice(1), [
    "line 3:7: Type 'string' is not assignable to type 'number'. (TS2322)",
    "line 4:7: Type 'string' is not assignable to type 'number'. (TS2322)",
  ]);
});

test("a script can't make the typecheck read other files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oriel-typecheck-test-"));
  try {
    // Were it read, LEAKED would be declared and its own error shown.
    await writeFile(
      join(dir, "other.ts"),
      "declare const LEAKED: number;\nconst broken: string = 1;\n",
    );
    const script = [
      `/// <reference path="${join(dir, "other.ts")}" />`,
      '/// <reference types="node" />',
      `const other = await import("${join(dir, "other.ts")}");`,
      "LEAKED;",
      "process.env;",
      "Deno.env;",
    ].join("\n");
    const codes = async (script: string) => {
      const error = await typecheck(script, dts);
      const lines = error?.message.split("\n").slice(1) ?? [];
      return lines.map((line) => line.replace(/:\d+: .*\((TS\d+)\)$/, " $1"));
    };
    assert.deepEqual(await codes(script), [
      "line 3 TS2307",
      "line 4 TS2304",
      "line 5 TS2591",
      "line 6 TS2304",
    ]);
    // Closing the function early to put an import at the top level never
    // reaches tsc: the compile step refuses it first.
    const breakout = [
      "}",
      `import "${join(dir, "other.ts")}";`,
      "LEAKED;",
      "async function again() {",
    ].join("\n");
    assert.match(
      (await typecheck(breakout, dts))?.message ?? "",
      /^The script doesn't compile as the body of an async function/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an aborted typecheck rejects", async () => {
  await assert.rejects(typecheck("return 1;", dts, { signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
});

test("a caller can own tsc's directory and learn its pid as it starts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oriel-typecheck-owned-"));
  const pids: number[] = [];
  const error = await typecheck("return 1;", dts, { dir, onSpawn: (pid) => pids.push(pid) });
  assert.equal(error, null);
  assert.equal(pids.length, 1);
  assert.ok((pids[0] ?? 0) > 0);
  // Left for its owner to remove.
  assert.deepEqual((await readdir(dir)).sort(), ["region.d.ts", "script.ts", "tsconfig.json"]);
  await rm(dir, { recursive: true, force: true });
});

test("tsc's plain output parses, chained messages and file-less errors included", () => {
  const output = [
    "script.ts(4,9): error TS2322: Type '{ a: string; }' is not assignable to type 'Item'.",
    "  Property 'id' is missing in type '{ a: string; }'.",
    "error TS5023: Unknown compiler option 'nope'.",
    `script.ts(2,1): error TS2304: Cannot find name 'x'. "region.d.ts(9,9): error TS1: y"`,
    "",
  ].join("\n");
  assert.deepEqual(parseOutput(output), [
    {
      file: "script.ts",
      line: 4,
      column: 9,
      code: 2322,
      text: "Type '{ a: string; }' is not assignable to type 'Item'.\nProperty 'id' is missing in type '{ a: string; }'.",
    },
    { file: null, line: 0, column: 0, code: 5023, text: "Unknown compiler option 'nope'." },
    {
      file: "script.ts",
      line: 2,
      column: 1,
      code: 2304,
      text: `Cannot find name 'x'. "region.d.ts(9,9): error TS1: y"`,
    },
  ]);
});
