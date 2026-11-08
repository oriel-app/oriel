import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool, systemPrompt } from "./prompt.ts";

test("the system prompt names no source, item or region", () => {
  assert.doesNotMatch(systemPrompt, /jira:|folder:|SYN-|\$\{/);
  assert.equal(runTool("declare const x: 1;\n").description.includes("declare const x: 1;"), true);
});
