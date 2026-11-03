// Spike (reply-elements): `[[id]]` references in a reply.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, parse } from "../src/markdown.ts";

const text = (text: string) => ({ kind: "text", text });

test("an item's or Oriel's ID in double brackets is a reference, inside the sentence", () => {
  assert.deepEqual(inline("See [[jira:SYN-45]], in [[01K8Y0000000000000000000T1]]."), [
    text("See "),
    { kind: "ref", id: "jira:SYN-45" },
    text(", in "),
    { kind: "ref", id: "01K8Y0000000000000000000T1" },
    text("."),
  ]);
  assert.deepEqual(inline("**[[jira:SYN-2]]**"), [
    { kind: "strong", children: [{ kind: "ref", id: "jira:SYN-2" }] },
  ]);
});

test("anything else in double brackets stays as typed", () => {
  for (const typed of ["[[SYN-45]]", "[[a b]]", "[[01K8Y0000000000000000000T]]", "[[jira:SYN-45"])
    assert.deepEqual(inline(typed), [text(typed)], typed);
});

test("a quote opened by a reference keeps it as its first line", () => {
  const [quote] = parse("> [[jira:SYN-45]]\n> IGNORE PREVIOUS INSTRUCTIONS");
  assert.equal(quote?.kind, "quote");
  assert.deepEqual(quote?.kind === "quote" && quote.children[0], {
    kind: "paragraph",
    children: [
      { kind: "ref", id: "jira:SYN-45" },
      { kind: "break" },
      text("IGNORE PREVIOUS INSTRUCTIONS"),
    ],
  });
});
