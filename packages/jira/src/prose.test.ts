// Jira's rich text as the panel's typed blocks (OA-93): structure kept,
// links only to http(s), and what has no block read as text.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PanelInline, PanelProse } from "@oriel/core";
import { adfToProse, plainDocument, textToAdf } from "./adf.ts";
import { richDescription } from "./memory-site.ts";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const text = (words: string): PanelInline => ({ kind: "text", text: words });
const said = (...children: PanelInline[]): PanelProse => ({ kind: "paragraph", children });

test("a description keeps its heading, lists, code, marks, links and mentions", () => {
  assert.deepEqual(adfToProse(richDescription), [
    said(
      text("Same as the app, for browsers that support it. "),
      { kind: "strong", children: [text("Hide the button")] },
      text(" otherwise."),
    ),
    { kind: "heading", level: 2, children: [text("Acceptance")] },
    {
      kind: "list",
      ordered: false,
      start: 1,
      tight: true,
      items: [
        [said(text("Shows only where "), { kind: "code", text: "canMakePayment()" })],
        [said(text("Falls back to the card form, "), { kind: "em", children: [text("never")] })],
        [
          said(text("Matches the "), {
            kind: "link",
            href: "https://design.example.com/wallet",
            children: [text("app's flow")],
          }),
        ],
      ],
    },
    {
      kind: "list",
      ordered: true,
      start: 1,
      tight: true,
      items: [[said(text("Ship to 10% of browsers"))], [said(text("Then everyone"))]],
    },
    {
      kind: "code",
      text: "if (await wallet.canMakePayment()) show(button);\nelse hide(button);",
    },
    // A panel is its contents; a table, its rows as text.
    said(text("Apple Pay needs the domain file first.")),
    said(text("Browser | Wallet")),
    said(text("Safari | Apple Pay")),
    // A link anywhere but http(s) is its words.
    said(
      { kind: "mention", text: "@Esme Whitlock" },
      text(" to check "),
      text("this"),
      text(" before the review."),
    ),
  ]);
});

test("no link survives but to http(s): scripts, data, files and relative paths are words", () => {
  const linked = (href: string) => adfToProse(doc(p(t("go", [{ type: "link", attrs: { href } }]))));
  for (const href of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "/relative",
    "vbscript:x",
  ])
    assert.deepEqual(linked(href), [said(text("go"))], href);
  const cards = adfToProse(
    doc(p({ type: "inlineCard", attrs: { url: "javascript:alert(1)" } }), {
      type: "blockCard",
      attrs: { url: "HTTPS://Example.com/a" },
    }),
  );
  assert.deepEqual(cards, [
    said(text("javascript:alert(1)")),
    said({
      kind: "link",
      href: "https://example.com/a",
      children: [text("HTTPS://Example.com/a")],
    }),
  ]);
});

test("text is content: markup-looking words stay words", () => {
  const words = "<img src=x onerror=alert(1)> **not bold** [x](javascript:y)";
  assert.deepEqual(adfToProse(doc(p(t(words)))), [said(text(words))]);
});

test("quotes, task lists, breaks and odd nodes read as their blocks or their text", () => {
  assert.deepEqual(
    adfToProse(
      doc(
        { type: "blockquote", content: [p(t("quoted"), { type: "hardBreak" }, t("on"))] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { state: "DONE" }, content: [t("done")] },
            { type: "taskItem", attrs: { state: "TODO" }, content: [t("not yet")] },
          ],
        },
        { type: "rule" },
        { type: "heading", attrs: { level: 99 }, content: [t("deep")] },
        { type: "mystery", content: [p(t("kept"))] },
        { type: "paragraph", content: "not a list" },
        p(),
      ),
    ),
    [
      { kind: "quote", children: [said(text("quoted"), { kind: "break" }, text("on"))] },
      {
        kind: "list",
        ordered: false,
        start: 1,
        tight: true,
        items: [[said(text("☑ "), text("done"))], [said(text("☐ "), text("not yet"))]],
      },
      { kind: "rule" },
      { kind: "heading", level: 6, children: [text("deep")] },
      said(text("kept")),
    ],
  );
});

test("a list item of more than one paragraph keeps them apart", () => {
  const item = (...content: unknown[]) => ({ type: "listItem", content });
  const [list] = adfToProse(
    doc({
      type: "bulletList",
      content: [item(p(t("Ship to 10%")), p(t("Watch the error rate"))), item(p(t("Then all")))],
    }),
  );
  assert.equal(list?.kind === "list" && list.tight, false);
  const [tight] = adfToProse(doc({ type: "bulletList", content: [item(p(t("One")))] }));
  assert.equal(tight?.kind === "list" && tight.tight, true);
});

test("lists nested past the cap read as text, so no document is too deep to show", () => {
  let nested: unknown = p(t("bottom"));
  for (let i = 0; i < 500; i++)
    nested = { type: "bulletList", content: [{ type: "listItem", content: [nested] }] };
  const prose = adfToProse(doc(nested));
  let depth = 0;
  let at: PanelProse | undefined = prose[0];
  while (at?.kind === "list") {
    depth++;
    at = at.items[0]?.[0];
  }
  assert.equal(depth, 8);
  assert.equal(at?.kind, "paragraph");
  assert.match(JSON.stringify(at), /- bottom/);
});

test("only a document with more than plain paragraphs needs its structure kept", () => {
  assert.equal(plainDocument(textToAdf("One.\nLine two.\n\nAnother paragraph.")), true);
  assert.equal(plainDocument(null), true);
  assert.equal(plainDocument(richDescription), false);
  assert.equal(plainDocument(doc(p(t("bold", [{ type: "strong" }])))), false);
  assert.equal(plainDocument(doc({ type: "bulletList", content: [] })), false);
});
