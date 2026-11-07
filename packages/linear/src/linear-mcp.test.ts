// Linear through Linear's MCP server (OA-278): the parser on each tool's
// answer, from `fixtures/linear-mcp/`'s recorded calls, and its failing
// closed on an answer it can't read. No server runs: the recordings answer,
// or the stand-in in memory. Each mutation as the server's write call is in
// writer.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  type ItemId,
  listed,
  replayCalls,
  ServerUnreadable,
  type ToolAnswer,
  type ToolCall,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { loadCalls } from "./calls.ts";
import { linearContent } from "./items.ts";
import { standInServer } from "./declared-fixture.ts";
import { linearServer, linearTools as t, readIssue, readProject } from "./linear-mcp.ts";
import { linearStandIn, standInCaller } from "./linear-standin.ts";
import { linearProblem, openLinear } from "./open-connection.ts";
import { identifierOf, loadLinearWorld } from "./world.ts";

const world = loadLinearWorld();
const synced = loadCalls("sync.json");
const reads = loadCalls("read.json");

const connection: ToOpen = {
  id: "01JRECORDING00000000000000" as ToOpen["id"],
  number: 1,
  prefix: "linear",
  identity: "",
  options: {},
  secret: null,
};

const open = (read: ToolCaller) =>
  openLinear(connection, {
    kept: false,
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

test("the recordings say where they came from", () => {
  for (const file of [synced, reads]) assert.match(file.recorded, /^From the stand-in/);
});

test("a sync through the recorded calls lists the team's projects and issues, and nothing of another team", async () => {
  const { records } = await listAll(replayCalls(synced.calls));
  const eng = world.issues.filter((each) => identifierOf(world, each).startsWith("ENG-"));
  assert.equal(records.length, world.projects.length + eng.length);
  assert.ok(!records.some((record) => record.id.startsWith("linear:OPS-")));
  const byId = new Map(records.map((record) => [record.id, record]));
  // A project is an epic, which Browse's epic grouping hangs its issues off.
  const launch = byId.get("linear:P-5e2a9c41b7d0");
  assert.deepEqual(launch?.facets, { state: "in-progress", kind: "epic" });
  // An issue in it, assigned, estimated, in its status's category.
  assert.deepEqual(byId.get("linear:ENG-3")?.facets, {
    people: [
      { role: "assignee", id: "00000002-0000-4000-8000-000000000006", name: "Farid Haddad" },
    ],
    state: "in-progress",
    container: { id: "linear:P-5e2a9c41b7d0", stableId: launch?.stableId },
    kind: "story",
    estimate: 3,
  });
  assert.deepEqual(byId.get("linear:ENG-3")?.attrs, {
    issueType: "Issue",
    status: "In Review",
    labels: ["payments"],
  });
  // A sub-issue, a canceled one, one in no project, and one with no one.
  assert.equal(byId.get("linear:ENG-5")?.facets.kind, "subtask");
  assert.equal(byId.get("linear:ENG-14")?.facets.state, "done");
  assert.equal(byId.get("linear:ENG-19")?.facets.container, null);
  assert.deepEqual(byId.get("linear:ENG-6")?.facets.people, []);
  // Two issues with the same title stay two.
  assert.equal(records.filter((record) => record.title === "Update fare tables").length, 2);
});

test("the sync asks for the team's statuses, cycles and projects, and its issues, read tools only", async () => {
  const calls = synced.calls.map((each) => each.call.tool);
  assert.deepEqual(calls, [t.teams, t.statuses, t.cycles, t.projects, t.issues]);
  assert.ok(calls.every((tool) => linearServer.reads.includes(tool)));
});

test("a read through the recorded calls gives each item, Linear's extras with it", async () => {
  const { opened } = await listAll(replayCalls([...synced.calls, ...reads.calls]));
  const [issue, project] = (
    await opened.source.read(["linear:ENG-5", "linear:P-5e2a9c41b7d0"] as ItemId<"linear">[])
  ).map((each) => (each.status === "ok" ? linearContent(each.content) : null));
  assert.ok(issue?.ok && issue.value.kind === "issue");
  assert.deepEqual(
    {
      cycle: issue.value.cycle,
      parent: issue.value.parent,
      project: issue.value.project,
      team: issue.value.team,
    },
    {
      cycle: { number: 13, name: "Timetable freeze" },
      parent: "ENG-4",
      project: { id: "linear:P-5e2a9c41b7d0", name: "Summer timetable launch" },
      team: "ENG",
    },
  );
  assert.ok(project?.ok && project.value.kind === "project");
  assert.equal(project.value.lead, "Amara Okafor");
  // An issue deleted since is gone, not an error.
  const live = (await listAll(standInCaller(linearStandIn()))).opened;
  assert.equal(
    (await live.source.read(["linear:ENG-99"] as ItemId<"linear">[]))[0]?.status,
    "gone",
  );
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
  assert.equal(
    linearProblem(new ServerUnreadable("x"), linearServer.name),
    "Linear's MCP server answered in a way Oriel didn't expect, so Oriel kept the window as it was.",
  );
});

test("an issue's and a project's other likely shapes read the same", () => {
  const flat = readIssue({
    id: "u1",
    identifier: "ENG-1",
    title: "A",
    updatedAt: "2026-11-01T00:00:00Z",
    status: "Todo",
    assignee: "Amara Okafor",
    assigneeId: "p1",
    projectId: "j1",
    cycleId: "c1",
    parentId: null,
    estimate: 3,
    labels: ["x"],
  });
  const nested = readIssue({
    id: "u1",
    identifier: "ENG-1",
    title: "A",
    updatedAt: "2026-11-01T00:00:00.000Z",
    state: { name: "Todo", type: "unstarted" },
    assignee: { id: "p1", name: "Amara Okafor" },
    project: { id: "j1" },
    cycle: { id: "c1" },
    estimate: { value: 3, name: "3 Points" },
    labels: [{ name: "x" }],
  });
  assert.deepEqual({ ...flat, statusType: null }, { ...nested, statusType: null });
  assert.equal(nested.statusType, "unstarted");
  const project = readProject({
    id: "j1",
    name: "P",
    url: "https://linear.app/x/project/p-5e2a9c41b7d0/overview",
    updatedAt: "2026-11-01T00:00:00Z",
    state: "started",
  });
  assert.equal(project.slugId, "5e2a9c41b7d0");
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

test("Linear's server is known by its address, with its read and write tools named apart", () => {
  assert.deepEqual(linearServer.at, { url: "https://mcp.linear.app/mcp" });
  assert.ok(!linearServer.reads.some((tool) => linearServer.writes.includes(tool)));
  assert.ok(linearServer.writes.every((tool) => tool.startsWith("save_")));
});

test("only through its server: Linear has no connection of its own to open", async () => {
  await assert.rejects(
    openLinear(connection, { kept: false, log: () => {}, now: () => world.frozen }),
    /only through Linear's MCP server/,
  );
});

// What the index keeps of every record, compared with the fixture's own.
test("the recordings and the stand-in give the same index", async () => {
  const recorded = (await listAll(replayCalls(synced.calls))).records;
  const live = (await listAll(standInCaller(linearStandIn()))).records;
  const key = (records: IndexRecord[]) =>
    JSON.stringify(records.toSorted((a, b) => a.id.localeCompare(b.id)));
  assert.equal(key(recorded), key(live));
});
