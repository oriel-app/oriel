// Other agents working with Oriel's agent through the MCP door (the
// mcp-agents spike): a tool the user trusts starts turns under its own name,
// within the workstreams and caps they gave it, and its turns' intents apply
// there with Undo; any other tool's words are held. A tool hears the
// agent's answer, its change sets and the user's decision by waiting on the
// thread, by a task, or by reading the thread. Only the user decides.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { DiffView, ThreadView } from "@oriel/web/view";
import type { Ulid } from "@oriel/core";
import type { Agent } from "./agent.ts";
import { mcpHandler } from "./mcp/http.ts";
import { mcpServer, modern } from "./mcp/protocol.ts";
import type { Heard, ThreadNews } from "./mcp/threads.ts";
import type { Trust } from "./mcp/tokens.ts";
import type { Step } from "./scripted-agent.ts";
import { json, type Script, testApp, type TestOptions } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const tasks = { extensions: { "io.modelcontextprotocol/tasks": {} } };

type Called = {
  result: {
    isError?: true;
    resultType: string;
    taskId: string;
    status: string;
    content: { text: string }[];
    structuredContent: { told?: string; data: unknown };
  };
  error?: { message: string };
};

// A workstream on checkout, another, and two tools, one trusted in the
// first. Turns follow `plan` over `scripts`.
async function world(
  t: TestContext,
  options: TestOptions & { trust?: Partial<Trust>; scripts?: Record<string, Script> } = {},
  plan: (text: string) => Step[] = () => [{ text: "Hello." }],
) {
  const app = await testApp(t, { ...options, plan: (input) => plan(input.text) });
  const { id: workstream } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: elsewhere } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Other", items: ["jira:SYN-74"] }),
  );
  const { tools } = app.app.outside;
  const trust: Trust = {
    workstreams: [workstream as Ulid],
    turnsPerDay: 5,
    tokensPerDay: 10_000,
    ...options.trust,
  };
  const trusted = tools.connect("Claude Code", "act", trust).tool;
  const other = tools.connect("Codex", "act").tool;
  // Each wait's timeout, which a test lets pass.
  const timeouts = new Set<() => void>();
  const server = mcpServer({
    outside: app.app.outside,
    window: new URL("http://127.0.0.1:4310/"),
    version: "test",
    clock: () => Date.UTC(2026, 10, 6),
    tasks: true,
    later: (_ms, then) => {
      if (expired) queueMicrotask(then);
      else timeouts.add(then);
      return () => timeouts.delete(then);
    },
  });
  // From now on, every wait's timeout passes at once.
  let expired = false;
  const expire = () => {
    expired = true;
    for (const then of timeouts) then();
  };
  let id = 0;
  const call = async (
    by: typeof trusted,
    method: string,
    params: Record<string, unknown>,
    caps = {},
  ) =>
    (await server.handle(
      {
        jsonrpc: "2.0",
        id: ++id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": modern,
            "io.modelcontextprotocol/clientCapabilities": caps,
          },
        },
      },
      by,
      modern,
    )) as unknown as Called;
  const tool = (by: typeof trusted, name: string, args: Record<string, unknown>, caps = {}) =>
    call(by, "tools/call", { name, arguments: args }, caps);
  const data = <T>(called: Called) => called.result.structuredContent.data as T;
  // What an action answered: Oriel's own, not data.
  const acted = <T>(called: Called) => called.result.structuredContent as unknown as T;
  const open = async (by = trusted, on = workstream) =>
    acted<{ thread: string }>(await tool(by, "thread_open", { workstream: on })).thread;
  const say = async (by: typeof trusted, thread: string, text: string) =>
    acted<{ started?: true; held?: true; why?: string; cursor: string }>(
      await tool(by, "thread_say", { thread, text }),
    );
  const view = async (thread: string) => json<ThreadView>(await app.get(`/api/threads/${thread}`));
  return {
    ...app,
    workstream,
    elsewhere,
    trusted,
    other,
    server,
    tool,
    call,
    data,
    open,
    say,
    view,
    expire,
  };
}

test("a trusted tool's words start a turn under its name; elsewhere, or untrusted, they wait", async (t) => {
  const seen: string[] = [];
  const app = await world(t, {}, (text) => {
    seen.push(text);
    return [{ text: "On it." }];
  });
  const thread = await app.open();
  assert.deepEqual(
    await app.say(app.trusted, thread, "Which stories lack estimates?").then((s) => s.started),
    true,
  );
  await app.app.settled();
  const entries = (await app.view(thread)).entries;
  assert.deepEqual(
    entries.map((each) => each.kind),
    ["user", "text", "done"],
  );
  // Shown as the tool's, and the agent reads who said it.
  assert.equal(entries[0]?.kind === "user" && entries[0].by, "Claude Code");
  assert.match(seen[0] ?? "", /^"Claude Code", an outside tool the user trusts, says:/);
  // Outside its workstreams, the same tool's words wait for the user.
  const other = await app.open(app.trusted, app.elsewhere);
  const held = await app.say(app.trusted, other, "And here?");
  assert.equal(held.held, true);
  assert.match(held.why ?? "", /outside the ones the user trusts you with/);
  // An untrusted tool's words always wait.
  assert.equal((await app.say(app.other, thread, "Me too")).held, true);
  assert.equal(seen.length, 1);
});

test("a trusted tool's turn applies its intents within its workstreams, with Undo, and refuses the rest", async (t) => {
  // The other workstream, once there is one.
  let elsewhere = "";
  const app = await world(
    t,
    {
      scripts: {
        tidy: async () => ({
          intents: [
            ["workstream.remove", [{ items: ["jira:SYN-10"] }]],
            ["workstream.remove", [{ workstream: elsewhere, items: ["jira:SYN-74"] }]],
          ],
        }),
      },
    },
    () => [{ run: "tidy" }],
  );
  elsewhere = app.elsewhere;
  const thread = await app.open();
  await app.say(app.trusted, thread, "Tidy up");
  await app.app.settled();
  const lines = (await app.view(thread)).entries.flatMap((each) =>
    each.kind === "actions" ? each.lines : [],
  );
  // The tool hears what Oriel did, as the window shows it.
  const heard = app.data<ThreadNews>(await app.tool(app.trusted, "thread_wait", { thread }));
  const reply = heard.heard.find((each) => each.kind === "reply");
  assert.deepEqual(reply?.kind === "reply" && reply.actions.map((each) => each.applied), [
    true,
    false,
  ]);
  assert.deepEqual(
    lines.map((line) => [line.applied, line.applied ? line.undo !== null : line.why]),
    [
      [true, true],
      [false, "it reaches outside the workstreams you trust Claude Code with"],
    ],
  );
});

test("past its turns a day, a trusted tool's words wait, and its turns' tokens count too", async (t) => {
  const spending: Agent = {
    async *turn() {
      yield { kind: "text", text: "Spent." };
      yield { kind: "done", usage: { inputTokens: 600, outputTokens: 0 } };
    },
  };
  const app = await world(t, {
    agent: () => spending,
    trust: { turnsPerDay: 2, tokensPerDay: 1_000 },
  });
  const thread = await app.open();
  assert.equal((await app.say(app.trusted, thread, "One")).started, true);
  await app.app.settled();
  assert.equal((await app.say(app.trusted, thread, "Two")).started, true);
  await app.app.settled();
  const third = await app.say(app.trusted, thread, "Three");
  assert.equal(third.held, true);
  assert.match(third.why ?? "", /started 2 turns today/);
  assert.deepEqual(app.app.outside.tools.spent(app.trusted), { turns: 2, tokens: 1_200 });
});

test("a tool waits on its thread for the agent's answer, its change set and the user's decision", async (t) => {
  const app = await world(
    t,
    {
      writes: true,
      scripts: { estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-23", 3]]] }) },
    },
    () => [{ text: "I propose 3 points." }, { run: "estimate" }],
  );
  const thread = await app.open();
  const { cursor } = await app.say(app.trusted, thread, "Estimate SYN-23");
  const answered = app.data<ThreadNews>(
    await app.tool(app.trusted, "thread_wait", { thread, after: cursor }),
  );
  const reply = answered.heard.find(
    (each): each is Extract<Heard, { kind: "reply" }> => each.kind === "reply",
  );
  assert.equal(reply?.to, "you");
  assert.equal(reply?.text, "I propose 3 points.");
  assert.equal(reply?.changeSets.length, 1);
  assert.match(answered.waitingOn, /approve or reject/);
  // The person approves, in the window: the wait that was open hears it.
  const waiting = app.tool(app.trusted, "thread_wait", {
    thread,
    after: answered.cursor,
  });
  const [set] = reply?.changeSets ?? [];
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${set}/diff`));
  assert.equal((await app.post(`/api/change-sets/${set}/approve`, { hash })).status, 200);
  const decided = app.data<ThreadNews>(await waiting);
  const heard = decided.heard.find((each) => each.kind === "change-set");
  // It ends as the approved change lands, not before.
  assert.equal(heard?.kind === "change-set" && heard.decided?.kind, "approved");
  assert.equal(heard?.kind === "change-set" && heard.state, "applied");
  // No tool may decide one, whatever it asks.
  assert.ok((await app.tool(app.trusted, "changeset_approve", { changeSet: set, hash })).error);
});

test("a wait with nothing new ends at its timeout, saying what the thread waits on", async (t) => {
  const app = await world(t);
  const thread = await app.open(app.other);
  const { cursor } = await app.say(app.other, thread, "Anyone?");
  // Its own words held are no news to it: nothing comes until the user acts.
  const waiting = app.tool(app.other, "thread_wait", { thread, after: cursor });
  app.expire();
  const second = await waiting;
  const news = app.data<ThreadNews & { timedOut: boolean }>(second);
  assert.equal(news.timedOut, true);
  assert.match(news.waitingOn, /send your words on/);
  assert.match(second.result.content[0]?.text ?? "", /^Nothing new yet\. .*come back later/);
});

test("a client that takes tasks gets one for a wait, which completes once there is news", async (t) => {
  const app = await world(
    t,
    {
      writes: true,
      scripts: { estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-23", 3]]] }) },
    },
    () => [{ run: "estimate" }],
  );
  const thread = await app.open();
  const { cursor } = await app.say(app.trusted, thread, "Estimate SYN-23");
  await app.app.settled();
  const now = app.data<ThreadNews>(
    await app.tool(app.trusted, "thread_wait", { thread, after: cursor }),
  );
  const task = await app.tool(app.trusted, "thread_wait", { thread, after: now.cursor }, tasks);
  assert.equal(task.result.resultType, "task");
  assert.equal(task.result.status, "working");
  const polled = await app.call(app.trusted, "tasks/get", { taskId: task.result.taskId });
  assert.equal(polled.result.status, "working");
  // Another tool can't read it.
  assert.ok((await app.call(app.other, "tasks/get", { taskId: task.result.taskId })).error);
  const set = (await app.view(thread)).changeSets[0]?.id;
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${set}/diff`));
  await app.post(`/api/change-sets/${set}/reject`, { hash });
  const done = (await app.call(app.trusted, "tasks/get", {
    taskId: task.result.taskId,
  })) as unknown as {
    result: { status: string; result: Called["result"] };
  };
  assert.equal(done.result.status, "completed");
  const news = done.result.result.structuredContent.data as ThreadNews;
  assert.ok(news.heard.some((each) => each.kind === "change-set" && each.state === "rejected"));
  // Without tasks in the request's own capabilities, the same call waits.
  const plain = await app.tool(app.trusted, "thread_wait", {
    thread,
    after: news.cursor,
    seconds: 0,
  });
  assert.equal(plain.result.resultType, "complete");
});

test("two tools in one thread: one turn at a time, each told whose, and each answer says whom it answers", async (t) => {
  const release = Promise.withResolvers<void>();
  const slow: Agent = {
    async *turn() {
      await release.promise;
      yield { kind: "text", text: "Answered." };
      yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  const app = await world(t, { agent: () => slow });
  app.app.outside.tools.revoke(app.other.id);
  const codex = app.app.outside.tools.connect("Codex", "act", {
    workstreams: [app.workstream as Ulid],
    turnsPerDay: 5,
    tokensPerDay: 10_000,
  }).tool;
  const thread = await app.open();
  const { cursor } = await app.say(app.trusted, thread, "First");
  const busy = await app.tool(codex, "thread_say", { thread, text: "Second" });
  assert.match(
    busy.result.content[0]?.text ?? "",
    /a turn is running in this thread \(Claude Code\)/,
  );
  release.resolve();
  await app.app.settled();
  assert.equal((await app.say(codex, thread, "Second")).started, true);
  await app.app.settled();
  const heard = app.data<ThreadNews>(
    await app.tool(codex, "thread_wait", { thread, after: cursor }),
  ).heard;
  assert.deepEqual(
    heard.flatMap((each) =>
      each.kind === "reply" ? [each.to] : each.kind === "asked" ? [`asked by ${each.by}`] : [],
    ),
    ["asked by Claude Code", "Claude Code", "asked by you", "you"],
  );
  const entries = (await app.view(thread)).entries.flatMap((each) =>
    each.kind === "user" ? [each.by] : [],
  );
  assert.deepEqual(entries, ["Claude Code", "Codex"]);
});

test("revoking a trusted tool stops the turn it started", async (t) => {
  const started = Promise.withResolvers<void>();
  const waits: Agent = {
    async *turn(_input, { signal }) {
      started.resolve();
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  const app = await world(t, { agent: () => waits });
  const thread = await app.open();
  await app.say(app.trusted, thread, "Take your time");
  await started.promise;
  app.app.outside.tools.revoke(app.trusted.id);
  await app.app.settled();
  const view = await app.view(thread);
  assert.equal(view.running, false);
  assert.ok(view.entries.some((each) => each.kind === "error"));
});

test("a wait from a client that takes a stream sends progress until its answer, which keeps a timeout open", async (t) => {
  const app = await world(t);
  const connected = app.app.outside.tools.connect("Streamer", "act");
  const thread = await app.open();
  const { cursor } = await app.say(app.trusted, thread, "Hello");
  await app.app.settled();
  const now = app.data<ThreadNews>(
    await app.tool(app.trusted, "thread_wait", { thread, after: cursor }),
  );
  // Each beat, sent when the test says, as a timer's would be.
  let beat = () => {};
  const handle = mcpHandler({
    server: app.server,
    tools: app.app.outside.tools,
    port: 4319,
    progress: (send) => {
      beat = send;
      return () => {};
    },
  });
  const params = {
    name: "thread_wait",
    arguments: { thread, after: now.cursor },
    _meta: { "io.modelcontextprotocol/protocolVersion": modern, progressToken: 7 },
  };
  const reply = await handle({
    method: "POST",
    url: "/mcp",
    headers: {
      host: "127.0.0.1:4319",
      authorization: `Bearer ${connected.token}`,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": modern,
      "mcp-method": "tools/call",
      "mcp-name": "thread_wait",
    },
    body: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }),
  });
  assert.equal(reply.headers["content-type"], "text/event-stream");
  assert.ok(reply.stream);
  const events = reply.stream[Symbol.asyncIterator]();
  beat();
  assert.match(String((await events.next()).value), /"notifications\/progress".*"progressToken":7/);
  app.expire();
  assert.match(String((await events.next()).value), /"id":1,"result"/);
  assert.equal((await events.next()).done, true);
});
