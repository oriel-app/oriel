// Change sets build their own writers from config; the package entry offers
// no way to pass one in (decision 0003).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Credential } from "@oriel/core";
import { changeSets } from "./change-sets.ts";
import * as entry from "./index.ts";
import { setup, specs, t0 } from "./testing.ts";
import { buildWriters } from "./writers.ts";

const credential: Credential = { headers: async () => ({}) };
const jira = { site: "https://oriel.atlassian.net", credential, project: "SYN" };
const log = () => {};

test("a writer is built only for a source with config, and building one sends nothing", () => {
  assert.deepEqual(buildWriters({}, log), {});
  const writers = buildWriters({ jira }, log);
  assert.deepEqual(Object.keys(writers), ["jira"]);
  assert.equal(writers.jira?.kind, "jira");
});

test("config a writer can't be built from is refused when change sets are made", () => {
  for (const bad of [
    { ...jira, site: "http://oriel.atlassian.net" },
    { ...jira, site: "https://oriel.atlassian.net/browse" },
    { ...jira, project: "syn" },
  ])
    assert.throws(() => buildWriters({ jira: bad }, log), RangeError, JSON.stringify(bad.site));
});

test("the package entry builds change sets from config and has no way to pass a writer in", () => {
  assert.deepEqual(Object.keys(entry).toSorted(), [
    "ChangeSetError",
    "changeSets",
    "explainConflicts",
    "sendLeaseMs",
  ]);
});

test("without writer config, a source's change sets can't be shown or applied", async () => {
  const { db, run, changeSets: inMemory } = setup();
  const set = await inMemory.capture(run, [
    { op: "setEstimate", target: "jira:SYN-21", ref: null, args: { points: 5 } },
  ]);
  const readOnly = changeSets({
    db,
    writerConfig: {},
    specs,
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => t0,
    emit: () => {},
    log,
  });
  await assert.rejects(readOnly.diff(set.id), /jira items are read-only/);
});

test("a writer reaches its site through the config's fetch when one is given", async () => {
  const asked: string[] = [];
  const answer: typeof fetch = async (input) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ errorMessages: ["no"] }), { status: 404 });
  };
  const writers = buildWriters({ jira: { ...jira, fetch: answer } }, log);
  assert.equal(await writers.jira?.current("jira:SYN-1", ["summary"]), "gone");
  assert.deepEqual(asked, [
    "https://oriel.atlassian.net/rest/api/3/issue/SYN-1?fields=summary,description,issuetype,parent,assignee,updated",
  ]);
});
