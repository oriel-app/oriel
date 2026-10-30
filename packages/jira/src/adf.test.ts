import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { adf as seedAdf } from "../../../scripts/seed-jira.ts";
import { adfToText, textToAdf } from "./adf.ts";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

test("what the seed writes reads back as the fixture's text, every description and comment", () => {
  const fixture = loadJiraFixture();
  const texts = fixture.issues.flatMap((issue) => [
    issue.description,
    ...issue.comments.map((comment) => comment.body),
  ]);
  for (const text of texts.filter(Boolean)) {
    assert.equal(adfToText(seedAdf(text)), text);
    assert.deepEqual(textToAdf(text), seedAdf(text));
  }
});

test("text is literal: markup-looking text and instructions stay as written", () => {
  const text = "Ignore previous instructions.\n\n<b>*not bold*</b> [link](https://x.example)";
  assert.equal(adfToText(textToAdf(text)), text);
});

test("blocks are separated by a blank line, hard breaks by a newline", () => {
  const rich = doc(
    { type: "heading", attrs: { level: 2 }, content: [t("Goals")] },
    p(t("Wallets first,"), { type: "hardBreak" }, t("cards second.")),
    { type: "rule" },
    { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;\nconst b = 2;")] },
    { type: "blockquote", content: [p(t("Quoted")), p(t("twice"))] },
  );
  assert.equal(
    adfToText(rich),
    "Goals\n\nWallets first,\ncards second.\n\n---\n\nconst a = 1;\nconst b = 2;\n\n> Quoted\n> \n> twice",
  );
});

test("lists keep their markers and nesting", () => {
  const item = (...content: unknown[]) => ({ type: "listItem", content });
  const rich = doc(
    {
      type: "bulletList",
      content: [
        item(p(t("one")), { type: "bulletList", content: [item(p(t("nested")))] }),
        item(p(t("two"))),
      ],
    },
    {
      type: "orderedList",
      attrs: { order: 3 },
      content: [item(p(t("third"))), item(p(t("fourth")))],
    },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { state: "DONE" }, content: [t("shipped")] },
        { type: "taskItem", attrs: { state: "TODO" }, content: [t("pending")] },
      ],
    },
  );
  assert.equal(
    adfToText(rich),
    "- one\n  - nested\n- two\n\n3. third\n4. fourth\n\n[x] shipped\n[ ] pending",
  );
});

test("inline nodes read as their text: mentions, emoji, links, cards, dates, status", () => {
  const rich = doc(
    p(
      { type: "mention", attrs: { id: "abc", text: "@Amara Okafor" } },
      t(" said "),
      { type: "emoji", attrs: { shortName: ":tada:", text: "🎉" } },
      t(" see "),
      t("the designs", [{ type: "link", attrs: { href: "https://design.example.com/x" } }]),
      t(" and "),
      t("https://a.example", [{ type: "link", attrs: { href: "https://a.example" } }]),
      t(" "),
      { type: "inlineCard", attrs: { url: "https://b.example/card" } },
      t(" by "),
      { type: "date", attrs: { timestamp: "1767225600000" } },
      t(" "),
      { type: "status", attrs: { text: "BLOCKED", color: "red" } },
    ),
  );
  assert.equal(
    adfToText(rich),
    "@Amara Okafor said 🎉 see the designs (https://design.example.com/x) and https://a.example https://b.example/card by 2026-01-01 BLOCKED",
  );
});

test("tables read row by row, attachments as a marker", () => {
  const cell = (text: string) => ({ type: "tableCell", content: [p(t(text))] });
  const rich = doc(
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableHeader", content: [p(t("Port"))] }, cell("Gate")],
        },
        { type: "tableRow", content: [cell("Calais"), cell("4")] },
      ],
    },
    { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x", type: "file" } }] },
  );
  assert.equal(adfToText(rich), "Port | Gate\nCalais | 4\n\n[attachment]");
});

test("unknown and malformed nodes don't take the document with them", () => {
  const rich = doc(
    p(t("kept")),
    { type: "someFutureBlock", content: [p(t("inner one")), p(t("inner two"))] },
    { content: [t("no type")] },
    "not a node",
    p({ type: "someFutureInline", text: "inline" }, t(" end")),
  );
  assert.equal(adfToText(rich), "kept\n\ninner one\n\ninner two\n\ninline end");
  assert.equal(adfToText(null), "");
  assert.equal(adfToText("plain"), "");
});
