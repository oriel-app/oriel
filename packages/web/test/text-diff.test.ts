import assert from "node:assert/strict";
import { test } from "node:test";
import { lines, words } from "../src/text-diff.ts";

const same = (text: string) => ({ text, changed: false });
const changed = (text: string) => ({ text, changed: true });

test("only the words that differ are marked, a changed phrase as one", () => {
  assert.deepEqual(
    words(
      "Same as the app, for browsers that support it. Hide the button otherwise.",
      "Same as the app, for every browser that supports it. Show the card form otherwise.",
    ),
    {
      before: [
        same("Same as the app, for "),
        changed("browsers"),
        same(" that "),
        changed("support"),
        same(" it. "),
        changed("Hide"),
        same(" the "),
        changed("button"),
        same(" otherwise."),
      ],
      after: [
        same("Same as the app, for "),
        changed("every browser"),
        same(" that "),
        changed("supports"),
        same(" it. "),
        changed("Show"),
        same(" the "),
        changed("card form"),
        same(" otherwise."),
      ],
    },
  );
});

test("a change of space alone isn't marked", () => {
  assert.deepEqual(
    words(
      "Checkout v2: phone wallets and saved cards",
      "Checkout v2: phone wallets, saved cards and gift cards",
    ).before,
    [same("Checkout v2: phone wallets and "), changed("saved"), same(" cards")],
  );
});

test("punctuation and non-Latin words are words of their own", () => {
  assert.deepEqual(words("運航 状況 を 送る", "運航 情報 を 送る!").after, [
    same("運航 "),
    changed("情報"),
    same(" を 送る"),
    changed("!"),
  ]);
  assert.deepEqual(words("Phone wallets", "Phone wallets.").after, [
    same("Phone wallets"),
    changed("."),
  ]);
});

test("a rewrite is marked whole, not by the few words it shares", () => {
  assert.deepEqual(words("Hide the button", "Show a card form in the app"), {
    before: [changed("Hide the button")],
    after: [changed("Show a card form in the app")],
  });
  assert.deepEqual(words("2", "5"), { before: [changed("2")], after: [changed("5")] });
});

test("a long text keeps its unchanged lines apart from the one that changed", () => {
  const was = ["Goals:", "- wallets", "- saved cards", "", "Out of scope: splitting"].join("\n");
  const now = [
    "Goals:",
    "- wallets",
    "- saved cards and gift cards",
    "",
    "Out of scope: splitting",
  ];
  assert.deepEqual(lines(was, now.join("\n")), [
    { kind: "same", lines: ["Goals:", "- wallets"] },
    {
      kind: "change",
      before: [same("- saved cards")],
      after: [same("- saved cards "), changed("and gift cards")],
    },
    { kind: "same", lines: ["", "Out of scope: splitting"] },
  ]);
});

test("text added to an empty field, or cleared, is one change with nothing on the other side", () => {
  assert.deepEqual(lines("", "First line\nSecond"), [
    { kind: "change", before: null, after: [changed("First line\nSecond")] },
  ]);
  assert.deepEqual(lines("Gone", ""), [{ kind: "change", before: [changed("Gone")], after: null }]);
  assert.deepEqual(lines("", ""), []);
});

test("texts too long to compare word by word are still diffed, marking the middle whole", () => {
  const long = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ");
  const was = `Start. ${long(600, "a")} End.`;
  const now = `Start. ${long(600, "b")} End.`;
  const { before, after } = words(was, now);
  assert.equal(before.map((p) => p.text).join(""), was);
  assert.equal(after.map((p) => p.text).join(""), now);
});

test("line ends of either kind are the same line end", () => {
  assert.deepEqual(lines("One\r\nTwo\r\nThe third line", "One\nTwo\nThe third line, and more"), [
    { kind: "same", lines: ["One", "Two"] },
    {
      kind: "change",
      before: [same("The third line")],
      after: [same("The third line"), changed(", and more")],
    },
  ]);
});

test("a change holding a long run of space is marked in one pass", () => {
  const spaces = " ".repeat(200_000);
  const { after } = words("w1 w2 w3 A", `w1 w2 w3 C${spaces}D`);
  assert.deepEqual(after, [same("w1 w2 w3 "), changed(`C${spaces}D`)]);
});
