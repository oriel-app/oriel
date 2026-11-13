import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { cassettesDir } from "./repo.ts";

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
