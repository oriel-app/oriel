import assert from "node:assert/strict";
import { test } from "node:test";
import * as entry from "./index.ts";
import { buildWriters } from "./writers.ts";

// A fixture's in-memory site, which building a writer never reaches.
const memory: typeof fetch = async () => {
  throw new Error("building a writer sends nothing");
};
const jira = { site: "https://oriel.atlassian.net", memory, project: "SYN" };
const log = () => {};
const jiraConfig = (writes: object) => [{ prefix: "jira", kind: "jira", writes }];

test("config a writer can't be built from is refused when change sets are made", () => {
  for (const bad of [
    { ...jira, site: "http://oriel.atlassian.net" },
    { ...jira, site: "https://oriel.atlassian.net/browse" },
    { ...jira, project: "syn" },
  ])
    assert.throws(() => buildWriters(jiraConfig(bad), log), RangeError, JSON.stringify(bad.site));
});

test("the package entry builds change sets from config and has no way to pass a writer in", () => {
  assert.equal(typeof entry.changeSets, "function");
  for (const name of ["changeSetsOver", "buildWriters"]) assert.ok(!(name in entry), name);
});
