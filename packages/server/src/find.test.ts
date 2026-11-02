import assert from "node:assert/strict";
import { test } from "node:test";
import { type Findable, find, words } from "./find.ts";

const thread = (target: string, at: string, name: string, chat = ""): Findable<string> => ({
  target,
  at,
  fields: [
    { in: "name", text: name },
    { in: "chat", text: chat },
  ],
});
const changeSet = (target: string, at: string, wrote: string): Findable<string> => ({
  target,
  at,
  fields: [{ in: "change-set", text: wrote }],
});

const all = [
  thread("plan", "2026-10-03", "Plan the search epic", "What goes in the first slice?"),
  thread("slack", "2026-10-01", "Try posting to Slack", "Post a test message to #oriel-team"),
  changeSet("post", "2026-10-02", "Slack: Post in #oriel-team as Amara. Test post from Oriel"),
  thread("old", "2026-09-01", "Older thread", "nothing about posts"),
];

test("a query is its words, folded, without punctuation or repeats", () => {
  assert.deepEqual(words("  Café, café!  #oriel-team "), ["cafe", "oriel", "team"]);
  assert.deepEqual(words("…"), []);
});

test("every word must start a word somewhere in what is found", () => {
  assert.deepEqual(
    find(all, "test post", 10).map((m) => m.target),
    ["post", "slack"],
  );
  assert.deepEqual(find(all, "ost", 10), []);
});

test("what a change set wrote ranks over a name, a name over what was said, then the latest", () => {
  const found = find(all, "slack", 10);
  assert.deepEqual(
    found.map((m) => [m.target, m.matched]),
    [
      ["post", "change-set"],
      ["slack", "name"],
    ],
  );
  assert.deepEqual(
    find(all, "oriel team", 10).map((m) => [m.target, m.matched]),
    [
      ["post", "change-set"],
      ["slack", "chat"],
    ],
  );
  assert.deepEqual(
    find(all, "thread", 10).map((m) => m.target),
    ["old"],
  );
});

test("a question in a sentence finds what matches most of its words", () => {
  const found = find(all, "where did I approve the Slack test post?", 10);
  assert.deepEqual(
    found.map((m) => m.target),
    ["post"],
  );
});

test("the excerpt is the words around the match, on one line, cut where it was cut", () => {
  const long = changeSet(
    "long",
    "2026-10-04",
    `${"word ".repeat(30)}the needle\nis here ${"more ".repeat(40)}`,
  );
  const [match] = find([long], "needle", 1);
  assert.ok(match);
  assert.ok(match.excerpt.startsWith("…"), match.excerpt);
  assert.ok(match.excerpt.endsWith("…"), match.excerpt);
  assert.match(match.excerpt, /the needle is here/);
  assert.ok(match.excerpt.length <= 145, `${match.excerpt.length}`);
});

test("an accented word matches its plain spelling, and points at it as written", () => {
  const [match] = find([thread("cafe", "2026-10-01", "Le café du coin")], "cafe", 1);
  assert.equal(match?.excerpt, "Le café du coin");
});

test("an empty query, or a limit of none, finds nothing", () => {
  assert.deepEqual(find(all, "  ", 10), []);
  assert.deepEqual(find(all, "slack", 0), []);
});
