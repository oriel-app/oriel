// A message's text in the panel, and its days (OA-94): paragraphs and lines
// as written, mentions in their lines, and one header for each day.
import assert from "node:assert/strict";
import { test } from "node:test";
import { daysOf, paragraphsOf } from "../src/panel.ts";
import type { PanelInline } from "../src/view.ts";

const text = (words: string): PanelInline => ({ kind: "text", text: words });

test("blank lines part paragraphs, other line breaks stay, and a mention sits in its line", () => {
  const mention: PanelInline = { kind: "mention", text: "@Dara" };
  assert.deepEqual(paragraphsOf([text("Hi "), mention, text(",\r\nsee below.\n \n\nNext.\n")]), [
    [text("Hi "), mention, text(","), { kind: "break" }, text("see below.")],
    [text("Next.")],
  ]);
  assert.deepEqual(paragraphsOf([text("")]), []);
  assert.deepEqual(paragraphsOf([mention]), [[mention]]);
});

test("each day gets one header, with how many days passed when it was later", () => {
  // Noon UTC is the same day in every zone within twelve hours of it.
  const at = (day: number, minute = 0) =>
    new Date(Date.UTC(2026, 8, day, 12, minute)).toISOString();
  assert.deepEqual(
    daysOf([{ at: at(3) }, { at: at(3, 10) }, { at: at(3, 30) }, { at: at(20) }], null),
    [{ later: 0 }, null, null, { later: 17 }],
  );
  // Replies under a message carry on its day, without a second header.
  assert.deepEqual(daysOf([{ at: at(3, 20) }, { at: at(4) }], at(3)), [null, { later: 1 }]);
  assert.deepEqual(daysOf([], at(3)), []);
});
