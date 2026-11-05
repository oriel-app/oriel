// Oriel's MCP door (decision 0058): its tools are the registry's direct
// actions open to tools and the agent's reads, never a person's actions; a
// tool that acts changes a workstream as itself, which the window shows with
// Undo; one that reads only, or was revoked, or comes from a page, is
// refused. What it reads is what the window reads, from the window's own
// routes, marked as data, and it hears what the window's streams carry.
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
  const server = mcpServer({ outside: app.app.outside, version: "test", clock: () => clock });
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
  // Only what shows in the window as the tool's, with Undo, and a sync,
  // which has nothing to undo (decision 0058). Stopping or moving a thread
  // is never a tool's.
  assert.deepEqual(
    tools.filter((tool) => tool.acts).map((tool) => tool.name),
    ["workstream_add", "workstream_remove", "source_sync"],
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
  assert.match(removed.result.content[0]?.text ?? "", /as Claude Code's, and can undo it there/);
  const page = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  const [latest] = page.changes;
  assert.equal(latest?.tool, "Claude Code");
  assert.deepEqual(
    latest?.removed.map((ref) => ref.id),
    ["jira:SYN-10"],
  );
  // Counted as the tool's call.
  assert.deepEqual(app.app.telemetry().at(-1), {
    name: "action.called",
    at: app.app.telemetry().at(-1)?.at,
    data: { action: "workstream.remove", by: { kind: "tool", name: "Claude Code" } },
  });
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

test("a tool's add shows as its own, and its Undo takes the item out again", async (t) => {
  const app = await door(t);
  await app.post(`/api/workstreams/${app.workstream}/remove`, { items: ["jira:SYN-10"] });
  const added = await app.call(app.acting.token, "tools/call", {
    name: "workstream_add",
    arguments: { workstream: app.workstream, items: ["jira:SYN-10"] },
  });
  assert.equal(added.result.isError, undefined);
  const [latest] = json<WorkstreamView>(
    await app.get(`/api/workstreams/${app.workstream}`),
  ).changes;
  assert.equal(latest?.tool, "Claude Code");
  assert.deepEqual(latest?.undo, {
    action: "workstream.remove",
    input: { workstream: app.workstream, items: ["jira:SYN-10"] },
  });
});

test("a tool is refused what isn't open to tools, whatever it calls it", async (t) => {
  const app = await door(t);
  const { id: thread } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstream}/threads`, {}),
  );
  for (const [name, args] of [
    ["thread_stop", { thread }],
    ["thread_sync", { thread }],
    ["workstream_rename", { workstream: app.workstream, name: "Mine" }],
    ["changeset_approve", {}],
  ] as const) {
    const refused = await app.call(app.acting.token, "tools/call", { name, arguments: args });
    assert.equal(refused.error?.code, -32602, name);
  }
  // Even straight to the dispatcher, whichever door it came by.
  for (const action of ["thread.stop", "thread.sync"] as const)
    await assert.rejects(
      app.app.outside.dispatch.untyped(action, { thread }, { kind: "tool", name: "Claude Code" }),
      /closed to tools/,
    );
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
  assert.equal((await app.call("oriel_pt_made-up", "tools/list")).status, 401);
});

test("a tool's name is the person's, capped, and one live tool's alone", async (t) => {
  const app = await door(t);
  assert.throws(() => app.connected.connect("x".repeat(61), "read"), /1 to 60 characters/);
  assert.throws(() => app.connected.connect(" ", "read"), /1 to 60 characters/);
  assert.throws(() => app.connected.connect("claude code", "read"), /called claude code already/);
  // Revoked, its name is free again, and its row stays as who acted.
  app.connected.revoke(app.acting.tool.id);
  const again = app.connected.connect("Claude Code", "read");
  assert.equal(app.connected.who(again.token)?.id, again.tool.id);
  assert.deepEqual(
    app.connected.list().map((tool) => [tool.name, tool.revokedAt !== null]),
    [
      ["Claude Code", true],
      ["A reader", false],
      ["Claude Code", false],
    ],
  );
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

test("a tool's calls are capped each minute, reads and actions apart", async (t) => {
  const app = await door(t);
  const list = () =>
    app.call(app.reading.token, "tools/call", { name: "workstream_list", arguments: {} });
  for (let i = 0; i < perMinute.reads; i++) assert.equal((await list()).result.isError, undefined);
  const capped = await list();
  assert.equal(capped.result.isError, true);
  assert.match(capped.result.content[0]?.text ?? "", /Too many calls this minute/);
  app.tick(60_000);
  assert.equal((await list()).result.isError, undefined);
  const act = (items: string[]) =>
    app.call(app.acting.token, "tools/call", {
      name: "workstream_add",
      arguments: { workstream: app.workstream, items },
    });
  for (let i = 0; i < perMinute.acts; i++) assert.equal((await act(["jira:SYN-10"])).status, 200);
  assert.equal((await act(["jira:SYN-10"])).result.isError, true);
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
    "oriel://items/%E0%A4%A",
    // The workspace's event stream is no thread: a read never opens one.
    "oriel://threads/events",
  ]) {
    const refused = await app.call(app.reading.token, "resources/read", { uri });
    assert.equal(refused.error?.code, -32602, uri);
  }
});

test("a program's read of a diff keeps nothing the person's Approve applies against", async (t) => {
  const app = await door(t, proposing);
  const { id: thread } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstream}/threads`, { text: "Rename SYN-23" }),
  );
  await app.app.settled();
  const [set] = json<ThreadView>(await app.get(`/api/threads/${thread}`)).changeSets;
  assert.ok(set);
  const read = await app.call(app.reading.token, "resources/read", {
    uri: `oriel://change-sets/${set.id}/diff`,
  });
  const { hash } = dataOf(read) as DiffView;
  // Approval needs a diff the person was shown, never one a program read.
  const approved = await app.post(`/api/change-sets/${set.id}/approve`, { hash });
  assert.equal(approved.status, 409);
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

test("the person connects a tool in the window, its token shown once, and revokes it", async (t) => {
  const app = await door(t);
  const added = await app.post("/api/outside-tools", { name: "Codex", mode: "act" });
  assert.equal(added.status, 200);
  const { tool, token } = json<{ tool: { id: string; name: string }; token: string }>(added);
  assert.equal(tool.name, "Codex");
  assert.equal((await app.call(token, "tools/list")).status, 200);
  // Listed, with no token.
  const listed = await app.get("/api/outside-tools");
  assert.ok(!String(listed.body).includes(token));
  assert.deepEqual(
    json<{ door: unknown; tools: { name: string }[] }>(listed).tools.map((each) => each.name),
    ["Claude Code", "A reader", "Codex"],
  );
  assert.equal((await app.post("/api/outside-tools", { name: "codex", mode: "read" })).status, 409);
  assert.equal(
    (await app.post("/api/outside-tools", { name: "x".repeat(61), mode: "read" })).status,
    400,
  );
  assert.equal((await app.post("/api/outside-tools", { name: "X", mode: "speak" })).status, 400);
  assert.equal((await app.post(`/api/outside-tools/${tool.id}/revoke`)).status, 200);
  assert.equal((await app.call(token, "tools/list")).status, 401);
  assert.equal((await app.post(`/api/outside-tools/${tool.id}/revoke`)).status, 404);
});

test("a thread's subscription hears its workstream change, as its page does", async (t) => {
  const app = await door(t);
  const { id: thread } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstream}/threads`, {}),
  );
  const heard: string[] = [];
  const stop = app.server.listen(
    {
      jsonrpc: "2.0",
      id: "listen",
      method: "subscriptions/listen",
      params: { notifications: { resourceSubscriptions: [`oriel://threads/${thread}`] } },
    },
    (notification) => heard.push(notification.method),
  );
  await app.post(`/api/workstreams/${app.workstream}/remove`, { items: ["jira:SYN-10"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(heard.includes("notifications/resources/updated"));
  if (typeof stop === "function") stop();
});

test("listing resources counts as a read against the cap", async (t) => {
  const app = await door(t);
  const list = () => app.call(app.reading.token, "resources/list");
  for (let i = 0; i < perMinute.reads; i++) assert.ok((await list()).result);
  assert.equal((await list()).error?.code, -32600);
});
