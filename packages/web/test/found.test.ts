// What Oriel found in the person's agent (decision 0059, OA-275): turning a
// kind on through a server it found, or off; the overview's card dismissed;
// a kind turned off offered nowhere; and the stand-in tracker, which Oriel
// keeps itself, never synced.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import {
  connectionsReplied,
  initConnections,
  offered,
  sourcesLine,
  turnedOff,
  updateConnections,
} from "../src/connections.ts";
import type { ConnectionsView, SourceServersView } from "../src/view.ts";
import { connectionView, connectors, serversView } from "../testing.ts";

const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
const listed = (view: Partial<ConnectionsView>, servers: Partial<SourceServersView> = {}) =>
  connectionsReplied(
    initConnections(),
    replied({ kind: "connections" }, true, {
      connections: [],
      connectable: [],
      refused: {},
      picker: false,
      standingIn: [],
      servers: serversView(servers),
      ...view,
    }),
  ).model;

const found = { kind: "jira", server: "work-tracker", known: "Atlassian's", on: false };

test("turning a kind on names the server Oriel found for it, one at a time, and says why it couldn't", () => {
  const model = listed({}, { found: [found], card: { appeared: [found], gone: [] } });
  const [switching, effects] = updateConnections(model, {
    type: "kindSwitched",
    kind: "jira",
    on: true,
    server: "work-tracker",
  });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/actions/source.on",
      body: { kind: "jira", server: "work-tracker" },
      tag: { kind: "kindSwitched", of: "jira" },
    },
  ]);
  assert.equal(switching.switching, "jira");
  assert.deepEqual(
    updateConnections(switching, { type: "kindSwitched", kind: "slack", on: false })[1],
    [],
  );
  const refused = connectionsReplied(
    switching,
    replied({ kind: "kindSwitched", of: "jira" }, false, { error: "Not found now." }),
  );
  assert.deepEqual(
    [refused.model.switching, refused.model.switchProblem],
    [null, "Not found now."],
  );
  // On, what the window shows changed: it loads again.
  const done = connectionsReplied(
    switching,
    replied({ kind: "kindSwitched", of: "jira" }, true, {}),
  );
  assert.equal(done.synced, true);
  // Off names no server.
  assert.deepEqual(
    updateConnections(model, { type: "kindSwitched", kind: "slack", on: false })[1].map((e) =>
      e.type === "http" ? [e.url, e.body] : null,
    ),
    [["/api/actions/source.off", { kind: "slack" }]],
  );
});

test("the card, dismissed, goes at once and asks the server to keep it gone", () => {
  const model = listed({}, { card: { appeared: [found], gone: [] } });
  const [gone, effects] = updateConnections(model, { type: "foundDismissed" });
  assert.equal(gone.view?.servers.card, null);
  assert.deepEqual(
    effects.map((e) => (e.type === "http" ? e.url : null)),
    ["/api/servers/dismiss"],
  );
});

test("a kind turned off is offered nowhere, and the first run doesn't name it", () => {
  const model = listed(
    {},
    { kinds: [{ kind: "folder", on: false, server: null, offBy: "agent" }] },
  );
  assert.deepEqual(turnedOff(model), ["folder"]);
  assert.ok(!offered(connectors, model).some((each) => each.kind === "folder"));
  assert.ok(offered(connectors, listed({})).some((each) => each.kind === "folder"));
});

test("the stand-in tracker shows among the sources, kept in Oriel, and Sync all leaves it be", () => {
  const tracker = connectionView({ id: "t", kind: "tracker", prefix: "tracker", own: true });
  const model = listed({ connections: [tracker], standingIn: ["tracker"] });
  assert.deepEqual(sourcesLine(model), {
    count: 1,
    syncable: 0,
    syncedAt: null,
    syncing: false,
    problem: false,
  });
  const [, effects] = updateConnections(model, { type: "syncAllClicked" });
  assert.deepEqual(
    effects.map((e) => (e.type === "http" ? e.url : null)),
    ["/api/servers/look"],
  );
});

test("how often sync runs is a setting, and the list loads again once it's kept", () => {
  const model = listed({});
  const [, effects] = updateConnections(model, { type: "serversSyncPicked", every: 15 });
  assert.deepEqual(
    effects.map((e) => (e.type === "http" ? [e.url, e.body] : null)),
    [["/api/settings", { sourceSync: 15 }]],
  );
  const kept = connectionsReplied(model, replied({ kind: "serversSync" }, true, {}));
  assert.deepEqual(
    kept.effects?.map((e) => (e.type === "http" ? e.url : null)),
    ["/api/connections"],
  );
});
