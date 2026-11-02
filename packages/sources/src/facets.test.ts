import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type SourceDeclaration, sourceKinds } from "@oriel/core";
import { sources } from "./index.ts";

test("every source declares its facets beyond the common ones, each with a label", () => {
  assert.deepEqual(
    Object.fromEntries(
      sourceKinds.map((kind) => [
        kind,
        Object.entries(sources[kind].facets).map(([key, facet]) => [key, facet.label]),
      ]),
    ),
    { jira: [["estimate", "Estimate"]], folder: [], slack: [["replies", "Replies"]] },
  );
});

test("a declared facet without its label is a type error", () => {
  const facets = {
    // @ts-expect-error The change log and the overview show a facet by its label.
    estimate: { of: () => null },
  } satisfies SourceDeclaration["facets"];
  assert.ok(facets);
});

test("the change log's code in core and the index store names no declared facet", () => {
  const files = [
    "../../core/src/change-log.ts",
    "../../core/src/sync.ts",
    "../../db/src/index-store.ts",
    "../../db/migrations/0015_change_log.sql",
  ];
  for (const file of files) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const kind of sourceKinds)
      for (const key of Object.keys(sources[kind].facets))
        assert.ok(!new RegExp(key, "i").test(code), `${file} names ${key}`);
  }
});
