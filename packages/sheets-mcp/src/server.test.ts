import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fixture } from "./fixture.ts";
import { mcpServer } from "./server.ts";
import { answerOf, backlogId, called, callTool, overStandIn, refused, request } from "./testing.ts";
import { cellCap, tools } from "./tools.ts";

// A client may run a tool that says it only reads without asking the person.
test("a tool that writes never says it only reads", async () => {
  const { server } = overStandIn();
  const listed = await answerOf(server, request("tools/list"));
  assert.ok("result" in listed);
  const hints = Object.fromEntries(
    (listed.result.tools as { name: string; annotations: Record<string, unknown> }[]).map((t) => [
      t.name,
      t.annotations,
    ]),
  );
  for (const name of ["update_range", "append_rows"])
    assert.equal(hints[name]?.readOnlyHint, false, name);
});
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

test("read_range stops at the cell cap, and pages on to the rest", async () => {
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
    range = page.nextRange as string | undefined;
  }
  assert.deepEqual(ranges, ["Data!A1:BH200", "Data!A84:BH200", "Data!A167:BH200"]);
  assert.deepEqual(seen, rows);

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
});

test("update_range and append_rows write values RAW by default", async () => {
  const { server, google } = overStandIn();
  const values = [['=IMPORTDATA("https://example.invalid/")']];
  await called(server, "update_range", { spreadsheetId: backlogId, range: "Backlog!A2", values });
  await called(server, "append_rows", { spreadsheetId: backlogId, range: "Backlog", values });
  assert.deepEqual(
    google.calls.map((each) => new URL(each.url).searchParams.get("valueInputOption")),
    ["RAW", "RAW"],
  );
});

test("writes keep to the cell cap too, and send nothing when over it", async () => {
  const { server, google } = overStandIn();
  const values = Array.from({ length: 101 }, () => Array.from({ length: 50 }, () => "x"));
  await refused(server, "append_rows", { spreadsheetId: backlogId, range: "Backlog", values });
  assert.equal(google.calls.length, 0);
});

test("a tool that fails in a way of its own logs only the error's name", async () => {
  const sentinel = "sentinel-secret-7f3a";
  const logged: string[] = [];
  const server = mcpServer({
    fetch: async () => Response.json({ files: [] }),
    source: {
      access: async () => {
        throw new TypeError(`token ${sentinel} broke`);
      },
      secrets: () => [],
    },
    log: (line) => logged.push(line),
  });
  const result = await callTool(server, "list_spreadsheets");
  assert.equal(result.isError, true);
  assert.equal(logged.length, 1);
  assert.match(logged[0] ?? "", /\(TypeError\)$/);
  assert.ok(!logged.join("\n").includes(sentinel));
  assert.ok(!JSON.stringify(result).includes(sentinel));
});
