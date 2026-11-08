// Sheets through packages/sheets-mcp (OA-279): the parser over the server's
// recorded answers (`fixtures/sheets-mcp/`, from its fixture mode), a sync
// and a preview through it, and answers it can't read, which stop the sync
// with the index as it was.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listed,
  type OpenVia,
  ServerUnreadable,
  serves,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { sheetsPicks } from "./mapping.ts";
import { openSheets } from "./open-connection.ts";
import { sheetsReview } from "./preview.ts";
import { fakeId, fakePicks, fakeRows, fakeServer } from "./sheets-mcp-fake.ts";
import {
  readComments,
  readValues,
  serverGoogle,
  sheetsMcpMain,
  sheetsServer,
} from "./sheets-mcp.ts";

const backlog = "1q2w3e4r5t6y7u8i9o0pBacklogFixture";
// As scripts/record-source-mcp.ts maps the shipped fixture's Backlog tab.
const backlogPicks = {
  spreadsheets: [
    {
      id: backlog,
      tabs: [
        {
          sheetId: 0,
          header: 1,
          end: "blank",
          hidden: false,
          key: "Key",
          title: "Title",
          status: "Status",
          states: { todo: ["To do"], "in-progress": ["In progress"], done: ["Done"] },
          assignee: "Owner",
          estimate: "Estimate",
        },
      ],
    },
  ],
};

const connection = (options: Record<string, unknown>): ToOpen => ({
  id: "01JSHEETSTHROUGHSERVER0000" as ToOpen["id"],
  number: 1,
  prefix: "sheets",
  identity: "",
  options,
});

const refuse: ToolCaller = async () => {
  throw new Error("a read writes nothing");
};

const via = (read: ToolCaller): OpenVia => ({
  log: () => {},
  now: () => "2026-11-07T00:00:00.000Z" as never,
  server: {
    known: sheetsServer,
    found: {
      name: "sheets",
      status: "connected",
      reports: "sheets-mcp",
      url: null,
      command: sheetsServer.at && "command" in sheetsServer.at ? sheetsServer.at.command : null,
      tools: [...sheetsServer.reads, ...sheetsServer.writes],
    },
    read,
    write: refuse,
  },
});

const sync = async (read: ToolCaller, options: Record<string, unknown> = backlogPicks) => {
  const opened = await openSheets(connection(options), via(read));
  return { opened, ...(await listed(opened.source.sync(null))) };
};

test("Oriel knows sheets-mcp by this checkout's command, and by no other", () => {
  const found = {
    name: "sheets",
    status: "connected" as const,
    reports: "sheets-mcp",
    url: null,
    command: `node ${sheetsMcpMain}`,
    tools: [...sheetsServer.reads, ...sheetsServer.writes],
  };
  assert.ok(sheetsMcpMain.endsWith("/packages/sheets-mcp/src/main.ts"));
  assert.equal(serves(sheetsServer, found), true);
  // Another program reporting its name isn't it.
  assert.equal(serves(sheetsServer, { ...found, command: "node /elsewhere/main.ts" }), false);
  assert.equal(serves(sheetsServer, { ...found, command: null }), false);
});

test("read_range's cells as the server cuts them are read on, and nowhere else", async () => {
  const server = fakeServer(fakeRows());
  const cut: ToolCaller = async (call) => {
    const answer = await server.read(call);
    if (call.tool !== "read_range" || !String(call.args.range).startsWith("'Backlog'!A1:"))
      return answer;
    const body = answer.structuredContent as { values: string[][] };
    const cutAt = { ...body, values: body.values.slice(0, 2), truncated: true };
    return { content: [], structuredContent: { ...cutAt, nextRange: "'Backlog'!A3:F1000" } };
  };
  const { records } = await sync(cut, fakePicks);
  assert.equal(records.filter((record) => record.facets.kind !== "doc").length, 3);
  assert.ok(server.calls.some((call) => call.args.range === "'Backlog'!A3:F1000"));
  // Cut with a way on that isn't the next row, it stops.
  const astray: ToolCaller = async (call) => {
    const answer = await cut(call);
    const body = answer.structuredContent as Record<string, unknown> | undefined;
    return body?.nextRange
      ? { content: [], structuredContent: { ...body, nextRange: "'Backlog'!A9:F1000" } }
      : answer;
  };
  await assert.rejects(sync(astray, fakePicks), ServerUnreadable);
});

test("an answer Oriel can't read stops the sync, naming the server, with nothing listed", async () => {
  const server = fakeServer(fakeRows());
  const broken =
    (tool: string, body: unknown): ToolCaller =>
    async (call) =>
      call.tool === tool ? { content: [], structuredContent: body } : server.read(call);
  for (const read of [
    broken("get_spreadsheet", { title: "Product backlog" }),
    broken("get_spreadsheet", { title: "x", tabs: [{ sheetId: -1, title: "Backlog" }] }),
    broken("read_range", { values: [[{ cell: 1 }]], truncated: false }),
    broken("read_range", { values: [["a"]] }),
    broken("list_spreadsheets", { files: [] }),
    // Text that isn't JSON.
    async (call: Parameters<ToolCaller>[0]) =>
      call.tool === "get_spreadsheet"
        ? { content: [{ type: "text", text: "Here are your tabs!" }] }
        : server.read(call),
  ]) {
    const opened = await openSheets(connection(fakePicks), via(read));
    const pages: unknown[] = [];
    const error = await (async () => {
      try {
        for await (const page of opened.source.sync(null)) pages.push(page);
      } catch (thrown) {
        return thrown;
      }
      return null;
    })();
    assert.ok(error instanceof ServerUnreadable, String(error));
    assert.deepEqual(pages, []);
  }
  assert.throws(() => readValues({ values: "rows", truncated: false }), ServerUnreadable);
});

test("comments are read a page at a time, at most 200, and none when the sign-in can't read them", async () => {
  const comment = (n: number) => ({
    author: "Ana",
    createdTime: "2026-11-02T09:00:00.000Z",
    content: `Comment ${n}`,
    resolved: false,
    replies: [],
  });
  const pages: ToolCaller = async (call) => {
    const at = Number(call.args.pageToken ?? 0);
    return {
      content: [],
      structuredContent: {
        comments: Array.from({ length: 100 }, (_, i) => comment(at + i)),
        nextPageToken: String(at + 100),
      },
    };
  };
  const found = await serverGoogle(pages).comments(fakeId);
  assert.equal(found.length, 200);
  assert.equal(found[199]?.text, "Comment 199");
  const unscoped: ToolCaller = async () => ({
    content: [
      {
        type: "text",
        text: "Google refused: this sign-in wasn't given the permission that takes.",
      },
    ],
    isError: true,
  });
  assert.deepEqual(await serverGoogle(unscoped).comments(fakeId), []);
});

test("a grid or comments Oriel can't read stop the sync, naming the server", async () => {
  const server = fakeServer(fakeRows());
  const changed =
    (
      tool: string,
      change: (body: Record<string, unknown>) => Record<string, unknown>,
    ): ToolCaller =>
    async (call) => {
      const answer = await server.read(call);
      return call.tool === tool
        ? {
            content: [],
            structuredContent: change(answer.structuredContent as Record<string, unknown>),
          }
        : answer;
    };
  for (const read of [
    // No grid where it was asked for.
    changed("read_range", (body) => ({ ...body, hiddenRows: undefined })),
    changed("read_range", (body) => ({ ...body, hiddenRows: [0] })),
    changed("read_range", (body) => ({ ...body, hiddenRows: ["2"] })),
    changed("read_range", (body) => ({ ...body, hiddenColumns: ["a1"] })),
    changed("read_range", (body) => ({ ...body, notes: [{ cell: "Z", note: "x" }] })),
    changed("read_range", (body) => ({ ...body, notes: [{ cell: "B2", note: 3 }] })),
    // A note outside the rows it read.
    changed("read_range", (body) => ({ ...body, notes: [{ cell: "B5000", note: "x" }] })),
    changed("list_comments", () => ({ comments: "none" })),
    changed("list_comments", () => ({ comments: [{ author: "A", content: "x" }] })),
    changed("list_comments", () => ({
      comments: [{ author: "A", createdTime: "t", content: "x", resolved: "no", replies: [] }],
    })),
    changed("list_comments", () => ({
      comments: [
        { author: "A", createdTime: "t", content: "x", resolved: false, replies: [{ author: 1 }] },
      ],
    })),
  ]) {
    const opened = await openSheets(connection(fakePicks), via(read));
    const error = await listed(opened.source.sync(null)).catch((thrown: unknown) => thrown);
    assert.ok(error instanceof ServerUnreadable, String(error));
  }
  assert.throws(() => readValues({ values: [], truncated: false }, true), ServerUnreadable);
  assert.throws(() => readComments({ comments: [{}] }), ServerUnreadable);
});

test("Sheets through its server may call its read tools, and no write tool among them", () => {
  for (const write of ["update_range", "append_rows"]) {
    assert.ok(sheetsServer.writes.includes(write), write);
    assert.ok(!sheetsServer.reads.includes(write), write);
  }
});

test("spreadsheets picked again keep how their tabs read; one picked anew reads none yet, so it waits", () => {
  const [pick] = sheetsServer.picks ?? [];
  assert.ok(pick?.picked && pick.into);
  assert.deepEqual(pick.picked(backlogPicks), [backlog]);
  const both = pick.into(backlogPicks, [backlog, "1RaidLogFixture000000000", backlog]);
  const kept = sheetsPicks(backlogPicks);
  assert.ok(kept.ok);
  assert.deepEqual(both, [
    ...kept.value.spreadsheets,
    { id: "1RaidLogFixture000000000", tabs: [] },
  ]);
  assert.equal(sheetsReview.waits({ spreadsheets: [{ id: backlog, tabs: [] }] }), true);
  assert.deepEqual(pick.into(backlogPicks, []), []);
});
