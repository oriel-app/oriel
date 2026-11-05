import assert from "node:assert/strict";
import { test } from "node:test";
import { searchFold } from "./find.ts";
import { type Instant, instant, type ItemId } from "./ids.ts";
import {
  type Found,
  indexFold,
  matchQuery,
  maxSearchResults,
  ranked,
  searchTerms,
} from "./search.ts";
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

// What the index found for `query`: the title hits, then the text hits, and
// each text hit's text as written, by item ID.
const rankedOf = (
  query: string,
  titled: readonly IndexRecord[],
  byText: readonly IndexRecord[],
  texts: Record<string, string>,
  limit = 10,
) => {
  const foundOf = (r: IndexRecord, matched: "title" | "text") => ({
    record: r,
    matched,
    key: searchFold(r.id.slice("jira:".length)),
    title: searchFold(r.title),
  });
  const found: Found<IndexRecord>[] = [
    ...titled.map((r) => foundOf(r, "title")),
    ...byText.map((r) => foundOf(r, "text")),
  ];
  return ranked(found, searchTerms(query, new Set(["jira"])), limit, (id) => texts[id]);
};

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

test("a term with no letter or digit isn't one, and a control character splits terms", () => {
  assert.deepEqual(searchTerms('copy ✨ - * "', new Set()).terms, ["copy"]);
  assert.deepEqual(searchTerms("a\u0000b", new Set()).terms, ["a", "b"]);
});

test("every term is a quoted phrase, so nothing typed is the full-text query's syntax", () => {
  assert.equal(matchQuery([]), null);
  assert.deepEqual(matchQuery(searchTerms('salt AND "pep" -x NEAR(a title:b', new Set()).terms), {
    any: '"salt"* AND "and"* AND """pep"""* AND "-x"* AND "near(a"* AND "title:b"*',
    titled:
      '{key title} : ("salt"* AND "and"* AND """pep"""* AND "-x"* AND "near(a"* AND "title:b"*)',
  });
});

test("the index folds as search does, and sets apart each character of a script without spaces", () => {
  assert.equal(indexFold("Résumé CAFÉ"), "resume cafe");
  assert.equal(indexFold("й"), "и");
  assert.equal(indexFold("決済のリトライ"), " 決  済  の  リ  ト  ラ  イ ");
  // A voicing mark stays with its character.
  assert.equal(indexFold("ガイド"), " カ\u3099  イ  ト\u3099 ");
});

test("a text hit never outranks a title hit, however often its text repeats the term", () => {
  const later = instant(new Date(Date.UTC(2026, 9, 30)));
  const found = rankedOf(
    "fare",
    [record("SYN-2", "Fare rules")],
    [record("SYN-1", "Waitlist", later)],
    { "jira:SYN-1": "fare fare FARE ".repeat(500) + "Fare rules" },
  );
  assert.deepEqual(
    found.map((r) => r.id),
    ["jira:SYN-2", "jira:SYN-1"],
  );
});

test("a text hit carries a capped excerpt from the item, around the term its title lacks", () => {
  const long = `${"Ferry timetable notes. ".repeat(40)}Who signs off the SMS wording, operations or support? ${"More notes. ".repeat(40)}`;
  const [hit] = rankedOf("launch sms", [], [record("SYN-3", "Launch plan")], {
    "jira:SYN-3": long,
  });
  const excerpt = hit?.excerpt ?? "";
  assert.ok(excerpt.includes("Who signs off the SMS wording"), excerpt);
  assert.ok(excerpt.startsWith("…") && excerpt.endsWith("…"), excerpt);
  assert.ok(excerpt.replace(/^…|…$/g, "").length <= 140, `${excerpt.length}`);
  // A term the index reads as words finds its passage too, and a quoted one
  // is in the title, though the text says it first.
  for (const query of ["launch SMS-wording", 'launch "SMS"', '"launch" sms']) {
    const [worded] = rankedOf(query, [], [record("SYN-3", "Launch plan")], {
      "jira:SYN-3": `Launch plan. ${long}`,
    });
    assert.equal(worded?.excerpt, excerpt, query);
  }
  // A term whose first word is in the key isn't in the key.
  const [cited] = rankedOf("launch SYN-12", [], [record("SYN-3", "Launch plan")], {
    "jira:SYN-3": `Launch plan. ${"Ferry notes. ".repeat(20)}Blocked on SYN-12 until the fares land.`,
  });
  assert.ok(cited?.excerpt?.includes("Blocked on SYN-12"), cited?.excerpt);
  // Accents fold for the match, and the excerpt keeps the text as written.
  const [accented] = rankedOf("cafe", [], [record("SYN-4", "Menu")], {
    "jira:SYN-4": "The Café on deck 5",
  });
  assert.equal(accented?.excerpt, "The Café on deck 5");
});

test("results stay capped, and a title hit carries no excerpt", () => {
  const records = Array.from({ length: 80 }, (_, i) => record(`SYN-${i}`, `Story ${i}`));
  const texts = Object.fromEntries(records.map((r) => [r.id, "story"]));
  const found = rankedOf("story", records, [], texts, 1000);
  assert.equal(found.length, maxSearchResults);
  assert.ok(found.every((r) => r.excerpt === undefined));
});
