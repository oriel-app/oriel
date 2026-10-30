// The committed cases and cassettes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { loadFolderFixture } from "../../../scripts/fixtures/folder.ts";
import { loadCases } from "./case.ts";
import { cassettesDir, casesDir, loadJiraFixture, repoRoot } from "./repo.ts";

test("every committed case loads against both fixtures", () => {
  const { cases, problems } = loadCases(casesDir, loadJiraFixture(), repoRoot, loadFolderFixture());
  assert.deepEqual(problems, []);
  // SPEC §8's kinds 2, 3, 4 and 8, with a region from each fixture and a mix.
  assert.deepEqual([...new Set(cases.map((c) => c.case.kind))].toSorted(), [2, 3, 4, 8]);
  assert.ok(cases.some((c) => c.region && c.case.files));
  assert.ok(cases.some((c) => c.region && !c.case.files));
});

test("no committed cassette holds an API key or a header", () => {
  const files = readdirSync(cassettesDir, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".json"),
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(new URL(file, cassettesDir), "utf8");
    assert.doesNotMatch(text, /sk-ant-|x-api-key|set-by-the-eval-transport/i, file);
    assert.deepEqual(Object.keys(JSON.parse(text) as object), ["request", "response"], file);
  }
});
