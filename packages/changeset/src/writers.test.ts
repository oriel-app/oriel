// Change sets build their own writers from config; the package entry offers
// no way to pass one in (decision 0003).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Credential } from "@oriel/core";
import * as entry from "./index.ts";
import { buildWriters } from "./writers.ts";

const credential: Credential = { headers: async () => ({}) };
const jira = { site: "https://oriel.atlassian.net", credential, project: "SYN" };
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
  // Each of these takes a writer, or builds one from config a caller hands it.
  for (const name of ["changeSetsOver", "buildWriters"]) assert.ok(!(name in entry), name);
});
