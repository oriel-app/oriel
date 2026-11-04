// Graders read a reply as the user reads it, its chips drawn from the case's
// world (decision 0032), and a reply naming something nothing has fails
// `refs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Instant, Ulid } from "@oriel/core";
import { loadFixtures } from "./fixtures.ts";
import { named } from "./testing.ts";
import { gradeRefs, resolver, shown } from "./shown.ts";
import { windowWorkstreamId } from "./world.ts";

const now = "2026-10-01T12:00:00.000Z" as Instant;
const thread = "01K8Y0000000000000000000T2" as Ulid;
// A name an edit renames a file to, which no file had before.
const fixtures = loadFixtures();
const renamed = named(fixtures, "folder:START-HERE.md");
const resolve = resolver({
  fixtures,
  edited: {},
  held: ["jira:SYN-23", "jira:SYN-999", renamed],
  oriel: {
    threads: [
      {
        id: thread,
        name: "Estimate the weather stories",
        state: "working",
        workstream: { id: "01K8Y0000000000000000000W1" as Ulid, name: "Weather disruptions" },
        activityAt: now,
        said: [],
      },
    ],
    changeSets: [],
  },
  window: { workstreams: [{ name: "Boarding" }], now },
});

test("each chip reads as the window draws it, with where it stands", () => {
  const boarding = windowWorkstreamId(now, 0);
  const seen = shown(
    `[[jira:SYN-23]] is in [[${boarding}]]; [[${thread}]] is on it. Not \`[[jira:SYN-9]]\`.`,
    resolve,
  );
  assert.equal(
    seen.text,
    "SYN-23 Pay with a phone wallet on the website is in Boarding (Open); " +
      `[Estimate the weather stories](/threads/${thread}) (Needs you) is on it. Not \`[[jira:SYN-9]]\`.`,
  );
  assert.deepEqual(gradeRefs(seen), {
    grader: "refs",
    pass: true,
    detail: "3 named by ID, unresolved: none",
  });
});

test("a look-alike ID is unknown, and fails refs; a reply naming nothing by ID isn't graded", () => {
  // One the region holds, gone from the index, is its key, for a source
  // whose items a reply calls by their key.
  assert.equal(
    shown("[[jira:SYN-999]] is gone.", resolve).text,
    "SYN-999 Not in the index is gone.",
  );
  assert.equal(shown(`[[${renamed}]] is gone.`, resolve).text, "Not in the index is gone.");
  const seen = shown("It's [[01K8Y0000000000000000000T4]].", resolve);
  assert.equal(seen.text, "It's unknown reference.");
  assert.equal(gradeRefs(seen)?.pass, false);
  assert.equal(gradeRefs(shown("Nothing named.", resolve)), null);
});
