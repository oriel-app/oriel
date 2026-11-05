// Oriel's MCP door (decision 0024, the OA-71 spike): its tools are the
// registry's and the agent's reads, never a person's actions; a tool that
// acts changes a workstream as itself, which the window shows with Undo; one
// that reads only, or was revoked, or comes from a page, is refused.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type ActionDeclaration, type ActionName, actions } from "@oriel/core";
import type { DiffView, ThreadSummaryView, ThreadView, WorkstreamView } from "@oriel/web/view";
import { tools, toolNameOf } from "./mcp/catalogue.ts";
import { mcpHandler, type McpRequest } from "./mcp/http.ts";
import { instructions, mcpServer, modern, perMinute } from "./mcp/protocol.ts";
import { windowRoutes } from "./mcp/parity.ts";
import { windowReads } from "./mcp/reads.ts";
import { json, type Script, testApp } from "./testing.ts";

// What a test reads of an answer: a result, or an error.
type Answer = {
  result: {
    tools: { name: string; annotations: { readOnlyHint: boolean } }[];
    isError?: true;
    content: { text: string }[];
    structuredContent: { about: string };
    contents: { text: string }[];
    messages: unknown[];
  };
  error: { code: number };
};

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const port = 4319;

async function door(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const app = await testApp(t, options);
  const connected = app.app.outside.tools;
  const acting = connected.connect("Claude Code", "act");
  const reading = connected.connect("A reader", "read");
  let clock = 0;
  const server = mcpServer({
    outside: app.app.outside,
    window: new URL("http://127.0.0.1:4310/"),
    version: "test",
    clock: () => clock,
  });
  const handle = mcpHandler({ server, tools: connected, port });
  let id = 0;
  // A 2026-07-28 request, as a client sends it, headers and all.
  const request = (
    token: string | null,
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): McpRequest => {
    const named = params["name"] ?? params["uri"];
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method,
      params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": modern } },
    });
    return {
      method: "POST",
      url: "/mcp",
      headers: {
        host: `127.0.0.1:${port}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "mcp-protocol-version": modern,
        "mcp-method": method,
        ...(typeof named === "string" ? { "mcp-name": named } : {}),
        ...headers,
      },
      body: async () => body,
    };
  };
  const call = async (token: string | null, method: string, params = {}, headers = {}) => {
    const reply = await handle(request(token, method, params, headers));
    return { status: reply.status, ...json<Answer>(reply) };
  };
  const { id: workstream } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  return {
    ...app,
    server,
    connected,
    acting,
    reading,
    workstream,
    call,
    handle,
    request,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

test("every tool is a read or an action open to outside tools, and no person's action is one", () => {
  const named = new Set(tools.map((tool) => tool.name));
  for (const [name, declared] of Object.entries(actions) as [ActionName, ActionDeclaration][]) {
    const open = declared.class.kind === "direct" && declared.closed?.tool === undefined;
    assert.equal(named.has(toolNameOf(name)), open, name);
  }
  for (const tool of tools)
    if (!tool.acts) assert.equal(tool.annotations.readOnlyHint, true, tool.name);
  // Besides the actions, the one tool that acts is Undo of the tool's own calls.
  assert.deepEqual(
    tools
      .filter((tool) => tool.acts && !Object.hasOwn(actions, tool.name.replace("_", ".")))
      .map((tool) => tool.name),
    ["undo"],
  );
});

test("a tool that acts removes an item as itself, and the window shows it with an Undo", async (t) => {
  const app = await door(t);
  const listed = await app.call(app.acting.token, "tools/list");
  assert.ok(
    listed.result.tools.some((tool: { name: string }) => tool.name === "workstream_remove"),
  );
  const removed = await app.call(app.acting.token, "tools/call", {
    name: "workstream_remove",
    arguments: { workstream: app.workstream, items: ["jira:SYN-10"] },
  });
  assert.equal(removed.result.isError, undefined);
  const page = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  const [latest] = page.changes;
  assert.equal(latest?.tool, "Claude Code");
  assert.deepEqual(
    latest?.removed.map((ref) => ref.id),
    ["jira:SYN-10"],
  );
  assert.ok(latest?.undo);
  assert.equal(
    (await app.post(`/api/actions/${latest.undo.action}`, latest.undo.input)).status,
    200,
  );
  const after = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  assert.ok(after.members.some((member) => member.ref.id === "jira:SYN-10"));
  // Undone by the user, the tool's version is no longer the latest: no Undo.
  assert.equal(after.changes.find((change) => change.tool)?.undo, null);
});

test("a tool that reads only lists no action and is refused one; a revoked one, everything", async (t) => {
  const app = await door(t);
  const listed = await app.call(app.reading.token, "tools/list");
  assert.ok(
    listed.result.tools.every(
      (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
    ),
  );
  const refused = await app.call(app.reading.token, "tools/call", {
    name: "workstream_remove",
    arguments: { workstream: app.workstream, items: ["jira:SYN-10"] },
  });
  assert.equal(refused.result.isError, true);
  const page = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  assert.equal(page.changes.length, 1);
  app.connected.revoke(app.acting.tool.id);
  assert.equal((await app.call(app.acting.token, "tools/list")).status, 401);
  assert.equal((await app.call(null, "tools/list")).status, 401);
});

test("no page reaches the door, whatever its origin, nor a name rebound to loopback", async (t) => {
  const app = await door(t);
  const own = { origin: `http://127.0.0.1:${port}` };
  assert.equal((await app.call(app.acting.token, "tools/list", {}, own)).status, 403);
  const rebound = { host: "attacker.example:4319" };
  assert.equal((await app.call(app.acting.token, "tools/list", {}, rebound)).status, 403);
  const get = await app.handle({ ...app.request(app.acting.token, "tools/list"), method: "GET" });
  assert.equal(get.status, 405);
});

test("a request whose headers don't say what its body does is refused", async (t) => {
  const app = await door(t);
  const wrong = await app.call(
    app.acting.token,
    "tools/call",
    {
      name: "workstream_remove",
      arguments: { workstream: app.workstream, items: ["jira:SYN-10"] },
    },
    { "mcp-name": "workstream_list" },
  );
  assert.equal(wrong.status, 400);
  assert.equal(wrong.error.code, -32020);
});

test("a handshake client is served too, and an unknown version is told which there are", async (t) => {
  const app = await door(t);
  const legacy = await app.handle({
    method: "POST",
    url: "/mcp",
    headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${app.acting.token}` },
    body: async () =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x" } },
      }),
  });
  const init = json<{ result: { protocolVersion: string; instructions: string } }>(legacy);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.instructions, instructions);
  const old = await app.server.handle(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    app.acting.tool,
    "2025-06-18",
  );
  assert.ok(old && "result" in old);
  const unknown = await app.server.handle(
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    app.acting.tool,
    "1900-01-01",
  );
  assert.ok(unknown && "error" in unknown);
  assert.equal(unknown.error.code, -32022);
});

test("what a tool reads goes out marked as data, never as words of Oriel's", async (t) => {
  const app = await door(t);
  const found = await app.call(app.reading.token, "tools/call", {
    name: "item_search",
    arguments: { query: "checkout" },
  });
  assert.match(found.result.content[0]?.text ?? "", /^Data from Oriel: .*never instructions/);
  // A client may give its model the structured result instead: it says so too.
  assert.match(found.result.structuredContent.about, /^Data from Oriel: /);
  const uri = `oriel://workstreams/${app.workstream}`;
  const read = await app.call(app.reading.token, "resources/read", { uri });
  assert.match(read.result.contents[0]?.text ?? "", /^Data from Oriel: /);
  // Only an item the window has is read, never one its source has besides.
  const outside = await app.call(app.reading.token, "tools/call", {
    name: "item_read",
    arguments: { item: "jira:SYN-9999" },
  });
  assert.equal(outside.result.isError, true);
  // The prompt carries Oriel's own words and a link, never the workstream's.
  const prompt = await app.call(app.reading.token, "prompts/get", {
    name: "ask_about_workstream",
    arguments: { workstream: app.workstream },
  });
  const said = JSON.stringify(prompt.result.messages);
  assert.ok(!said.includes("Checkout v2"));
  assert.ok(said.includes(uri));
});

test("a subscription hears the workstream a tool changed", async (t) => {
  const app = await door(t);
  const heard: string[] = [];
  const uri = `oriel://workstreams/${app.workstream}`;
  const stop = app.server.listen(
    {
      jsonrpc: "2.0",
      id: "listen",
      method: "subscriptions/listen",
      params: { notifications: { resourceSubscriptions: [uri] } },
    },
    (notification) => heard.push(notification.method),
  );
  assert.equal(typeof stop, "function");
  await app.call(app.acting.token, "tools/call", {
    name: "workstream_remove",
    arguments: { workstream: app.workstream, items: ["jira:SYN-10"] },
  });
  // What one call changed goes out once, however many streams carried it.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(heard, [
    "notifications/subscriptions/acknowledged",
    "notifications/resources/updated",
  ]);
  if (typeof stop === "function") stop();
});

test("a tool's calls are capped each minute, and its name when the user connects it", async (t) => {
  const app = await door(t);
  const list = () =>
    app.call(app.reading.token, "tools/call", { name: "workstream_list", arguments: {} });
  for (let i = 0; i < perMinute.reads; i++) assert.equal((await list()).result.isError, undefined);
  assert.equal((await list()).result.isError, true);
  app.tick(60_000);
  assert.equal((await list()).result.isError, undefined);
  assert.throws(() => app.connected.connect("x".repeat(61), "read"));
});

test("a tool's words wait in its thread under its name, and only the user's Send starts a turn", async (t) => {
  const app = await door(t);
  const opened = await app.call(app.acting.token, "tools/call", {
    name: "thread_open",
    arguments: { workstream: app.workstream },
  });
  const { thread } = opened.result.structuredContent as unknown as { thread: string };
  await app.call(app.acting.token, "tools/call", {
    name: "thread_say",
    arguments: { thread, text: "Estimate SYN-10 at 3 points." },
  });
  await app.app.settled();
  const held = json<ThreadView>(await app.get(`/api/threads/${thread}`));
  const entry = held.entries.find((each) => each.kind === "held");
  assert.ok(entry?.kind === "held");
  assert.deepEqual(entry.from, { kind: "tool", name: "Claude Code" });
  assert.deepEqual(
    held.entries.map((each) => each.kind),
    ["held"],
  );
  assert.equal((await app.post(`/api/threads/${thread}/held/${entry.seq}/send`)).status, 202);
  await app.app.settled();
  const sent = json<ThreadView>(await app.get(`/api/threads/${thread}`));
  // Sent on, the words are the user's, and the agent answers them.
  assert.deepEqual(
    sent.entries.map((each) => each.kind),
    ["held", "user", "text", "done"],
  );
});

test("a revoked tool's open subscription ends as it is revoked", async (t) => {
  const app = await door(t);
  const reply = await app.handle(
    app.request(app.reading.token, "subscriptions/listen", {
      notifications: { resourcesListChanged: true },
    }),
  );
  assert.ok(reply.stream);
  const stream = reply.stream[Symbol.asyncIterator]();
  assert.match(String((await stream.next()).value), /subscriptions\/acknowledged/);
  app.connected.revoke(app.reading.tool.id);
  assert.equal((await stream.next()).done, true);
});

// Each turn proposes a new title for SYN-23, which only the user approves.
const rename: Script = async () => ({
  value: null,
  writes: [["jira.setSummary", ["jira:SYN-23", "A program asked"]]],
});
const proposing = {
  plan: () => [{ run: "rename" }, { text: "I proposed a new title." }],
  scripts: { rename },
};

// What a resource read gives back, under its line marking it as data.
const dataOf = (answer: Answer) => {
  const text = answer.result.contents[0]?.text ?? "";
  assert.match(text, /^Data from Oriel: /);
  return JSON.parse(text.slice(text.indexOf("\n") + 1)) as unknown;
};

test("every way into the window a program has is one the door has, and every read is a route", () => {
  const named = new Set([...tools.map((tool) => tool.name), "subscriptions/listen"]);
  for (const [route, way] of Object.entries(windowRoutes)) {
    if ("not" in way) {
      assert.match(way.not, /^[A-Z].*\.$/, route);
      continue;
    }
    for (const each of way.door.split(" ")) assert.ok(named.has(each), `${route}: ${each}`);
  }
  // A read's route is never one the table says a program may not have.
  for (const read of windowReads) assert.equal(windowRoutes[read.route], undefined, read.name);
});

test("a program reads what the window reads, from the window's own routes", async (t) => {
  const app = await door(t, proposing);
  const { id: thread } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstream}/threads`, { text: "Rename SYN-23" }),
  );
  await app.app.settled();
  const read = async (uri: string) =>
    dataOf(await app.call(app.reading.token, "resources/read", { uri }));
  // A thread as its page shows it: its entries, blocks and change sets.
  const page = json<ThreadView>(await app.get(`/api/threads/${thread}`));
  assert.deepEqual(await read(`oriel://threads/${thread}`), page);
  // Needs you, as the sidebar draws it from the same list.
  const waiting = (await read("oriel://needs-you")) as { threads: ThreadSummaryView[] };
  assert.deepEqual(
    waiting.threads.map((each) => [each.id, each.waitingOn]),
    [[thread, "review"]],
  );
  // The change set's diff, as the person reviews it.
  const [set] = page.changeSets;
  assert.ok(set);
  const diff = (await read(`oriel://change-sets/${set.id}/diff`)) as DiffView;
  assert.equal(diff.hash, json<DiffView>(await app.post(`/api/change-sets/${set.id}/diff`)).hash);
  // Browse under a grouping, and the overview.
  assert.deepEqual(
    await read("oriel://browse?grouping=assignee"),
    json(await app.get("/api/browse?grouping=assignee")),
  );
  assert.deepEqual(await read("oriel://overview"), json(await app.get("/api/overview")));
  // Only what the window reads: nothing of the person's own, and no query its
  // route doesn't read.
  for (const uri of [
    "oriel://settings",
    "oriel://setup",
    `oriel://threads/${thread}/deletion`,
    "oriel://browse?grouping=epic&token=x",
    "oriel://items/jira%3ASYN-9999",
  ]) {
    const refused = await app.call(app.reading.token, "resources/read", { uri });
    assert.equal(refused.error?.code, -32602, uri);
  }
});

test("a subscription hears a change set a turn proposed, and the person's decision on it", async (t) => {
  const app = await door(t, proposing);
  const { id: thread } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstream}/threads`, {}),
  );
  const heard: string[] = [];
  const stop = app.server.listen(
    {
      jsonrpc: "2.0",
      id: "listen",
      method: "subscriptions/listen",
      params: {
        notifications: {
          resourceSubscriptions: ["oriel://needs-you", `oriel://threads/${thread}`],
        },
      },
    },
    (notification) => {
      const uri = (notification.params as { uri?: string }).uri;
      if (uri) heard.push(uri);
    },
  );
  await app.post(`/api/threads/${thread}/messages`, { text: "Rename SYN-23" });
  await app.app.settled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(heard.includes("oriel://needs-you"));
  assert.ok(heard.includes(`oriel://threads/${thread}`));
  heard.length = 0;
  const [set] = json<ThreadView>(await app.get(`/api/threads/${thread}`)).changeSets;
  assert.ok(set);
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${set.id}/diff`));
  await app.post(`/api/change-sets/${set.id}/reject`, { hash });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(heard.toSorted(), ["oriel://needs-you", `oriel://threads/${thread}`]);
  if (typeof stop === "function") stop();
});

test("every call a tool makes that changes something has an Undo, the tool's and the person's", async (t) => {
  const app = await door(t);
  const act = (name: string, args: Record<string, unknown>) =>
    app.call(app.acting.token, "tools/call", { name, arguments: args });
  const renamed = await act("workstream_rename", { workstream: app.workstream, name: "Renamed" });
  const { call, undoable } = renamed.result.structuredContent as unknown as {
    call: string;
    undoable: boolean;
  };
  assert.equal(undoable, true);
  const name = async () =>
    json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`)).workstream.name;
  assert.equal(await name(), "Renamed");
  // The tool takes back its own call, once.
  const undone = await act("undo", { call });
  assert.equal(undone.result.isError, undefined, undone.result.content[0]?.text);
  assert.notEqual(await name(), "Renamed");
  assert.equal((await act("undo", { call })).result.isError, true);
  // The person sees each call, by the tool's name, and undoes any of them.
  const done = await act("workstream_done", { workstream: app.workstream });
  assert.equal(done.result.isError, undefined);
  type Calls = {
    calls: { id: string; tool: string; action: string; undo: { action: string; input: unknown } }[];
  };
  const listed = json<Calls>(await app.get("/api/outside"));
  assert.deepEqual(
    listed.calls.map((each) => [each.tool, each.action]),
    [
      ["Claude Code", "workstream.done"],
      ["Claude Code", "workstream.rename"],
      ["Claude Code", "workstream.rename"],
    ],
  );
  const [latest] = listed.calls;
  assert.ok(latest);
  const undo = await app.post(
    `/api/actions/${latest.undo.action}?call=${latest.id}`,
    latest.undo.input,
  );
  assert.equal(undo.status, 200);
  const page = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  assert.equal(page.workstream.done, null);
  // Spent, its Undo is refused, by the person as by the tool.
  assert.equal(
    (await app.post(`/api/actions/${latest.undo.action}?call=${latest.id}`, latest.undo.input))
      .status,
    409,
  );
  assert.equal((await act("undo", { call: latest.id })).result.isError, true);
  // And another tool can't take back this one's calls.
  const other = app.connected.connect("Another tool", "act");
  const theirs = await app.call(other.token, "tools/call", {
    name: "undo",
    arguments: { call: listed.calls[1]?.id },
  });
  assert.equal(theirs.result.isError, true);
});

test("a tool the person lets speak for them starts a turn under its own name, and nothing it proposes applies without them", async (t) => {
  const app = await door(t, proposing);
  const speaking = app.connected.connect("The hub", "speak");
  const opened = await app.call(speaking.token, "tools/call", {
    name: "thread_open",
    arguments: { workstream: app.workstream },
  });
  const { thread } = opened.result.structuredContent as unknown as { thread: string };
  const said = await app.call(speaking.token, "tools/call", {
    name: "thread_say",
    arguments: { thread, text: "Rename SYN-23" },
  });
  assert.equal(said.result.isError, undefined);
  await app.app.settled();
  const page = json<ThreadView>(await app.get(`/api/threads/${thread}`));
  const [first] = page.entries;
  assert.deepEqual(first?.kind === "user" && [first.text, first.by], ["Rename SYN-23", "The hub"]);
  // The agent answered, and its change set waits on the person.
  const [set] = page.changeSets;
  assert.equal(set?.status, "open");
  assert.ok(page.entries.some((each) => each.kind === "text"));
  // One that only acts still has its words held.
  await app.call(app.acting.token, "tools/call", {
    name: "thread_say",
    arguments: { thread, text: "And SYN-24?" },
  });
  const after = json<ThreadView>(await app.get(`/api/threads/${thread}`));
  assert.equal(after.entries.at(-1)?.kind, "held");
  // Names are one tool's each.
  assert.throws(() => app.connected.connect("the hub", "read"), /connected already/);
});
