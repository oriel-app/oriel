import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ConnectionsModel,
  connectionsReplied,
  initConnections,
  offered,
  settingOf,
  updateConnections,
} from "../src/connections.ts";
import type { Effect, Replied } from "../src/http.ts";
import type { ConnectionView } from "../src/view.ts";
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

test("a tracker connected in the first run stays in its list once the stand-in steps aside", () => {
  const tracker = {
    ...connectors.jira!,
    kind: "tracker",
    offer: null,
    standIn: { for: ["jira", "linear"], offer: connectors.jira!.offer! },
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
