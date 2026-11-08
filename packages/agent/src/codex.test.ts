// The Codex harness against a stand-in for `codex app-server` that speaks its
// JSON-RPC over stdin and stdout: how it is started and locked down, what
// the thread start is checked for, how a turn's `run` calls are answered,
// and that every other request is declined. The real Codex is only in
// codex.live.test.ts, behind an opt-in flag.
import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { historyCallId, type Spawn } from "./claude-code.ts";
import {
  checkLoaded,
  checkStarted,
  codexAnswer,
  codexArgs,
  codexEnv,
  codexFeaturesOff,
  codexProvider,
  codexServers,
  codexServersOf,
  threadConfig,
} from "./codex.ts";
import { runTool, systemPrompt, threadMessages } from "./prompt.ts";
import { type ConversationRequest, type ModelEvent, ProviderError } from "./provider.ts";
import { thread } from "./testing.ts";

type Message = Record<string, unknown>;

const cli = { path: "/opt/codex", version: "0.166.0" };
const home = "/Users/maya/.codex";

// One step of a turn as Codex plays it: text the model streams, a `run` call
// it waits on, a request of Oriel's it waits on, an item it starts, or its
// running token count.
type Step =
  | { text: string }
  | { call: string; script: string }
  | { asks: string }
  | { item: string }
  | { usage: { input: number; output: number; cached?: number } };

type FakeOptions = {
  steps?: Step[];
  // How the turn ends.
  status?: "completed" | "failed";
  // What `thread/start` reports, over a good report.
  started?: Message;
  // The person's MCP servers and skills, as `config/read` and `skills/list`
  // say; `live`: a server the thread left on anyway.
  servers?: string[];
  skills?: string[];
  live?: boolean;
  hooks?: number;
  account?: Message | null;
  limits?: Message;
};

type Spawned = {
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  // Every request Oriel sent, by method.
  requests: Map<string, Message>;
  // Oriel's answer to each request of Codex's, by its method and ID.
  answers: { method: string; answer: Message }[];
  killed: boolean;
};

function fakeCodex(options: FakeOptions = {}) {
  const spawned: Spawned[] = [];
  const spawn: Spawn = (_command, args, { cwd, env }) => {
    const run: Spawned = { args, env, cwd, requests: new Map(), answers: [], killed: false };
    spawned.push(run);
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill(signal?: string): boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let exited = false;
    const emit = (message: Message) => {
      if (!exited) child.stdout.write(`${JSON.stringify(message)}\n`);
    };
    const note = (method: string, params: Message) => emit({ method, params });
    let asked = 1000;
    const waiting = new Map<number, (answer: Message) => void>();
    const ask = (method: string, params: Message) =>
      new Promise<Message>((resolve) => {
        const id = ++asked;
        waiting.set(id, (answer) => {
          run.answers.push({ method, answer });
          resolve(answer);
        });
        emit({ id, method, params });
      });
    const servers = options.servers ?? [];
    const play = async () => {
      let total = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      for (const step of options.steps ?? []) {
        if ("text" in step) {
          note("item/started", { item: { type: "agentMessage", id: "m", text: "" } });
          note("item/agentMessage/delta", { itemId: "m", delta: step.text });
          note("item/completed", { item: { type: "agentMessage", id: "m", text: step.text } });
        } else if ("call" in step) {
          const params = { tool: "run", namespace: null, arguments: { script: step.script } };
          note("item/started", { item: { type: "dynamicToolCall", id: step.call, ...params } });
          await ask("item/tool/call", {
            threadId: "t",
            turnId: "turn_1",
            callId: step.call,
            ...params,
          });
        } else if ("asks" in step) await ask(step.asks, { threadId: "t", itemId: "i" });
        else if ("item" in step) note("item/started", { item: { type: step.item, id: "x" } });
        else {
          total = {
            inputTokens: total.inputTokens + step.usage.input,
            outputTokens: total.outputTokens + step.usage.output,
            cachedInputTokens: total.cachedInputTokens + (step.usage.cached ?? 0),
          };
          note("thread/tokenUsage/updated", { tokenUsage: { total, last: total } });
        }
      }
      note("turn/completed", {
        turn: {
          id: "turn_1",
          status: options.status ?? "completed",
          error: options.status === "failed" ? { message: "You've hit your usage limit." } : null,
        },
      });
    };
    const answer = (method: string, params: Message): unknown => {
      switch (method) {
        case "initialize":
          return { codexHome: home, userAgent: "codex", platformFamily: "unix" };
        case "config/read":
          return { config: { mcp_servers: Object.fromEntries(servers.map((s) => [s, {}])) } };
        case "skills/list":
          return {
            data: [
              { cwd, skills: (options.skills ?? []).map((path) => ({ path, enabled: true })) },
            ],
          };
        case "thread/start":
          return {
            thread: { id: "t" },
            model: String(params.model),
            cwd,
            instructionSources: [],
            approvalPolicy: "untrusted",
            approvalsReviewer: "user",
            sandbox: { type: "readOnly", networkAccess: false },
            ...options.started,
          };
        case "mcpServerStatus/list":
          return {
            data: servers.map((name) => ({
              name,
              runtimeStatus: options.live ? "ready" : "disabled",
            })),
            nextCursor: null,
          };
        case "hooks/list":
          return {
            data: [{ cwd, hooks: Array.from({ length: options.hooks ?? 0 }, () => ({})) }],
          };
        case "turn/start":
          void play();
          return { turn: { id: "turn_1", status: "inProgress" } };
        case "account/read":
          return {
            account:
              options.account === undefined
                ? { type: "chatgpt", email: "maya@example.com", planType: "plus" }
                : options.account,
          };
        case "model/list":
          return {
            data: [
              { model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", hidden: false, isDefault: true },
              { model: "gpt-hidden", displayName: "Hidden", hidden: true, isDefault: false },
            ],
          };
        case "account/rateLimits/read":
          return options.limits ?? {};
        default:
          return {};
      }
    };
    child.stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        for (const line of String(chunk).split("\n").filter(Boolean)) {
          const message = JSON.parse(line) as Message;
          if (typeof message.method === "string") {
            if (message.id === undefined) continue; // A notification.
            run.requests.set(message.method, (message.params ?? {}) as Message);
            emit({
              id: message.id,
              result: answer(message.method, (message.params ?? {}) as Message),
            });
          } else if (typeof message.id === "number") waiting.get(message.id)?.(message);
        }
        callback();
      },
    });
    child.kill = () => {
      run.killed = true;
      if (!exited) {
        exited = true;
        child.stdout.end();
        setImmediate(() => child.emit("close", 143));
      }
      return true;
    };
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { spawn, spawned };
}

const runSpec = runTool("declare const jira: {};\n");

function request(messages = threadMessages([], "Which stories have no owner?")) {
  const controller = new AbortController();
  const logged: string[] = [];
  const req: ConversationRequest = {
    system: systemPrompt,
    tools: [runSpec],
    messages,
    signal: controller.signal,
    log: (message) => logged.push(message),
  };
  return { req, controller, logged };
}

async function collect(stream: AsyncIterable<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const closed = (run: Spawned | undefined) =>
  new Promise<void>((resolve) => {
    const check = () =>
      run && run.killed && !existsSync(run.cwd) ? resolve() : setImmediate(check);
    check();
  });

const provider = (fake: ReturnType<typeof fakeCodex>) =>
  codexProvider({ cli, model: "gpt-6.1-sol", spawn: fake.spawn, env: {} });

test("the command line turns off every feature that gives a tool, and the person's extras", () => {
  const args = codexArgs();
  assert.equal(args[0], "app-server");
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "view_image",
    "multi_agent",
    "apps",
    "plugins",
    "hooks",
    "memories",
    "browser_use",
    "computer_use",
    "image_generation",
    "goals",
    "mentions_v2",
  ])
    assert.ok(codexFeaturesOff.includes(feature as never), feature);
  for (const feature of codexFeaturesOff)
    assert.ok(args.join(" ").includes(`--disable ${feature}`));
  // Code mode's host stays: today's models reach `run` only through it.
  assert.ok(!args.includes("code_mode_host"));
  for (const setting of [
    'web_search="disabled"',
    "project_doc_max_bytes=0",
    "skills.include_instructions=false",
    "skills.bundled.enabled=false",
    "notify=[]",
    'developer_instructions=""',
    'history.persistence="none"',
    'shell_environment_policy.inherit="none"',
    // Nothing of the run goes to OpenAI beyond the model's own requests: no
    // analytics, and no `/feedback` submissions.
    "analytics.enabled=false",
    "feedback.enabled=false",
  ])
    assert.ok(args.includes(setting), setting);
});

test("the environment passes the person's Codex home and nothing that would steer it", () => {
  const env = codexEnv({
    HOME: "/Users/maya",
    PATH: "/usr/bin",
    CODEX_HOME: "/Users/maya/.codex",
    OPENAI_API_KEY: "sk-nope",
    OPENAI_BASE_URL: "https://elsewhere",
    CLAUDE_CONFIG_DIR: "/Users/maya/.claude",
    RUST_LOG: "trace",
  });
  assert.deepEqual(env, {
    HOME: "/Users/maya",
    PATH: "/usr/bin",
    CODEX_HOME: "/Users/maya/.codex",
  });
});

test("every command, file change, elicitation and question Codex asks to make is declined", () => {
  assert.deepEqual(codexAnswer("item/commandExecution/requestApproval"), {
    result: { decision: "decline" },
  });
  assert.deepEqual(codexAnswer("item/fileChange/requestApproval"), {
    result: { decision: "decline" },
  });
  for (const legacy of ["execCommandApproval", "applyPatchApproval"]) {
    const answer = codexAnswer(legacy);
    assert.ok("result" in answer);
    assert.ok("denied" in ((answer.result as Message).decision as Message));
  }
  assert.deepEqual(codexAnswer("mcpServer/elicitation/request"), {
    result: { action: "decline", content: null, _meta: null },
  });
  for (const method of [
    "item/tool/requestUserInput",
    "item/permissions/requestApproval",
    "account/chatgptAuthTokens/refresh",
    "anything/new",
  ])
    assert.ok("error" in codexAnswer(method), method);
});

test("earlier turns arrive as one run result before the new message, never as user text", async () => {
  const fake = fakeCodex({ steps: [{ text: "Still none." }] });
  const history = threadMessages(
    [
      { role: "user", text: "Which stories have no owner?", at: thread.createdAt },
      { role: "assistant", text: "Two: [[jira:ORL-1]] and [[jira:ORL-2]].", at: thread.createdAt },
    ],
    "And now?",
  );
  const { req } = request(history);
  await collect(provider(fake).converse(req).next([], { maxOutputTokens: 8000 }));
  const run = fake.spawned[0];
  const items = (run?.requests.get("thread/inject_items")?.items ?? []) as Message[];
  assert.deepEqual(
    items.map((i) => [i.type, i.call_id]),
    [
      ["function_call", historyCallId],
      ["function_call_output", historyCallId],
    ],
  );
  assert.ok(String(items[1]?.output).includes("Which stories have no owner?"));
  const input = run?.requests.get("turn/start")?.input as Message[];
  assert.deepEqual(input, [{ type: "text", text: "And now?", text_elements: [] }]);
});

test("a tool Oriel thought was off stops the turn the moment Codex starts it", async () => {
  for (const item of [
    "commandExecution",
    "mcpToolCall",
    "webSearch",
    "collabAgentToolCall",
    "imageView",
  ]) {
    const fake = fakeCodex({ steps: [{ item }, { text: "done" }] });
    const { req } = request();
    await assert.rejects(
      collect(provider(fake).converse(req).next([], { maxOutputTokens: 8000 })),
      (error: unknown) => error instanceof ProviderError,
      item,
    );
    await closed(fake.spawned[0]);
  }
});

test("a thread start that isn't what Oriel asked for is stopped before the model acts", async () => {
  const cases: FakeOptions[] = [
    { started: { sandbox: { type: "dangerFullAccess" } } },
    { started: { sandbox: { type: "readOnly", networkAccess: true } } },
    { started: { approvalPolicy: "never" } },
    { started: { approvalsReviewer: "auto_review" } },
    { started: { cwd: "/Users/maya/work" } },
    { started: { instructionSources: ["/Users/maya/work/AGENTS.md"] } },
    { servers: ["github"], live: true },
    { hooks: 1 },
  ];
  for (const options of cases) {
    const why = JSON.stringify(options);
    const fake = fakeCodex({ ...options, steps: [{ text: "Hello" }] });
    const { req } = request();
    await assert.rejects(
      collect(provider(fake).converse(req).next([], { maxOutputTokens: 8000 })),
      (error: unknown) => error instanceof ProviderError,
      why,
    );
    // No turn was ever started.
    assert.equal(fake.spawned[0]?.requests.has("turn/start"), false, why);
    await closed(fake.spawned[0]);
  }
  // The person's own AGENTS.md, in Codex's home, is theirs to keep.
  assert.equal(
    checkStarted(
      {
        sandbox: { type: "readOnly", networkAccess: false },
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        cwd: "/tmp/x",
        instructionSources: [`${home}/AGENTS.md`],
      },
      "/tmp/x",
      home,
    ),
    null,
  );
  assert.equal(checkLoaded({ data: [] }, { data: [{ hooks: [] }] }), null);
  // A Codex that doesn't say what it loaded is refused.
  assert.notEqual(checkLoaded({}, { data: [] }), null);
});

test("the thread's settings turn off each MCP server and skill Codex reports, by name", () => {
  assert.deepEqual(threadConfig({ config: {} }, { data: [] }), {});
  assert.deepEqual(
    threadConfig(
      { config: { mcp_servers: { a: {}, "b-c": {} } } },
      {
        data: [
          { skills: [{ path: "/s/one/SKILL.md" }] },
          { skills: [{ path: "/s/two/SKILL.md" }] },
        ],
      },
    ),
    {
      "mcp_servers.a.enabled": false,
      "mcp_servers.b-c.enabled": false,
      "skills.config": [
        { path: "/s/one/SKILL.md", enabled: false },
        { path: "/s/two/SKILL.md", enabled: false },
      ],
    },
  );
});

test("the person's servers carry none of their secrets, and listing them starts no thread or model request", async () => {
  const listed = {
    data: [
      {
        name: "work-tracker",
        runtimeStatus: null,
        serverInfo: { name: "example-tracker", version: "1" },
        tools: { search_issues: { name: "search_issues" }, get_issue: { name: "get_issue" } },
        toolsError: null,
        authStatus: "unsupported",
      },
      { name: "signed-out", serverInfo: null, tools: { x: {} }, authStatus: "notLoggedIn" },
      { name: "off", runtimeStatus: "disabled", tools: {} },
    ],
    nextCursor: null,
  };
  const effective = {
    config: {
      mcp_servers: {
        "work-tracker": { command: "tracker-mcp", args: ["--stdio"], env: { TOKEN: "secret" } },
        "signed-out": { url: "https://mcp.example.invalid/v1", bearer_token_env_var: "T" },
      },
    },
  };
  const said = JSON.stringify(codexServersOf([listed], effective));
  assert.ok(said.includes("work-tracker"));
  assert.ok(!said.includes("secret"));

  const fake = fakeCodex({ servers: ["work-tracker"], live: true });
  const found = await codexServers(cli, { env: {}, spawn: fake.spawn });
  assert.equal(found.length, 1);
  const [run] = fake.spawned;
  assert.ok(!run?.requests.has("thread/start") && !run?.requests.has("turn/start"));
});
