// Linear through Linear's MCP server (OA-278): the parser on each tool's
// answer, from `fixtures/linear-mcp/`'s recorded calls, and its failing
// closed on an answer it can't read. No server runs: the recordings answer,
// or the stand-in in memory. Each mutation as the server's write call is in
// writer.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listed,
  replayCalls,
  ServerUnreadable,
  type ToolAnswer,
  type ToolCall,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { loadCalls } from "./calls.ts";
import { standInServer } from "./declared-fixture.ts";
import { linearServer, linearTools as t, readIssue } from "./linear-mcp.ts";
import { linearStandIn, standInCaller } from "./linear-standin.ts";
import { openLinear } from "./open-connection.ts";
import { loadLinearWorld } from "./world.ts";

const world = loadLinearWorld();
const synced = loadCalls("sync.json");
const reads = loadCalls("read.json");

const connection: ToOpen = {
  id: "01JRECORDING00000000000000" as ToOpen["id"],
  number: 1,
  prefix: "linear",
  identity: "",
  options: {},
};

const open = (read: ToolCaller) =>
  openLinear(connection, {
    log: () => {},
    now: () => world.frozen,
    server: { ...standInServer(), read },
  });

const listAll = async (read: ToolCaller) => {
  const opened = await open(read);
  const { records } = await listed(opened.source.sync(null));
  return { opened, records };
};

// One recorded answer changed: each to `tool`.
const altered = (
  tool: string,
  change: (answer: ToolAnswer, call: ToolCall) => ToolAnswer,
): ToolCaller => {
  const replay = replayCalls([...synced.calls, ...reads.calls]);
  return async (call) => {
    const answer = await replay(call);
    return call.tool === tool ? change(answer, call) : answer;
  };
};
const json = (answer: ToolAnswer) =>
  JSON.parse(String((answer.content[0] as { text: string }).text)) as Record<string, unknown>;
const text = (value: unknown): ToolAnswer => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

test("a page that doesn't say whether more remain is followed by the one after its last item, while it was full", async () => {
  // Past one full page of Linear's 250, as a server with no page info
  // answers: bare lists.
  const tools = standInCaller(linearStandIn());
  for (let i = 0; i < 260; i += 1)
    await tools({ tool: t.saveIssue, args: { team: "ENG", title: `Filler ${i}` } });
  const asked: ToolCall[] = [];
  const bare: ToolCaller = async (call) => {
    if (call.tool !== t.issues) return tools(call);
    asked.push(call);
    return text(json(await tools(call)).issues);
  };
  const { records } = await listAll(bare);
  assert.equal(records.filter((record) => record.title.startsWith("Filler")).length, 260);
  assert.equal(asked.length, 2);
  assert.equal(asked[0]?.args.after, undefined);
  assert.match(String(asked[1]?.args.after), /^00000007-/, "after the first page's last issue");
  // One that gives the same page again can't be read.
  const stuck: ToolCaller = async (call) =>
    call.tool === t.issues
      ? text(json(await tools({ ...call, args: { ...call.args, after: undefined } })).issues)
      : tools(call);
  await assert.rejects(listAll(stuck), ServerUnreadable);
});

test("an answer Oriel can't read stops the sync, naming the server, never quoting the answer", async () => {
  const garbled: [string, (answer: ToolAnswer) => ToolAnswer][] = [
    [t.issues, () => ({ content: [{ type: "text", text: "Here are your issues: ENG-1, ENG-2" }] })],
    [
      t.issues,
      (answer) => text({ ...json(answer), issues: [{ id: "x", title: "No identifier" }] }),
    ],
    [t.issues, (answer) => text({ ...json(answer), pageInfo: { hasNextPage: true } })],
    [
      t.issues,
      (answer) =>
        text({
          ...json(answer),
          issues: (json(answer).issues as Record<string, unknown>[]).map((each) => ({
            ...each,
            status: "Somewhere new",
            statusType: undefined,
          })),
        }),
    ],
    [t.statuses, () => text({ statuses: [{ id: "s", name: "Odd", type: "sideways" }] })],
    [
      t.projects,
      (answer) =>
        text({
          projects: [
            { ...((json(answer).projects as unknown[])[0] as object), url: "", slugId: undefined },
          ],
        }),
    ],
    [t.teams, () => ({ content: [{ type: "text", text: "Unauthorized" }], isError: true })],
    // What reaches the declarations or a pattern is checked: a team's key,
    // and a cycle's number and dates.
    [t.teams, () => text({ teams: [{ id: "x", key: "ENG */ declare", name: "Odd" }] })],
    [
      t.cycles,
      () =>
        text({
          cycles: [
            { id: "c", number: 1.5, name: null, startsAt: "2026-11-02", endsAt: "2026-11-16" },
          ],
        }),
    ],
    [
      t.cycles,
      () =>
        text({
          cycles: [{ id: "c", number: 2, name: null, startsAt: "*/ soon", endsAt: "2026-11-16" }],
        }),
    ],
  ];
  for (const [tool, change] of garbled) {
    const sync = listAll(altered(tool, change));
    await assert.rejects(sync, (error: unknown) => {
      assert.ok(error instanceof ServerUnreadable, `${tool}: ${String(error)}`);
      assert.doesNotMatch(error.message, /ENG-1|Somewhere new|Odd|Unauthorized/);
      return true;
    });
  }
});

test("an item's link is Linear's own page of it, or none", () => {
  const issue = (url: string) =>
    readIssue({
      id: "u",
      identifier: "ENG-1",
      title: "A",
      updatedAt: "2026-11-01T00:00:00Z",
      status: "Todo",
      url,
    }).url;
  assert.equal(
    issue("https://linear.app/ferrowick/issue/ENG-1/a"),
    "https://linear.app/ferrowick/issue/ENG-1/a",
  );
  assert.equal(issue("https://evil.example/ferrowick/issue/ENG-1/a"), "");
  assert.equal(issue("https://linear.app/ferrowick/issue/ENG-2/a"), "");
  assert.equal(issue("javascript:alert(1)"), "");
});

test("no tool Linear's server reads with is one it writes with", () => {
  assert.ok(!linearServer.reads.some((tool) => linearServer.writes.includes(tool)));
});

test("a team picked bounds the sync: none of the first team's issues", async () => {
  const ops = await openLinear(
    { ...connection, options: { team: "OPS" } },
    {
      log: () => {},
      now: () => world.frozen,
      server: { ...standInServer(), read: standInCaller(linearStandIn(world)) },
    },
  );
  assert.equal(ops.scope.team, "OPS");
  const { records } = await listed(ops.source.sync(null));
  assert.ok(records.length > 0);
  assert.ok(records.every((record) => record.id.startsWith("linear:OPS-")));
});
