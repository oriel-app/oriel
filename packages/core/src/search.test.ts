import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type ItemId } from "./ids.ts";
import { matchOf, maxSearchResults, searchFold, searchRecords, searchTerms } from "./search.ts";
import type { IndexRecord } from "./source.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));

const record = (key: string, title: string, updatedAt: Instant = t0): IndexRecord => ({
  id: `jira:${key}` as ItemId,
  stableId: key,
  title,
  location: `https://oriel.atlassian.net/browse/${key}`,
  updatedAt,
  facets: {},
  attrs: {},
});

// Texts as the index gives them, by item ID.
const textsOf = (texts: Record<string, string>) => ({
  folded: (id: ItemId) => searchFold(texts[id] ?? ""),
  written: (id: ItemId) => texts[id],
});

test("a term drops only the prefix of a connection the index holds, so text like fix:login stays as written", () => {
  const prefixes = new Set(["jira", "jira.2"]);
  assert.deepEqual(searchTerms("jira:SYN-12 jira.2:ACME-4", prefixes).terms, ["syn-12", "acme-4"]);
  assert.deepEqual(searchTerms("fix:login", prefixes), {
    terms: ["fix:login"],
    whole: "fix:login",
  });
  assert.deepEqual(searchTerms("jira:", prefixes).terms, []);
  assert.equal(searchTerms("jira:SYN-12", prefixes).whole, "syn-12");
});

test("an item matches by its key and title, or with its text too, and every term must be somewhere", () => {
  const item = record("SYN-7", "Rebooking fares");
  const text = searchFold("Only on the long crossings. Café waivers.");
  assert.equal(matchOf(item, text, ["syn-7", "fares"]), "title");
  assert.equal(matchOf(item, text, ["rebooking", "crossings"]), "text");
  assert.equal(matchOf(item, text, ["cafe"]), "text");
  assert.equal(matchOf(item, text, ["crossings", "sms"]), null);
  assert.equal(matchOf(item, text, []), null);
});

test("a text hit never outranks a title hit, however often its text repeats the term", () => {
  const later = instant(new Date(Date.UTC(2026, 9, 30)));
  const records = [record("SYN-1", "Waitlist", later), record("SYN-2", "Fare rules")];
  const found = searchRecords(
    records,
    "fare",
    10,
    textsOf({ "jira:SYN-1": "fare fare FARE ".repeat(500) + "Fare rules" }),
  );
  assert.deepEqual(
    found.map((r) => r.id),
    ["jira:SYN-2", "jira:SYN-1"],
  );
});

test("a text hit carries a capped excerpt from the item, around the term its title lacks", () => {
  const long = `${"Ferry timetable notes. ".repeat(40)}Who signs off the SMS wording, operations or support? ${"More notes. ".repeat(40)}`;
  const [hit] = searchRecords(
    [record("SYN-3", "Launch plan")],
    "launch sms",
    10,
    textsOf({ "jira:SYN-3": long }),
  );
  const excerpt = hit?.excerpt ?? "";
  assert.ok(excerpt.includes("Who signs off the SMS wording"), excerpt);
  assert.ok(excerpt.startsWith("…") && excerpt.endsWith("…"), excerpt);
  assert.ok(excerpt.replace(/^…|…$/g, "").length <= 140, `${excerpt.length}`);
  // Accents fold for the match, and the excerpt keeps the text as written.
  const [accented] = searchRecords(
    [record("SYN-4", "Menu")],
    "cafe",
    10,
    textsOf({ "jira:SYN-4": "The Café on deck 5" }),
  );
  assert.equal(accented?.excerpt, "The Café on deck 5");
});

test("results stay capped, and a title hit carries no excerpt", () => {
  const records = Array.from({ length: 80 }, (_, i) => record(`SYN-${i}`, `Story ${i}`));
  const texts = Object.fromEntries(records.map((r) => [r.id, "story"]));
  const found = searchRecords(records, "story", 1000, textsOf(texts));
  assert.equal(found.length, maxSearchResults);
  assert.ok(found.every((r) => r.excerpt === undefined));
});
