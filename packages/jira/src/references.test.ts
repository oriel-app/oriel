import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraRecognizer } from "./references.ts";

const recognize = jiraRecognizer({ projects: ["SYN", "OA"] });

test("Jira's keys in the projects it syncs are references, links to them included", () => {
  assert.deepEqual(recognize("Standup: yesterday I reproduced SYN-54."), ["jira:SYN-54"]);
  assert.deepEqual(
    recognize("See https://oriel.atlassian.net/browse/SYN-54 and (OA-7), then SYN-54 again"),
    ["jira:SYN-54", "jira:OA-7"],
  );
});

test("a word shaped like a key, or a key of a project it doesn't sync, references nothing", () => {
  for (const text of [
    "Encode it as UTF-8 and hash it with SHA-256.",
    "XSYN-5, SYN-5a, SYN-05, syn-5, SYN-, SYN_5, ABC-12",
  ])
    assert.deepEqual(recognize(text), [], text);
});

test("no projects recognize nothing, and a malformed project key is ignored", () => {
  assert.deepEqual(jiraRecognizer({ projects: [] })("SYN-54"), []);
  assert.deepEqual(jiraRecognizer({ projects: ["S.*", "SYN"] })("SXX-1 SYN-2"), ["jira:SYN-2"]);
});
