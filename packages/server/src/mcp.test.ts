// Oriel's MCP door (decision 0024, the OA-71 spike): its tools are the
// registry's and the agent's reads, never a person's actions; a tool that
// acts changes a workstream as itself, which the window shows with Undo; one
// that reads only, or was revoked, or comes from a page, is refused.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type ActionDeclaration, type ActionName, actions, instant, ulid } from "@oriel/core";
import type { ThreadView, WorkstreamView } from "@oriel/web/view";
import { tools, toolNameOf } from "./mcp/catalogue.ts";
import { mcpHandler, type McpRequest } from "./mcp/http.ts";
import { instructions, mcpServer, modern, perMinute } from "./mcp/protocol.ts";
import { outsideTools } from "./mcp/tokens.ts";
import { json, testApp } from "./testing.ts";

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

async function door(t: TestContext) {
  const app = await testApp(t);
  const at = instant(new Date(Date.UTC(2026, 10, 5)));
  let n = 0;
  const connected = outsideTools({ now: () => at, newId: () => ulid(Date.UTC(2026, 10, 5) + ++n) });
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
  const uri = `oriel://workstream/${app.workstream}`;
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
  const uri = `oriel://workstream/${app.workstream}`;
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

test("guarded membership commands share one receipt on simultaneous retry and survive Undo without replay", async (t) => {
  const app = await door(t);
  const checkpoint = await app.call(app.acting.token, "tools/call", {
    name: "workstream_checkpoint",
    arguments: { workstream: app.workstream },
  });
  const { epoch, version } = (
    checkpoint.result.structuredContent as unknown as { data: { epoch: string; version: number } }
  ).data;
  const command = {
    workstream: app.workstream,
    operation: "remove",
    items: ["jira:SYN-10"],
    expectedVersion: version,
    requestId: "remove-1",
    epoch,
  };
  const edit = (arguments_: Record<string, unknown>) =>
    app.call(app.acting.token, "tools/call", { name: "workstream_edit", arguments: arguments_ });
  const [first, retry] = await Promise.all([edit(command), edit(command)]);
  assert.deepEqual(first.result.structuredContent, retry.result.structuredContent);
  assert.equal((first.result.structuredContent as unknown as { status: string }).status, "applied");
  const page = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  assert.equal(page.changes.length, 2);
  assert.equal(page.changes[0]?.tool, "Claude Code");
  const undo = page.changes[0]?.undo;
  assert.ok(undo);
  await app.post(`/api/actions/${undo.action}`, undo.input);
  assert.deepEqual((await edit(command)).result.structuredContent, first.result.structuredContent);
  const after = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstream}`));
  assert.ok(after.members.some(({ ref }) => ref.id === "jira:SYN-10"));
  assert.equal((await edit({ ...command, operation: "add" })).result.isError, true);
  const stale = await edit({ ...command, requestId: "stale" });
  assert.equal((stale.result.structuredContent as unknown as { code: string }).code, "conflict");
  const oldEpoch = await edit({ ...command, requestId: "restart", epoch: "previous-server" });
  assert.equal(oldEpoch.result.isError, true);
  const readOnly = await app.call(app.reading.token, "tools/call", {
    name: "workstream_edit",
    arguments: command,
  });
  assert.equal(readOnly.result.isError, true);
  app.connected.revoke(app.acting.tool.id);
  assert.equal((await edit(command)).status, 401);
});

test("receipt keys belong to a connected tool, and refused receipts never become actions", async (t) => {
  const app = await door(t);
  const second = app.connected.connect("Build bot", "act");
  const checkpoint = await app.call(app.acting.token, "tools/call", {
    name: "workstream_checkpoint",
    arguments: { workstream: app.workstream },
  });
  const { epoch, version } = (
    checkpoint.result.structuredContent as unknown as { data: { epoch: string; version: number } }
  ).data;
  const command = {
    workstream: app.workstream,
    operation: "remove",
    items: ["jira:SYN-10"],
    expectedVersion: version,
    requestId: "same-id",
    epoch,
  };
  const edit = (token: string) =>
    app.call(token, "tools/call", { name: "workstream_edit", arguments: command });
  const first = await edit(app.acting.token);
  const other = await edit(second.token);
  assert.equal((first.result.structuredContent as unknown as { status: string }).status, "applied");
  assert.equal((other.result.structuredContent as unknown as { code: string }).code, "conflict");
  assert.deepEqual(
    (await edit(second.token)).result.structuredContent,
    other.result.structuredContent,
  );
});
