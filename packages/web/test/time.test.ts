// How the window writes a time (decision 0046): relative, past or to come,
// or absolute, as each place writes a date.
import assert from "node:assert/strict";
import { test } from "node:test";
import { relative, stamp } from "../src/time.ts";

const at = Date.parse("2026-11-03T09:00:00.000Z");
const iso = (ms: number) => new Date(at + ms).toISOString();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test("a time is how long ago it was, or how long until it comes", () => {
  assert.equal(relative(iso(-30_000), at), "just now");
  assert.equal(relative(iso(-3 * minute), at), "3 min ago");
  assert.equal(relative(iso(-5 * hour), at), "5 h ago");
  assert.equal(relative(iso(-day - hour), at), "yesterday");
  assert.equal(relative(iso(-9 * day), at), "9 days ago");
  assert.equal(relative(iso(30_000), at), "in a moment");
  assert.equal(relative(iso(2 * hour + minute), at), "in 2 h");
  assert.equal(relative(iso(day + hour), at), "tomorrow");
  assert.equal(relative(iso(4 * day), at), "in 4 days");
  // Past a month, the date; and words that aren't a time, as they are.
  assert.doesNotMatch(relative(iso(-40 * day), at), /ago/);
  assert.equal(relative("soon", at), "soon");
});

test("what has happened is never written as to come, as a clock behind the server's would", () => {
  assert.equal(stamp(iso(8 * day), "relative", at), "just now");
  assert.equal(stamp(iso(2 * hour + minute), "relative", at, undefined, true), "in 2 h");
});

test("absolute is the place's own way of writing it", () => {
  const written = (instant: string) => `on ${instant.slice(0, 10)}`;
  assert.equal(stamp(iso(-3 * minute), "absolute", at, written), "on 2026-11-03");
  assert.equal(stamp(iso(-3 * minute), "relative", at, written), "3 min ago");
});
