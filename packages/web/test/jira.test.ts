import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import { initJira, jiraReplied, loadJira, updateJira, type JiraModel } from "../src/jira.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";
import type { JiraView } from "../src/view.ts";

const typed = {
  site: "oriel.atlassian.net",
  email: "pm@example.com",
  token: "pasted",
  project: "OA",
};
const connectable: JiraView = { connected: null, connectable: true };
const connected: JiraView = {
  connected: { site: "https://oriel.atlassian.net", project: "OA", items: 42, syncedAt: null },
  connectable: false,
};
const replied = (kind: "jira" | "jiraConnected", ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag: { kind },
  ok,
  body,
});

function filled(): JiraModel {
  let model = initJira();
  for (const [field, value] of Object.entries(typed))
    [model] = updateJira(model, {
      type: "fieldChanged",
      field: field as keyof typeof typed,
      value,
    });
  return model;
}

test("Jira connects once every field is filled, with one request", () => {
  assert.deepEqual(updateJira(initJira(), { type: "connectClicked" })[1], []);
  const [pending, effects] = updateJira(filled(), { type: "connectClicked" });
  assert.deepEqual(effects, [
    { type: "http", method: "POST", url: "/api/jira", body: typed, tag: { kind: "jiraConnected" } },
  ]);
  assert.deepEqual(updateJira(pending, { type: "connectClicked" })[1], []);
  const refused = jiraReplied(pending, replied("jiraConnected", false, { error: "No." }));
  assert.deepEqual(
    [refused.model.problem, refused.model.pending, refused.model.typed, refused.synced],
    ["No.", false, typed, false],
  );
});

test("once connected, nothing typed is kept and the window loads again", () => {
  const [model, effects] = initRoot({ page: "window", grouping: "epic", addTo: null });
  assert.ok(effects.includes(loadJira));
  const [shown] = updateRoot(model, replied("jira", true, { jira: connectable }));
  assert.equal(shown.jira.view?.connectable, true);
  const [typing] = updateRoot(shown, {
    type: "jira",
    msg: { type: "fieldChanged", field: "token", value: "pasted" },
  });
  const [after, loads] = updateRoot(typing, replied("jiraConnected", true, { jira: connected }));
  assert.deepEqual(after.jira.view, connected);
  assert.equal(after.jira.typed.token, "");
  assert.deepEqual(
    loads.map((e) => e.type),
    ["loadWindow"],
  );
});
