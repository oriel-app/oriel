import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, parse } from "../src/markdown.ts";

const text = (text: string) => ({ kind: "text", text });
const para = (...children: unknown[]) => ({ kind: "paragraph", children });

test("bold and italics are formatted, with no stray asterisks", () => {
  assert.deepEqual(inline("Replies show **bold** and *italics* and _this_."), [
    text("Replies show "),
    { kind: "strong", children: [text("bold")] },
    text(" and "),
    { kind: "em", children: [text("italics")] },
    text(" and "),
    { kind: "em", children: [text("this")] },
    text("."),
  ]);
  assert.deepEqual(inline("***both***"), [
    { kind: "strong", children: [{ kind: "em", children: [text("both")] }] },
  ]);
  assert.deepEqual(inline("*a **b** c*"), [
    {
      kind: "em",
      children: [text("a "), { kind: "strong", children: [text("b")] }, text(" c")],
    },
  ]);
  assert.deepEqual(inline("**a*"), [text("*"), { kind: "em", children: [text("a")] }]);
});

test("what only looks like a mark stays as typed", () => {
  for (const plain of [
    "2 * 3 * 4",
    "snake_case_name and OA-13",
    "a ** b",
    "**Done when",
    "price: $5 * qty",
  ])
    assert.deepEqual(inline(plain), [text(plain)], plain);
  // A reply mid-stream: the closing half hasn't arrived yet.
  assert.deepEqual(inline("I'll **add"), [text("I'll **add")]);
  assert.deepEqual(inline("\\*not em\\*"), [text("*not em*")]);
});

test("code spans keep their marks, and links go only to the web", () => {
  assert.deepEqual(inline("run `pnpm **check**` now"), [
    text("run "),
    { kind: "code", text: "pnpm **check**" },
    text(" now"),
  ]);
  assert.deepEqual(inline("see [the **board**](https://oriel.atlassian.net/browse/OA-1)"), [
    text("see "),
    {
      kind: "link",
      href: "https://oriel.atlassian.net/browse/OA-1",
      children: [text("the "), { kind: "strong", children: [text("board")] }],
    },
  ]);
  for (const unsafe of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](/local)"])
    assert.deepEqual(inline(unsafe), [text(unsafe)], unsafe);
});

test("a reply's blocks: paragraphs keep their line breaks, lists, headings, quotes and code", () => {
  const reply = [
    "I've proposed 3 stories under OA-1.",
    "Nothing is created until you approve.",
    "",
    "## Stories",
    "1. Add Sync for Jira",
    "2. Render **markdown**",
    "   - in replies",
    "   - not in titles",
    "",
    "> Done when: no stray asterisks.",
    "",
    "```ts",
    "const a = 1;",
    "",
    "**not bold**",
    "```",
    "---",
  ].join("\n");
  assert.deepEqual(parse(reply), [
    para(
      text("I've proposed 3 stories under OA-1."),
      { kind: "break" },
      text("Nothing is created until you approve."),
    ),
    { kind: "heading", level: 2, children: [text("Stories")] },
    {
      kind: "list",
      ordered: true,
      start: 1,
      tight: true,
      items: [
        [para(text("Add Sync for Jira"))],
        [
          para(text("Render "), { kind: "strong", children: [text("markdown")] }),
          {
            kind: "list",
            ordered: false,
            start: 1,
            tight: true,
            items: [[para(text("in replies"))], [para(text("not in titles"))]],
          },
        ],
      ],
    },
    { kind: "quote", children: [para(text("Done when: no stray asterisks."))] },
    { kind: "code", text: "const a = 1;\n\n**not bold**" },
    { kind: "rule" },
  ]);
});

test("lists: a list right after a line, loose items, a new marker starts a new list", () => {
  assert.deepEqual(parse("Two things:\n- one\n- two"), [
    para(text("Two things:")),
    {
      kind: "list",
      ordered: false,
      start: 1,
      tight: true,
      items: [[para(text("one"))], [para(text("two"))]],
    },
  ]);
  const loose = parse("3. three\n\n4. four\n\nAfter.");
  assert.deepEqual(loose, [
    {
      kind: "list",
      ordered: true,
      start: 3,
      tight: false,
      items: [[para(text("three"))], [para(text("four"))]],
    },
    para(text("After.")),
  ]);
  assert.equal(parse("- a\n+ b").length, 2);
  // A bold line isn't a bullet, and a line of stars is a rule.
  assert.deepEqual(parse("**Why:** it matters"), [
    para({ kind: "strong", children: [text("Why:")] }, text(" it matters")),
  ]);
  assert.deepEqual(parse("* * *"), [{ kind: "rule" }]);
});

test("a table, and a code block still streaming in", () => {
  assert.deepEqual(parse("| Key | Title |\n|---|:--|\n| OA-13 | Render `md` |\n| OA-20 |"), [
    {
      kind: "table",
      head: [[text("Key")], [text("Title")]],
      rows: [[[text("OA-13")], [text("Render "), { kind: "code", text: "md" }]], [[text("OA-20")]]],
    },
  ]);
  assert.deepEqual(parse("```\nhalf"), [{ kind: "code", text: "half" }]);
  assert.deepEqual(parse("#hashtag"), [para(text("#hashtag"))]);
});

test("nesting past a few levels reads as text, so a hostile reply can't break the page", () => {
  const deep = parse(`${">".repeat(5000)} deep`);
  assert.ok(JSON.stringify(deep).includes("deep"));
  const nested = parse(`${"[".repeat(5000)}a${"](https://x)".repeat(5000)}`);
  assert.ok(JSON.stringify(nested).includes("https://x"));
});
