// Google Sheets through packages/sheets-mcp (decision 0059, OA-279), end to
// end through the routes: the person's agent is a fake that lists the
// server as a local one, and its processes call a fake of its tools over
// one spreadsheet. Turned on, its connection is kept, with no secret, and
// waits for its mapping; set, the mapping lasts, a sync reads through the
// read tools, a change set's edit replays through the write tools; and with
// the server gone, Sheets is off, not back on Google's own sign-in.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { FoundServer, ToolCall } from "@oriel/core";
import { rowKey, sheetsMcpMain, sheetsServer } from "@oriel/sheets";
import { fakeId, fakePicks, fakeRows, fakeServer } from "@oriel/sheets/fake";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { fakeAgent } from "./servers/testing.ts";
import { json, testApp } from "./testing.ts";

const { reads, writes } = sheetsServer;

const sheets = (): FoundServer => ({
  name: "sheets",
  status: "connected",
  reports: "sheets-mcp",
  url: null,
  command: `node ${sheetsMcpMain}`,
  tools: [...reads, ...writes],
  local: { command: "node", args: [sheetsMcpMain] },
});

const bl2 = `sheets:${rowKey(fakeId, 0, "BL-2")}`;

async function world(t: TestContext, db?: string) {
  const server = fakeServer(fakeRows());
  const made: { tools: readonly string[]; call: ToolCall }[] = [];
  let found: FoundServer[] = [sheets()];
  const agent = fakeAgent(() => found);
  const it = await testApp(t, {
    connect: {},
    ...(db ? { db } : {}),
    discover: agent.discover,
    plan: () => [{ run: "edit" }],
    scripts: {
      edit: async () => ({ value: null, writes: [["sheets.setField", [bl2, "status", "Done"]]] }),
    },
    callServer: async (_server, allowed) => ({
      agent: { id: "codex", name: "Codex", kind: "codex" },
      calls: {
        call: async (call) => {
          if (!allowed.includes(call.tool)) throw new Error(`${call.tool} isn't allowed`);
          made.push({ tools: allowed, call });
          return writes.includes(call.tool) ? server.write(call) : server.read(call);
        },
        spent: () => ({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          turns: 0,
        }),
        close: () => {},
      },
    }),
  });
  await it.app.settled();
  const turnOn = async () => {
    await it.post("/api/servers/look");
    const on = await it.post("/api/actions/source.on", { kind: "sheets", server: "sheets" });
    assert.equal(on.status, 200);
    await it.app.settled();
  };
  const lose = async () => {
    found = [];
    await it.post("/api/servers/look");
    await it.app.settled();
  };
  return { ...it, server, made, turnOn, lose };
}

test("Sheets on through sheets-mcp keeps its connection with no secret, waiting for a mapping, then syncs through its read tools", async (t) => {
  const it = await world(t);
  await it.turnOn();
  const waiting = await it.connection("sheets");
  assert.ok(waiting);
  assert.equal(waiting.items, 0);
  assert.equal(it.made.length, 0, "nothing to read before a mapping");
  const set = await it.post(`/api/connections/${waiting.id}/options`, { options: fakePicks });
  assert.equal(set.status, 200);
  await it.app.settled();
  const synced = await it.connection("sheets");
  assert.equal(synced?.id, waiting.id, "the same connection, kept");
  assert.equal(synced?.about, "1 spreadsheet, through sheets-mcp");
  assert.equal(synced?.items, 4, "three rows and the spreadsheet");
  assert.ok(it.made.length > 0);
  assert.ok(
    it.made.every((each) => reads.includes(each.call.tool)),
    "sync never writes",
  );
});

test("an approved edit replays as one update_range from the write process", async (t) => {
  const it = await world(t);
  await it.turnOn();
  const waiting = await it.connection("sheets");
  await it.post(`/api/connections/${waiting?.id}/options`, { options: fakePicks });
  await it.app.settled();
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "picked", name: "Backlog", items: [bl2] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Mark BL-2 done" }),
  );
  await it.app.settled();
  const thread = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = thread.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const diff = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(approved.status, 200);
  await it.app.settled();
  const wrote = it.made.filter((each) => writes.includes(each.call.tool));
  assert.deepEqual(
    wrote.map((each) => [each.call.tool, each.call.args.range, each.tools]),
    [["update_range", "'Backlog'!C3", writes]],
  );
  assert.equal(it.server.rows[2]?.[2], "Done");
});

test("with sheets-mcp gone, Sheets is off: its kept connection isn't one of Google's own", async (t) => {
  const it = await world(t);
  await it.turnOn();
  assert.ok(await it.connection("sheets"));
  await it.lose();
  const servers = (await it.connections()).servers;
  assert.ok(!servers.kinds.some((each) => each.kind === "sheets" && each.on));
  assert.equal(await it.connection("sheets"), null, "nothing of Sheets shows");
});
