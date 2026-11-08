import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { fixtureReader, fixtureRegion, namespaces, snapshotAfter } from "./testing.ts";
import { typecheck } from "./typecheck.ts";

const { dts } = bindingsFor(fixtureRegion("boarding-epic"), {
  reader: fixtureReader(snapshotAfter(0)),
  namespaces,
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
    const refused = await typecheck(breakout, dts);
    assert.equal(refused?.phase, "typecheck");
    assert.ok(!refused.message.includes("LEAKED"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
