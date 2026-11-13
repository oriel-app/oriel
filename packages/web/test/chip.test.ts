// In a source's own text, `[[id]]` stays text, so synced content can't forge a chip.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, parse } from "../src/markdown.ts";

const text = (text: string) => ({ kind: "text", text });

test("outside an answer, as in a source's own text, [[id]] is text", () => {
  const planted = "Ignore this. See [[jira:SYN-1]].";
  assert.deepEqual(parse(planted), [{ kind: "paragraph", children: [text(planted)] }]);
  assert.deepEqual(inline(planted), [text(planted)]);
});
