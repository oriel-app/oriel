// The change log and the last-seen stamp through the server: a sync the user
// asks for logs what a teammate changed in Jira, by the facets Jira declares,
// and leaving the overview moves the stamp (decision 0027).
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Actor } from "@oriel/core";
import { indexStore, lastSeen, open } from "@oriel/db";
import { refusal } from "./actions.ts";
import { json, testApp } from "./testing.ts";

const database = (t: { after(fn: () => void): void }) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-changes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  return join(top, "oriel.db");
};

test("a sync logs Jira's state and estimate as a teammate changed them", async (t) => {
  const db = database(t);
  const app = await testApp(t, { live: true, db });
  assert.ok(app.site);
  app.site.edit("SYN-45", { status: "Done", points: 5 });
  app.advance(60_000);
  assert.equal((await app.sync("jira")).status, 200);
  await app.app.close();
  const changes = indexStore(open(db)).changes(app.app.workspaceId);
  assert.deepEqual(
    changes.map((entry) => [entry.stableId, entry.facets, entry.gone]),
    [
      [
        "10045",
        {
          state: { before: "todo", after: "done" },
          declared: { estimate: { before: null, after: 5 } },
        },
        false,
      ],
    ],
  );
});

test("leaving the overview moves the last-seen stamp, which only the user does", async (t) => {
  const db = database(t);
  const app = await testApp(t, { db });
  app.advance(60_000);
  const left = json<{ seenAt: string }>(await app.post("/api/overview/leave", { seq: 0 }));
  assert.equal(left.seenAt, "2026-10-29T09:01:00.000Z");
  assert.deepEqual(app.app.telemetry().at(-1)?.data, {
    action: "overview.leave",
    by: { kind: "user" },
  });
  await app.app.close();
  assert.equal(lastSeen(open(db), app.app.workspaceId)?.at, left.seenAt);
  const agent: Actor = { kind: "agent", threadId: app.app.workspaceId };
  assert.match(refusal("overview.leave", agent) ?? "", /is the user's/);
  assert.match(refusal("overview.leave", { kind: "tool", name: "x" }) ?? "", /is the user's/);
});
