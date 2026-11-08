import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankForm,
  type ConnectionsModel,
  connectionsReplied,
  formOf,
  initConnections,
  offered,
  settingOf,
  updateConnections,
} from "../src/connections.ts";
import type { Effect, Replied } from "../src/http.ts";
import type { ConnectionView, ConnectStep } from "../src/view.ts";
import { connectionView, connectors, serversView } from "../testing.ts";

const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
const post = (url: string, body: unknown, tag: Replied["tag"]): Effect => ({
  type: "http",
  method: "POST",
  url,
  body,
  tag,
});

test("once connected, nothing typed stays on the page, the token included", () => {
  const steps = connectors.jira?.connect?.steps as readonly ConnectStep[];
  let model = connectionsReplied(
    initConnections(),
    replied({ kind: "connections" }, true, {
      connections: [],
      connectable: ["jira"],
      refused: {},
      picker: false,
    }),
  ).model;
  const typed = { site: "oriel.atlassian.net", email: "pm@example.com", token: "pasted" };
  for (const [field, value] of Object.entries(typed))
    [model] = updateConnections(model, { type: "fieldChanged", kind: "jira", field, value });
  const [listing] = updateConnections(model, { type: "nextClicked", kind: "jira", steps });
  const choices = [{ value: "SYN", name: "Synthetic", count: 1, updatedAt: null }];
  const listed = connectionsReplied(
    listing,
    replied({ kind: "connectChoices", of: "jira" }, true, { choices, more: false }),
  ).model;
  const [connecting] = updateConnections(listed, { type: "connectClicked", kind: "jira", steps });
  assert.equal(formOf(connecting, "jira").typed.token, "pasted");
  const made = connectionsReplied(
    connecting,
    replied({ kind: "connected", of: "jira" }, true, { connection: connectionView() }),
  ).model;
  assert.deepEqual(formOf(made, "jira"), blankForm);
});

// OA-278, fixed in 8ba71728 (#229): a tracker connected in the first run
// counted as replaced by the stand-in it took over from, so its row vanished.
test("a tracker connected in the first run stays in its list once the stand-in steps aside", () => {
  const tracker = {
    ...connectors.jira!,
    kind: "tracker",
    connect: null,
    standIn: { for: ["jira", "linear"], offer: connectors.jira!.connect!.offer },
  };
  const model: ConnectionsModel = {
    ...initConnections(),
    view: {
      connections: [{ kind: "jira", state: "open" } as ConnectionView],
      connectable: ["folder"],
      refused: {},
      picker: false,
      standingIn: [],
      servers: serversView(),
    },
  };
  assert.ok(offered({ ...connectors, tracker }, model).some((each) => each.kind === "jira"));
});

test("Disconnect sends nothing until the person says yes", () => {
  const id = "01JBZ0000000000000000000K1";
  const model = connectionsReplied(
    initConnections(),
    replied({ kind: "connections" }, true, {
      connections: [connectionView({ id })],
      connectable: [],
      refused: {},
      picker: false,
    }),
  ).model;
  assert.deepEqual(
    updateConnections(model, { type: "disconnectAnswered", connection: id, yes: true })[1],
    [],
  );
  const [asked, none] = updateConnections(model, { type: "disconnectClicked", connection: id });
  assert.deepEqual(none, []);
  const [cancelled, kept] = updateConnections(asked, {
    type: "disconnectAnswered",
    connection: id,
    yes: false,
  });
  assert.deepEqual(kept, []);
  assert.equal(settingOf(cancelled, id).disconnect, null);
  assert.deepEqual(
    updateConnections(asked, { type: "disconnectAnswered", connection: id, yes: true })[1],
    [post(`/api/connections/${id}/disconnect`, {}, { kind: "disconnected", connection: id })],
  );
});
