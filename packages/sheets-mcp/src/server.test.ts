import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedAccess, notSignedIn } from "./access.ts";
import type { Fixture } from "./fixture.ts";
import { codes, handshake, modern, mcpServer } from "./server.ts";
import { standIn, standInToken } from "./stand-in.ts";
import {
  answerOf,
  backlogId,
  called,
  callTool,
  overStandIn,
  refused,
  request,
  smallFixture,
} from "./testing.ts";
import { cellCap, tools } from "./tools.ts";

const clientInfo = { name: "test-client", version: "1.0.0" };
const modernMeta = { _meta: { "io.modelcontextprotocol/protocolVersion": modern } };

test("initialize echoes 2025-06-18 and 2026-07-28, and offers 2025-06-18 for any other", async () => {
  for (const [asked, agreed] of [
    [handshake, handshake],
    [modern, modern],
    ["2025-11-25", handshake],
    ["1999-01-01", handshake],
  ]) {
    const { server } = overStandIn();
    const answer = await answerOf(
      server,
      request("initialize", { protocolVersion: asked, capabilities: {}, clientInfo }),
    );
    assert.deepEqual(answer, {
      jsonrpc: "2.0",
      id: answer.id,
      result: {
        protocolVersion: agreed,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sheets-mcp", title: "Google Sheets", version: "0.1.0" },
      },
    });
    assert.equal(
      await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
      null,
    );
  }
});

test("a 2025-06-18 client, as Codex opens: initialize, then the tools, with no resultType", async () => {
  const { server } = overStandIn();
  await answerOf(server, request("initialize", { protocolVersion: handshake, capabilities: {} }));
  const listed = await answerOf(server, request("tools/list"));
  assert.ok("result" in listed);
  assert.equal("resultType" in listed.result, false);
  assert.deepEqual(
    (listed.result.tools as { name: string }[]).map((t) => t.name),
    ["list_spreadsheets", "get_spreadsheet", "read_range", "update_range", "append_rows"],
  );
  assert.deepEqual(await answerOf(server, { jsonrpc: "2.0", id: "p", method: "ping" }), {
    jsonrpc: "2.0",
    id: "p",
    result: {},
  });
});

test("a 2026-07-28 client, as Claude Code opens: server/discover, then each request with its revision", async () => {
  const { server } = overStandIn();
  const discovered = await answerOf(server, {
    jsonrpc: "2.0",
    id: "server-discover-probe-1",
    method: "server/discover",
    params: modernMeta,
  });
  assert.deepEqual(discovered, {
    jsonrpc: "2.0",
    id: "server-discover-probe-1",
    result: {
      resultType: "complete",
      supportedVersions: [modern, handshake],
      capabilities: { tools: { listChanged: false } },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "sheets-mcp",
          title: "Google Sheets",
          version: "0.1.0",
        },
      },
    },
  });
  const listed = await answerOf(server, request("tools/list", modernMeta));
  assert.ok("result" in listed);
  assert.equal(listed.result.resultType, "complete");
  const call = await answerOf(
    server,
    request("tools/call", { name: "list_spreadsheets", arguments: {}, ...modernMeta }),
  );
  assert.ok("result" in call);
  assert.equal(call.result.resultType, "complete");
});

test("every tool has a title, both schemas, and says whether it only reads", async () => {
  const { server } = overStandIn();
  const listed = await answerOf(server, request("tools/list"));
  assert.ok("result" in listed);
  const byName = new Map(
    (listed.result.tools as { name: string; [k: string]: unknown }[]).map((t) => [t.name, t]),
  );
  for (const tool of tools) {
    const shown = byName.get(tool.name);
    assert.ok(shown);
    assert.equal(typeof shown.title, "string");
    assert.equal((shown.inputSchema as { type: string }).type, "object");
    assert.equal((shown.outputSchema as { type: string }).type, "object");
  }
  const hints = Object.fromEntries(
    [...byName].map(([name, t]) => [name, t.annotations as Record<string, unknown>]),
  );
  for (const name of ["list_spreadsheets", "get_spreadsheet", "read_range"]) {
    assert.equal(hints[name]?.readOnlyHint, true, name);
    assert.equal(hints[name]?.destructiveHint, undefined, name);
  }
  assert.deepEqual(
    [hints.update_range?.readOnlyHint, hints.update_range?.destructiveHint],
    [false, true],
  );
  assert.deepEqual(
    [hints.append_rows?.readOnlyHint, hints.append_rows?.destructiveHint],
    [false, false],
  );
});

test("a wrong request is a JSON-RPC error; a client's answers and notifications get none", async () => {
  const { server } = overStandIn();
  const error = async (message: unknown) => {
    const answer = await answerOf(server, message);
    assert.ok("error" in answer, JSON.stringify(answer));
    return answer.error.code;
  };
  assert.equal(await error({ id: 1, method: "ping" }), codes.invalidRequest);
  assert.equal(await error([request("ping")]), codes.invalidRequest);
  assert.equal(await error({ jsonrpc: "2.0", id: 1 }), codes.invalidRequest);
  assert.equal(await error({ jsonrpc: "2.0", id: null, method: "ping" }), codes.invalidRequest);
  assert.equal(await error(request("resources/list")), codes.notFound);
  assert.equal(
    await error(request("tools/call", { name: "delete_everything" })),
    codes.invalidParams,
  );
  assert.equal(
    await error(request("tools/call", { name: "read_range", arguments: ["x"] })),
    codes.invalidParams,
  );
  assert.equal(
    await error({ jsonrpc: "2.0", id: 9, method: "ping", params: 3 }),
    codes.invalidParams,
  );
  assert.equal(await server.handle({ jsonrpc: "2.0", id: 4, result: {} }), null);
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/cancelled" }), null);
});

// What a structured result must be, by the tool's own output schema: the
// part of JSON Schema the tools use.
function conforms(value: unknown, schema: Record<string, unknown>, at = "$"): void {
  const types = [schema.type].flat();
  const kind =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : Number.isInteger(value)
          ? "integer"
          : typeof value;
  assert.ok(
    types.includes(kind) || (kind === "integer" && types.includes("number")),
    `${at}: ${kind}`,
  );
  if (kind === "array")
    for (const [i, each] of (value as unknown[]).entries())
      conforms(each, schema.items as Record<string, unknown>, `${at}[${i}]`);
  if (kind === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    for (const name of (schema.required as string[]) ?? [])
      assert.ok(name in (value as object), `${at}.${name} is required`);
    for (const [name, each] of Object.entries(value as object)) {
      assert.ok(properties[name], `${at}.${name} isn't in the schema`);
      conforms(each, properties[name], `${at}.${name}`);
    }
  }
}

async function checked(
  server: ReturnType<typeof overStandIn>["server"],
  name: string,
  args: Record<string, unknown>,
) {
  const result = await called(server, name, args);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool);
  conforms(result, tool.outputSchema);
  return result;
}

test("list_spreadsheets lists newest first, with links, by name, a page at a time", async () => {
  const fixture: Fixture = {
    spreadsheets: Array.from({ length: 5 }, (_, i) => ({
      id: `sheet${i}`,
      name: i % 2 ? `Plan ${i}` : `It's budget ${i}`,
      modifiedTime: `2026-10-0${i + 1}T00:00:00.000Z`,
      tabs: [{ sheetId: 0, title: "Sheet1", rows: [] }],
    })),
  };
  const { server, google } = overStandIn(fixture);
  const first = await checked(server, "list_spreadsheets", { pageSize: 2 });
  assert.deepEqual(first.spreadsheets, [
    {
      id: "sheet4",
      name: "It's budget 4",
      modifiedTime: "2026-10-05T00:00:00.000Z",
      url: "https://docs.google.com/spreadsheets/d/sheet4/edit",
    },
    {
      id: "sheet3",
      name: "Plan 3",
      modifiedTime: "2026-10-04T00:00:00.000Z",
      url: "https://docs.google.com/spreadsheets/d/sheet3/edit",
    },
  ]);
  const ids: string[] = [];
  let pageToken = first.nextPageToken as string | undefined;
  while (pageToken) {
    const page = await checked(server, "list_spreadsheets", { pageSize: 2, pageToken });
    ids.push(...(page.spreadsheets as { id: string }[]).map((s) => s.id));
    pageToken = page.nextPageToken as string | undefined;
  }
  assert.deepEqual(ids, ["sheet2", "sheet1", "sheet0"]);

  // A quote in the name is escaped as Drive's search terms ask.
  const named = await checked(server, "list_spreadsheets", { query: "it's BUDGET" });
  assert.deepEqual(
    (named.spreadsheets as { id: string }[]).map((s) => s.id),
    ["sheet4", "sheet2", "sheet0"],
  );
  const q = new URL(google.calls.at(-1)?.url ?? "").searchParams.get("q");
  assert.equal(
    q,
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name contains 'it\\'s BUDGET'",
  );
  assert.equal(new URL(google.calls.at(-1)?.url ?? "").searchParams.get("pageSize"), "25");

  assert.match(await refused(server, "list_spreadsheets", { pageSize: 500 }), /pageSize/);
  assert.match(await refused(server, "list_spreadsheets", { pageToken: "nope" }), /Google refused/);
});

test("get_spreadsheet gives the title, each tab's size, and a frozen header row", async () => {
  const { server, google } = overStandIn();
  const got = await checked(server, "get_spreadsheet", { spreadsheetId: backlogId });
  assert.deepEqual(got, {
    id: backlogId,
    title: "Team backlog",
    url: `https://docs.google.com/spreadsheets/d/${backlogId}/edit`,
    tabs: [
      {
        sheetId: 0,
        title: "Backlog",
        index: 0,
        rowCount: 1000,
        columnCount: 26,
        frozenRowCount: 1,
        header: ["Key", "Title", "Status"],
      },
      { sheetId: 77, title: "Q3 plan", index: 1, rowCount: 10, columnCount: 4, frozenRowCount: 0 },
    ],
  });
  // The headers in one more call, for the tabs that freeze rows.
  assert.equal(google.calls.length, 2);
  assert.deepEqual(new URL(google.calls[1]?.url ?? "").searchParams.getAll("ranges"), [
    "Backlog!A1:Z1",
  ]);
  assert.match(
    await refused(server, "get_spreadsheet", { spreadsheetId: "nothere" }),
    /no spreadsheet with that ID/,
  );
  assert.match(
    await refused(server, "get_spreadsheet", { spreadsheetId: "../x" }),
    /letters, digits/,
  );
  assert.match(await refused(server, "get_spreadsheet", {}), /`spreadsheetId` must be given/);
});

test("read_range gives rows of text, and the range Google read", async () => {
  const { server } = overStandIn();
  assert.deepEqual(
    await checked(server, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1:C" }),
    {
      range: "Backlog!A1:C1000",
      values: [
        ["Key", "Title", "Status"],
        ["T-1", "First", "Done"],
        ["T-2", "Second", "To do"],
        ["T-3", "Third"],
      ],
      truncated: false,
    },
  );
  assert.deepEqual(
    await checked(server, "read_range", { spreadsheetId: backlogId, range: "'Q3 plan'" }),
    { range: "'Q3 plan'!A1:D10", values: [["Goal"], ["Ship it"]], truncated: false },
  );
  assert.deepEqual(
    await checked(server, "read_range", { spreadsheetId: backlogId, range: "Backlog!F1:G9" }),
    { range: "Backlog!F1:G9", values: [], truncated: false },
  );
  assert.match(
    await refused(server, "read_range", { spreadsheetId: backlogId, range: "Nowhere!A1" }),
    /^Google refused the request: Unable to parse range: Nowhere!A1$/,
  );
  assert.match(
    await refused(server, "read_range", { spreadsheetId: backlogId, range: "Backlog!1A" }),
    /isn't A1 notation/,
  );
});

test("read_range asks Google for cells as entered with FORMULA, and for nothing else", async () => {
  const { server, google } = overStandIn();
  await checked(server, "read_range", { spreadsheetId: backlogId, range: "Backlog!A1:C2" });
  await checked(server, "read_range", {
    spreadsheetId: backlogId,
    range: "Backlog!A1:C2",
    valueRenderOption: "FORMULA",
  });
  assert.deepEqual(
    google.calls.map((each) => new URL(each.url).searchParams.get("valueRenderOption")),
    ["FORMATTED_VALUE", "FORMULA"],
  );
  assert.match(
    await refused(server, "read_range", {
      spreadsheetId: backlogId,
      range: "Backlog!A1",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
    /FORMATTED_VALUE or FORMULA/,
  );
});

test("read_range with FORMULA keeps numbers and true/false as entered; as shown, all is text", async () => {
  const server = mcpServer({
    fetch: async () => Response.json({ range: "Backlog!A2:C2", values: [[3, true, "=A1"]] }),
    source: fixedAccess(standInToken),
  });
  const args = { spreadsheetId: backlogId, range: "Backlog!A2:C2" };
  assert.deepEqual(
    (await checked(server, "read_range", { ...args, valueRenderOption: "FORMULA" })).values,
    [[3, true, "=A1"]],
  );
  assert.deepEqual((await checked(server, "read_range", args)).values, [["3", "true", "=A1"]]);
});

test("read_range stops at the cell cap, says so, and pages on to the rest", async () => {
  // 60 columns by 200 rows: 12,000 cells.
  const rows = Array.from({ length: 200 }, (_, r) =>
    Array.from({ length: 60 }, (_, c) => `${r}:${c}`),
  );
  const fixture: Fixture = {
    spreadsheets: [
      {
        id: "big",
        name: "Big",
        modifiedTime: "2026-11-01T00:00:00.000Z",
        tabs: [{ sheetId: 0, title: "Data", rowCount: 200, columnCount: 60, rows }],
      },
    ],
  };
  const { server } = overStandIn(fixture);
  const seen: string[][] = [];
  const ranges: string[] = [];
  let range: string | undefined = "Data";
  while (range) {
    const page = await checked(server, "read_range", { spreadsheetId: "big", range });
    const values = page.values as string[][];
    assert.ok(values.flat().length <= cellCap);
    seen.push(...values);
    ranges.push(page.range as string);
    if (page.truncated) {
      assert.match(
        page.note as string,
        /^Cut at 5,000 cells: the first 83 rows of \d+ came back\. Read on with range `Data!A\d+:BH200`\.$/,
      );
    }
    range = page.nextRange as string | undefined;
  }
  assert.deepEqual(ranges, ["Data!A1:BH200", "Data!A84:BH200", "Data!A167:BH200"]);
  assert.deepEqual(seen, rows);

  // A row wider than the cap comes back cut, and says to ask for less.
  const wide: Fixture = {
    spreadsheets: [
      {
        id: "wide",
        name: "Wide",
        modifiedTime: "2026-11-01T00:00:00.000Z",
        tabs: [{ sheetId: 0, title: "W", rows: [Array.from({ length: 6000 }, () => "x")] }],
      },
    ],
  };
  const cut = await checked(overStandIn(wide).server, "read_range", {
    spreadsheetId: "wide",
    range: "W",
  });
  assert.equal((cut.values as string[][])[0]?.length, cellCap);
  assert.equal(cut.truncated, true);
  assert.equal(cut.nextRange, undefined);
  assert.match(cut.note as string, /fewer columns, such as up to column GJH/);
});

test("update_range writes over a range, as given by default, and keeps nulls' cells", async () => {
  const { server, google } = overStandIn();
  const done = await checked(server, "update_range", {
    spreadsheetId: backlogId,
    range: "Backlog!C3:D4",
    values: [
      ["Doing", 2],
      [null, true],
    ],
  });
  assert.deepEqual(done, {
    updatedRange: "Backlog!C3:D4",
    updatedRows: 2,
    updatedColumns: 2,
    updatedCells: 3,
  });
  assert.equal(new URL(google.calls.at(-1)?.url ?? "").searchParams.get("valueInputOption"), "RAW");
  const read = await called(server, "read_range", {
    spreadsheetId: backlogId,
    range: "Backlog!A3:D4",
  });
  assert.deepEqual(read.values, [
    ["T-2", "Second", "Doing", "2"],
    ["T-3", "Third", "", "TRUE"],
  ]);
  assert.equal(google.spreadsheets[0]?.modifiedTime, "2026-11-05T12:00:00.000Z");

  await called(server, "update_range", {
    spreadsheetId: backlogId,
    range: "Backlog!A2",
    values: [["=1+1"]],
    valueInputOption: "USER_ENTERED",
  });
  assert.equal(
    new URL(google.calls.at(-1)?.url ?? "").searchParams.get("valueInputOption"),
    "USER_ENTERED",
  );
  assert.match(
    await refused(server, "update_range", {
      spreadsheetId: backlogId,
      range: "Backlog!A2",
      values: [["a"]],
      valueInputOption: "FORMULA",
    }),
    /RAW or USER_ENTERED/,
  );
  assert.match(
    await refused(server, "update_range", {
      spreadsheetId: backlogId,
      range: "Backlog!A2",
      values: [],
    }),
    /list of rows/,
  );
  assert.match(
    await refused(server, "update_range", {
      spreadsheetId: backlogId,
      range: "Backlog!A2",
      values: [[{ formula: "x" }]],
    }),
    /list of rows/,
  );
  assert.match(
    await refused(server, "update_range", {
      spreadsheetId: "1ViewOnly",
      range: "Sheet1!A1",
      values: [["free"]],
    }),
    /can't open or change that spreadsheet/,
  );
});

test("writes keep to the cell cap too, and send nothing when over it", async () => {
  const { server, google } = overStandIn();
  const values = Array.from({ length: 101 }, () => Array.from({ length: 50 }, () => "x"));
  assert.equal(
    await refused(server, "append_rows", { spreadsheetId: backlogId, range: "Backlog", values }),
    "That's 5,050 cells; write at most 5,000 a call, in several calls.",
  );
  assert.equal(google.calls.length, 0);
});

test("append_rows adds rows after the table, and says where they went", async () => {
  const { server, google } = overStandIn();
  const done = await checked(server, "append_rows", {
    spreadsheetId: backlogId,
    range: "Backlog!A:C",
    values: [
      ["T-4", "Fourth", "To do"],
      ["T-5", "Fifth"],
    ],
  });
  assert.deepEqual(done, {
    tableRange: "Backlog!A1:C4",
    updatedRange: "Backlog!A5:C6",
    updatedRows: 2,
    updatedColumns: 3,
    updatedCells: 5,
  });
  const url = new URL(google.calls.at(-1)?.url ?? "");
  assert.equal(url.pathname, `/v4/spreadsheets/${backlogId}/values/Backlog!A%3AC:append`);
  assert.equal(url.searchParams.get("insertDataOption"), "INSERT_ROWS");
  assert.equal(url.searchParams.get("valueInputOption"), "RAW");
  const read = await called(server, "read_range", { spreadsheetId: backlogId, range: "Backlog" });
  assert.deepEqual((read.values as string[][]).slice(-2), [
    ["T-4", "Fourth", "To do"],
    ["T-5", "Fifth"],
  ]);
});

test("with no sign-in, every tool answers that it's not signed in, and calls nothing", async () => {
  const google = standIn(smallFixture());
  const server = mcpServer({
    fetch: google.fetch,
    source: {
      access: async () => ({ status: "refused", problem: notSignedIn }),
      secrets: () => [],
    },
  });
  const args: Record<string, Record<string, unknown>> = {
    list_spreadsheets: {},
    get_spreadsheet: { spreadsheetId: backlogId },
    read_range: { spreadsheetId: backlogId, range: "Backlog" },
    update_range: { spreadsheetId: backlogId, range: "Backlog!A1", values: [["x"]] },
    append_rows: { spreadsheetId: backlogId, range: "Backlog", values: [["x"]] },
  };
  for (const tool of tools)
    assert.equal(
      await refused(server, tool.name, args[tool.name]),
      "Not signed in. Run `sheets-mcp login`.",
    );
  assert.equal(google.calls.length, 0);
});

test("a token Google refuses is renewed once, and a second refusal is a sentence", async () => {
  const google = standIn(smallFixture(), { token: "good" });
  const asked: boolean[] = [];
  let token = "stale";
  const server = mcpServer({
    fetch: google.fetch,
    source: {
      access: async (again = false) => {
        asked.push(again);
        if (again) token = token === "stale" ? "good" : "stale";
        return { status: "ok", token };
      },
      secrets: () => [],
    },
  });
  await called(server, "list_spreadsheets");
  assert.deepEqual(asked, [false, true]);
  assert.deepEqual(google.calls.length, 2);
  token = "worse";
  assert.equal(
    await refused(server, "list_spreadsheets"),
    "Google refused the sign-in. Run `sheets-mcp login` again.",
  );
});

test("Google's errors come back as short sentences, and an answer that isn't JSON too", async () => {
  const answering = (status: number, body: string) =>
    mcpServer({
      fetch: async () => new Response(body, { status }),
      source: fixedAccess("t"),
    });
  const said = async (status: number, body: unknown) =>
    refused(
      answering(status, typeof body === "string" ? body : JSON.stringify(body)),
      "list_spreadsheets",
    );
  assert.equal(
    await said(429, { error: { code: 429, message: "Quota exceeded" } }),
    "Google says too many requests just now. Wait a minute, then try again.",
  );
  assert.equal(
    await said(403, { error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } }),
    "Google says too many requests just now. Wait a minute, then try again.",
  );
  assert.match(
    await said(403, {
      error: {
        code: 403,
        message:
          "Google Sheets API has not been used in project 123456789012 before or it is disabled.",
        details: [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" },
        ],
      },
    }),
    /^The Google Cloud project behind this client hasn't turned on the Sheets API/,
  );
  assert.equal(
    await said(502, "<html>Bad Gateway</html>"),
    "Google didn't answer properly (502). Try again in a moment.",
  );
  assert.equal(
    await refused(
      mcpServer({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
        source: fixedAccess("t"),
      }),
      "list_spreadsheets",
    ),
    "Couldn't reach Google. Check the connection, then try again.",
  );
  assert.equal(await said(200, "[1]"), "Google's answer isn't one this server reads.");
});

test("a tool that fails in a way of its own says little, and logs only the error's name", async () => {
  const logged: string[] = [];
  const server = mcpServer({
    fetch: async () => Response.json({ files: "not a list" }),
    source: fixedAccess("t"),
    log: (line) => logged.push(line),
  });
  const result = await callTool(server, "list_spreadsheets");
  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.text, "The tool failed in a way it didn't expect. Try again.");
  assert.deepEqual(logged, ["sheets-mcp: list_spreadsheets failed (TypeError)"]);
});

test("Drive's `name contains` matches from a word's start, not inside one", async () => {
  const names = ["HelloWorld", "Hello World", "hello-world plan", "Yellow"];
  const fixture: Fixture = {
    spreadsheets: names.map((name, i) => ({
      id: `s${i}`,
      name,
      modifiedTime: `2026-10-0${i + 1}T00:00:00.000Z`,
      tabs: [{ sheetId: 0, title: "Sheet1", rows: [] }],
    })),
  };
  const { server } = overStandIn(fixture);
  const found = async (query: string) =>
    ((await called(server, "list_spreadsheets", { query })).spreadsheets as { name: string }[])
      .map((s) => s.name)
      .toSorted();
  assert.deepEqual(await found("hello"), ["Hello World", "HelloWorld", "hello-world plan"]);
  assert.deepEqual(await found("World"), ["Hello World", "hello-world plan"]);
  assert.deepEqual(await found("ello"), []);
});

test("append_rows finds Google's table: the block around the range's last filled cell", async () => {
  // Google's own example: tables at A1:C2 and B4:D6.
  // https://developers.google.com/workspace/sheets/api/guides/values#append_values
  const fixture = (): Fixture => ({
    spreadsheets: [
      {
        id: "two",
        name: "Two tables",
        modifiedTime: "2026-11-01T00:00:00.000Z",
        tabs: [
          {
            sheetId: 0,
            title: "Sheet1",
            rows: [
              ["x", "y", "z"],
              ["x", "y", "z"],
              [],
              ["", "x", "y", "z"],
              ["", "x", "y", "z"],
              ["", "x", "y", "z"],
            ],
          },
        ],
      },
    ],
  });
  const append = (range: string) =>
    called(overStandIn(fixture()).server, "append_rows", {
      spreadsheetId: "two",
      range,
      values: [["new"]],
    });
  assert.deepEqual(await append("Sheet1"), {
    tableRange: "Sheet1!B4:D6",
    updatedRange: "Sheet1!B7:B7",
    updatedRows: 1,
    updatedColumns: 1,
    updatedCells: 1,
  });
  const upper = await append("Sheet1!A1:A2");
  assert.equal(upper.tableRange, "Sheet1!A1:C2");
  assert.equal(upper.updatedRange, "Sheet1!A3:A3");
  const empty = await append("Sheet1!F1:G3");
  assert.equal(empty.tableRange, undefined);
  assert.equal(empty.updatedRange, "Sheet1!F1:F1");
});
