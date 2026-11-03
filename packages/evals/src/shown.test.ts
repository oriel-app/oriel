// Graders read a reply as the user reads it, its chips drawn from the case's
// world (decision 0032), and a reply naming something nothing has fails
// `refs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Instant, Ulid } from "@oriel/core";
import { loadJiraFixture } from "./repo.ts";
import { gradeRefs, resolver, shown } from "./shown.ts";
import { windowWorkstreamId } from "./world.ts";

const now = "2026-10-01T12:00:00.000Z" as Instant;
const thread = "01K8Y0000000000000000000T2" as Ulid;
const resolve = resolver({
  fixture: loadJiraFixture(),
  edited: 0,
  folder: null,
  slack: null,
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
    "SYN-23 Pay with a phone wallet on the website (In Progress) is in Boarding (Open); " +
      `[Estimate the weather stories](/threads/${thread}) (Working) is on it. Not \`[[jira:SYN-9]]\`.`,
  );
  assert.deepEqual(gradeRefs(seen), {
    grader: "refs",
    pass: true,
    detail: "3 named by ID, unresolved: none",
  });
});

test("a look-alike ID is unknown, and fails refs; a reply naming nothing by ID isn't graded", () => {
  const seen = shown("It's [[01K8Y0000000000000000000T4]].", resolve);
  assert.equal(seen.text, "It's unknown reference.");
  assert.equal(gradeRefs(seen)?.pass, false);
  assert.equal(gradeRefs(shown("Nothing named.", resolve)), null);
});
