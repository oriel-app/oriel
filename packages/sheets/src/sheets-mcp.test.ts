// Sheets through packages/sheets-mcp (OA-279): the parser over the server's
// recorded answers (`fixtures/sheets-mcp/`, from its fixture mode), a sync
// and a preview through it, and answers it can't read, which stop the sync
// with the index as it was.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  listed,
  type OpenVia,
  replayCalls,
  ServerUnreadable,
  serves,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { loadCalls } from "./calls.ts";
import { SheetsError } from "./google.ts";
import { openSheets } from "./open-connection.ts";
import { sheetsPreview, sheetsReview } from "./preview.ts";
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
  secret: null,
});

const refuse: ToolCaller = async () => {
  throw new Error("a read writes nothing");
};

const via = (read: ToolCaller): OpenVia => ({
  kept: false,
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

const byTitle = (records: readonly IndexRecord[], title: string) =>
  records.find((record) => record.title === title);

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

test("a sync through the recorded server lists the mapped tab's rows and the spreadsheet", async () => {
  const { records, texts } = await sync(replayCalls(loadCalls("sync.json").calls));
  const rows = records.filter((record) => record.facets.kind !== "doc");
  assert.equal(rows.length, 20);
  const doc = records.find((record) => record.facets.kind === "doc");
  assert.equal(doc?.title, "Product backlog");
  const signIn = byTitle(records, "Sign-in page remembers the last email");
  assert.equal(signIn?.facets.state, "done");
  assert.deepEqual(signIn?.facets.people, [{ role: "assignee", id: "Priya", name: "Priya" }]);
  assert.equal(signIn?.facets.estimate, 2);
  // Its last change, from the listing, stands for the spreadsheet's.
  assert.equal(signIn?.updatedAt, "2026-11-03T16:42:10.512Z");
  assert.match(texts.get(signIn?.id ?? "") ?? "", /^Key: BL-101\nTitle: Sign-in/);
  // A cell's note is under its cell, and the comments are the spreadsheet's.
  const csv = byTitle(records, "Export a report as CSV");
  assert.match(
    texts.get(csv?.id ?? "") ?? "",
    /\nNote on Title: Excel export waits for the reporting rework\.\n/,
  );
  const docText = texts.get(doc?.id ?? "") ?? "";
  assert.match(docText, /Ama, 2026-10-28T11:05:00\.000Z:\nOn: Search finds archived projects\n/);
  assert.match(docText, /Priya replied, 2026-10-28T13:40:00\.000Z:\nYes, all of them\./);
  assert.match(docText, /Jonas, 2026-10-15T09:20:00\.000Z \(resolved\):/);
});

test("a read through the recorded server gives a row's cells", async () => {
  const synced = await sync(replayCalls(loadCalls("sync.json").calls));
  const id = byTitle(synced.records, "Export a report as CSV")?.id;
  assert.ok(id);
  const opened = await openSheets(
    connection(backlogPicks),
    via(replayCalls(loadCalls("read.json").calls)),
  );
  const [read] = await opened.source.read([id as never]);
  assert.equal(read?.status, "ok");
  assert.equal(read?.status === "ok" && read.content.title, "Export a report as CSV");
});

test("a preview with nothing picked shows the person's latest spreadsheets, and a draft picks what it maps", async () => {
  const tables = await sheetsPreview(
    connection({}),
    via(replayCalls(loadCalls("preview.json").calls)),
  );
  assert.deepEqual(
    tables.map((table) => table.name),
    [
      "Product backlog › Backlog",
      "Product backlog › Sprint 42 notes",
      "Release checklist › Checklist",
    ],
  );
  assert.deepEqual(tables[0]?.rows[0]?.slice(0, 3), ["Key", "Title", "Status"]);
  const settled = sheetsReview.settle(
    {
      tabs: [{ at: `${backlog}/0`, header: 1, end: "blank", hidden: false, key: "A", title: "B" }],
    },
    tables,
    {},
  );
  assert.deepEqual(settled, {
    spreadsheets: [
      {
        id: backlog,
        tabs: [{ sheetId: 0, header: 1, end: "blank", hidden: false, key: "Key", title: "Title" }],
      },
    ],
  });
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
    assert.equal(
      opened.problem?.(error),
      "sheets-mcp answered in a way Oriel didn't expect, so Oriel kept the window as it was.",
    );
  }
  assert.throws(() => readValues({ values: "rows", truncated: false }), ServerUnreadable);
});

test("a server that isn't signed in to Google stops the sync, and says to run login", async () => {
  const read: ToolCaller = async () => ({
    content: [{ type: "text", text: "Not signed in. Run `sheets-mcp login`." }],
    isError: true,
  });
  const opened = await openSheets(connection(fakePicks), via(read));
  const error = await listed(opened.source.sync(null)).catch((thrown: unknown) => thrown);
  assert.ok(error instanceof SheetsError && error.status === 401);
  assert.equal(
    opened.problem?.(error),
    "sheets-mcp isn't signed in to Google. Run `sheets-mcp login`, then sync again.",
  );
});

test("a spreadsheet the server can't find is gone, and leaves with its rows", async () => {
  const server = fakeServer(fakeRows());
  const picks = { spreadsheets: [{ ...fakePicks.spreadsheets[0], id: "1GoneSpreadsheet00000" }] };
  const { records } = await sync(server.read, picks);
  assert.deepEqual(records, []);
  assert.deepEqual(
    server.calls.map((call) => call.tool),
    ["get_spreadsheet"],
  );
});

test("an unchanged spreadsheet costs its two reads, and isn't read again", async () => {
  const server = fakeServer(fakeRows());
  const opened = await openSheets(connection(fakePicks), via(server.read));
  let cursor: string | null = null;
  for await (const page of opened.source.sync(null)) cursor = page.cursor ?? cursor;
  server.calls.length = 0;
  for await (const page of opened.source.sync(cursor)) assert.deepEqual(page.records, []);
  assert.deepEqual(
    server.calls.map((call) => call.tool),
    ["get_spreadsheet", "list_spreadsheets"],
  );
  assert.equal(fakeId.length > 10, true);
});

test("a sync through the server skips a row hidden by hand, keeps a cell's note, and has the comments", async () => {
  const server = fakeServer(fakeRows());
  // BL-2's row, the third, is hidden; BL-3's title has a note.
  server.hiddenRows.add(2);
  server.notes.set("3,1", "Says = on purpose.");
  server.comments = [
    {
      author: "Ana",
      createdTime: "2026-11-02T09:00:00.000Z",
      content: "Is BL-2 still wanted?",
      resolved: true,
      quoted: "Export as CSV",
      replies: [{ author: "", createdTime: "2026-11-02T10:00:00.000Z", content: "Yes." }],
    },
  ];
  const { records, texts } = await sync(server.read, fakePicks);
  const rows = records.filter((record) => record.facets.kind !== "doc");
  assert.deepEqual(
    rows.map((record) => record.title),
    ["Sign-in remembers the email", "=Not a formula, as text"],
  );
  const bl3 = byTitle(records, "=Not a formula, as text");
  assert.match(texts.get(bl3?.id ?? "") ?? "", /\nNote on Title: Says = on purpose\./);
  const doc = records.find((record) => record.facets.kind === "doc");
  assert.match(
    texts.get(doc?.id ?? "") ?? "",
    /Ana, 2026-11-02T09:00:00\.000Z \(resolved\):\nOn: Export as CSV\nIs BL-2 still wanted\?\n(.|\n)*Someone replied/,
  );
  // As shown, with the grid; as entered, without.
  const reads = server.calls.filter((call) => call.tool === "read_range");
  assert.ok(reads.every((call) => call.args.includeGrid === true));
  // A mapping that reads hidden rows has BL-2.
  const hidden = {
    spreadsheets: [
      {
        ...fakePicks.spreadsheets[0],
        tabs: [{ ...fakePicks.spreadsheets[0]?.tabs[0], hidden: true }],
      },
    ],
  };
  const all = await sync(server.read, hidden);
  assert.equal(all.records.filter((record) => record.facets.kind !== "doc").length, 3);
});

test("serverGoogle gives notes, hidden rows and columns, comments, and no merges", async () => {
  const server = fakeServer(fakeRows());
  server.hiddenRows.add(1);
  server.hiddenColumns.add(4);
  // A note on a cell past its row's last value is a cell too.
  server.notes.set("3,5", "Past the row's end.");
  const google = serverGoogle(server.read);
  assert.deepEqual(await google.comments(fakeId), []);
  const info = await google.tabs(fakeId);
  assert.ok(info !== "gone");
  const tab = info.tabs[0];
  assert.ok(tab);
  const grid = await google.rows(fakeId, tab, 0, 4, true);
  assert.ok(grid !== "gone");
  assert.deepEqual(grid.merges, []);
  assert.deepEqual([...grid.hiddenRows], [1]);
  assert.deepEqual([...grid.hiddenColumns], [4]);
  assert.deepEqual(grid.rows[1]?.[1], {
    shown: "Sign-in remembers the email",
    number: null,
    note: null,
    entered: "Sign-in remembers the email",
  });
  assert.deepEqual(grid.rows[3]?.[5], {
    shown: "",
    number: null,
    note: "Past the row's end.",
    entered: null,
  });
  // FORMULA reads ask for no grid.
  assert.deepEqual(
    server.calls.filter((call) => call.tool === "read_range").map((call) => call.args.includeGrid),
    [true, undefined],
  );
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
  assert.deepEqual(sheetsServer.reads, [
    "list_spreadsheets",
    "get_spreadsheet",
    "read_range",
    "list_comments",
  ]);
  assert.deepEqual(sheetsServer.writes, ["update_range", "append_rows"]);
});
