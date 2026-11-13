import assert from "node:assert/strict";
import { test } from "node:test";
import type { PanelInline, PanelProse } from "@oriel/core";
import { adfToProse } from "./adf.ts";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const text = (words: string): PanelInline => ({ kind: "text", text: words });
const said = (...children: PanelInline[]): PanelProse => ({ kind: "paragraph", children });

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
