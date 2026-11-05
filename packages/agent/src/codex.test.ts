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
  accountOf,
  checkCodex,
  checkLoaded,
  checkStarted,
  codexAnswer,
  codexArgs,
  codexEnv,
  codexFeaturesOff,
  codexPlan,
  codexPlanOf,
  codexProvider,
  codexTitler,
  codexVersion,
  modelsOf,
  supportedCodex,
  threadConfig,
} from "./codex.ts";
import { agent } from "./loop.ts";
import { runTool, systemPrompt, threadMessages } from "./prompt.ts";
import { type ConversationRequest, type ModelEvent, ProviderError } from "./provider.ts";
import { fixtureRegion, harness, kinds, regionBindings, thread } from "./testing.ts";
import { titlePrompt } from "./title.ts";

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

test("only a 0.x at or past the verified version is supported", () => {
  assert.deepEqual(codexVersion("codex-cli 0.166.0\n"), [0, 166, 0]);
  assert.equal(codexVersion("codex"), null);
  assert.ok(supportedCodex([0, 166, 0]));
  assert.ok(supportedCodex([0, 170, 2]));
  assert.ok(!supportedCodex([0, 165, 9]));
  assert.ok(!supportedCodex([1, 0, 0]));
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

test("a turn: Oriel's prompt in place of Codex's, one run answered from the loop, then the answer", async () => {
  const fake = fakeCodex({
    servers: ["github", "jira-mcp"],
    skills: ["/Users/maya/.codex/skills/deploy/SKILL.md"],
    steps: [
      { call: "call_1", script: "return 1" },
      { usage: { input: 900, output: 40, cached: 100 } },
      { text: "Two stories have no owner." },
      { usage: { input: 1000, output: 20 } },
    ],
  });
  const counted: [number, boolean][] = [];
  const { req, logged } = request();
  const conversation = codexProvider({
    cli,
    model: "gpt-6.1-sol",
    spawn: fake.spawn,
    env: { HOME: "/Users/maya", OPENAI_API_KEY: "sk-nope" },
    counted: (used, first) => counted.push([used.outputTokens, first]),
  }).converse(req);
  const first = await collect(conversation.next([], { maxOutputTokens: 8000 }));
  assert.deepEqual(first[0], {
    kind: "call",
    call: { id: "call_1", name: "run", input: { script: "return 1" } },
  });
  // Codex counts this response only after the call is answered: until then,
  // an estimate from the request's size, so the thread's cap holds.
  const estimated = first[1];
  assert.ok(estimated?.kind === "end" && estimated.stop === "calls");
  assert.ok(estimated.usage.inputTokens > runSpec.description.length / 8);
  const run = fake.spawned[0];
  const started = run?.requests.get("thread/start") ?? {};
  assert.equal(started.baseInstructions, systemPrompt);
  assert.equal(started.developerInstructions, "");
  assert.equal(started.sandbox, "read-only");
  assert.equal(started.approvalPolicy, "untrusted");
  assert.equal(started.ephemeral, true);
  assert.equal(started.cwd, run?.cwd);
  assert.deepEqual(started.config, {
    "mcp_servers.github.enabled": false,
    "mcp_servers.jira-mcp.enabled": false,
    "skills.config": [{ path: "/Users/maya/.codex/skills/deploy/SKILL.md", enabled: false }],
  });
  assert.deepEqual(started.dynamicTools, [
    {
      type: "function",
      name: "run",
      description: runSpec.description,
      inputSchema: runSpec.inputSchema,
    },
  ]);
  // The person's message as the turn's only input, at Oriel's effort.
  assert.deepEqual(run?.requests.get("turn/start"), {
    threadId: "t",
    input: [{ type: "text", text: "Which stories have no owner?", text_elements: [] }],
    effort: "medium",
  });
  assert.equal(run?.env.OPENAI_API_KEY, undefined);

  const second = await collect(
    conversation.next([{ callId: "call_1", content: "Returned: 2", isError: false }], {
      maxOutputTokens: 8000,
    }),
  );
  assert.deepEqual(run?.answers, [
    {
      method: "item/tool/call",
      answer: {
        id: 1001,
        result: { contentItems: [{ type: "inputText", text: "Returned: 2" }], success: true },
      },
    },
  ]);
  const end = second.at(-1);
  assert.equal(second.find((e) => e.kind === "text")?.kind, "text");
  // Codex's own count adds what the estimate missed: both responses' tokens,
  // each counted once.
  assert.ok(end?.kind === "end" && end.stop === "done");
  assert.equal(estimated.usage.inputTokens + end.usage.inputTokens, 1900);
  assert.equal(estimated.usage.outputTokens + end.usage.outputTokens, 60);
  assert.equal(end.usage.cacheReadTokens, 100);
  assert.deepEqual(
    counted.map(([, first]) => first),
    [true, false],
  );
  assert.ok(logged.includes("harness.ready"));
  await closed(run);
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
  assert.match(String(items[1]?.output), /\{"user":"Which stories have no owner\?"\}/);
  const input = run?.requests.get("turn/start")?.input as Message[];
  assert.deepEqual(input, [{ type: "text", text: "And now?", text_elements: [] }]);
});

test("Codex's own file changes and questions are declined, and the turn goes on", async () => {
  const fake = fakeCodex({
    steps: [
      { item: "fileChange" },
      { asks: "item/fileChange/requestApproval" },
      { asks: "item/tool/requestUserInput" },
      { text: "I can't change files." },
    ],
  });
  const { req, logged } = request();
  const events = await collect(provider(fake).converse(req).next([], { maxOutputTokens: 8000 }));
  assert.equal(events.at(-1)?.kind, "end");
  assert.deepEqual(
    fake.spawned[0]?.answers.map((a) => [a.method, a.answer.result ?? "error"]),
    [
      ["item/fileChange/requestApproval", { decision: "decline" }],
      ["item/tool/requestUserInput", "error"],
    ],
  );
  assert.equal(logged.filter((m) => m === "harness.declined").length, 2);
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
      (error: unknown) =>
        error instanceof ProviderError &&
        error.message.startsWith(`Oriel stopped Codex: it started a ${item} item`),
      item,
    );
    await closed(fake.spawned[0]);
  }
});

test("a thread start that isn't what Oriel asked for is stopped before the model acts", async () => {
  const cases: [FakeOptions, RegExp][] = [
    [{ started: { sandbox: { type: "dangerFullAccess" } } }, /sandbox isn't read-only/],
    [
      { started: { sandbox: { type: "readOnly", networkAccess: true } } },
      /sandbox isn't read-only/,
    ],
    [{ started: { approvalPolicy: "never" } }, /doesn't ask Oriel/],
    [{ started: { approvalsReviewer: "auto_review" } }, /doesn't ask Oriel/],
    [{ started: { cwd: "/Users/maya/work" } }, /isn't in Oriel's empty folder/],
    [
      { started: { instructionSources: ["/Users/maya/work/AGENTS.md"] } },
      /outside the person's Codex home/,
    ],
    [{ servers: ["github"], live: true }, /loaded an MCP server/],
    [{ hooks: 1 }, /loaded hooks/],
  ];
  for (const [options, why] of cases) {
    const fake = fakeCodex({ ...options, steps: [{ text: "Hello" }] });
    const { req } = request();
    await assert.rejects(
      collect(provider(fake).converse(req).next([], { maxOutputTokens: 8000 })),
      (error: unknown) => error instanceof ProviderError && why.test(error.message),
      String(why),
    );
    // No turn was ever started.
    assert.equal(fake.spawned[0]?.requests.has("turn/start"), false, String(why));
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
  assert.match(checkLoaded({}, { data: [] }) ?? "", /didn't say/);
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

test("a response past what the thread's tokens leave is cut off and counted as reaching it", async () => {
  const fake = fakeCodex({ steps: [{ text: "x".repeat(4000) }, { text: "never" }] });
  const { req } = request();
  const events = await collect(provider(fake).converse(req).next([], { maxOutputTokens: 100 }));
  const end = events.at(-1);
  assert.ok(end?.kind === "end");
  assert.equal(end.stop, "max-tokens");
  assert.equal(end.usage.outputTokens, 100);
  assert.equal(fake.spawned[0]?.requests.has("turn/interrupt"), true);
  await closed(fake.spawned[0]);
});

test("Codex's own failure ends the turn with what it said", async () => {
  const fake = fakeCodex({ status: "failed" });
  const { req } = request();
  await assert.rejects(
    collect(provider(fake).converse(req).next([], { maxOutputTokens: 8000 })),
    /Codex stopped: You've hit your usage limit\./,
  );
});

test("an abort stops the process and rejects with the signal's reason", async () => {
  const fake = fakeCodex({ steps: [{ call: "call_1", script: "return 1" }] });
  const { req, controller } = request();
  const conversation = provider(fake).converse(req);
  await collect(conversation.next([], { maxOutputTokens: 8000 }));
  controller.abort(new Error("stop"));
  await assert.rejects(collect(conversation.next([], { maxOutputTokens: 8000 })), /stop/);
  await closed(fake.spawned[0]);
});

test("a title: the title prompt in place of Codex's, no tool, low effort, the message as input", async () => {
  const fake = fakeCodex({
    steps: [{ text: "Unowned checkout stories" }, { usage: { input: 50, output: 5 } }],
  });
  const used: number[] = [];
  const title = await codexTitler({
    cli,
    model: "gpt-6.1-sol",
    spawn: fake.spawn,
    env: {},
    counted: (u) => used.push(u.inputTokens),
  })("Which checkout stories have nobody on them?", {
    signal: new AbortController().signal,
    log: () => {},
  });
  assert.equal(title, "Unowned checkout stories");
  const run = fake.spawned[0];
  assert.equal(run?.requests.get("thread/start")?.baseInstructions, titlePrompt);
  assert.deepEqual(run?.requests.get("thread/start")?.dynamicTools, []);
  assert.equal(run?.requests.get("turn/start")?.effort, "low");
  assert.deepEqual(used, [50]);
  await closed(run);
});

test("the startup check: found, a supported version, then signed in, with its models", async () => {
  const fake = fakeCodex();
  const ok = await checkCodex({
    path: "/bin/sh",
    env: {},
    version: async () => "codex-cli 0.166.0",
    spawn: fake.spawn,
  });
  assert.ok(ok.ok);
  assert.deepEqual(ok.models, [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", isDefault: true }]);
  assert.deepEqual(ok.account, {
    plan: "ChatGPT Plus",
    email: "maya@example.com",
    personal: true,
  });
  // No thread, so no model request.
  assert.equal(fake.spawned[0]?.requests.has("thread/start"), false);

  const old = await checkCodex({
    path: "/bin/sh",
    env: {},
    version: async () => "codex-cli 0.150.0",
  });
  assert.ok(!old.ok && old.problem.kind === "unsupported");
  assert.match(old.problem.message, /Update it/);
  // One newer than Oriel checked isn't the person's to fix.
  const newer = await checkCodex({
    path: "/bin/sh",
    env: {},
    version: async () => "codex-cli 1.0.0",
  });
  assert.ok(!newer.ok && newer.problem.kind === "unsupported");
  assert.match(newer.problem.message, /newer than Oriel works with yet/);
  assert.doesNotMatch(newer.problem.message, /Update it/);
  const out = await checkCodex({
    path: "/bin/sh",
    env: {},
    version: async () => "codex-cli 0.166.0",
    spawn: fakeCodex({ account: null }).spawn,
  });
  assert.ok(!out.ok && out.problem.kind === "signed-out");
  const none = await checkCodex({ path: "/nowhere/codex", env: {} });
  assert.ok(!none.ok && none.problem.kind === "missing");
});

test("a ChatGPT plan is personal unless it's a Business, Enterprise or Edu one", () => {
  const personal = (planType: string) =>
    accountOf({ account: { type: "chatgpt", email: "a@b.co", planType } })?.personal;
  for (const plan of ["free", "go", "plus", "pro", "unknown", ""])
    assert.equal(personal(plan), true);
  for (const plan of ["team", "business", "enterprise", "edu"]) assert.equal(personal(plan), false);
});

test("the account, the models and the plan's windows, as numbers and names only", async () => {
  assert.deepEqual(accountOf({ account: { type: "chatgpt", email: "a@b.co", planType: "pro" } }), {
    plan: "ChatGPT Pro",
    email: "a@b.co",
    personal: true,
  });
  assert.deepEqual(accountOf({ account: { type: "apiKey" } }), {
    plan: null,
    email: null,
    personal: false,
  });
  assert.equal(accountOf({ account: null }), null);
  assert.deepEqual(modelsOf({ data: [{ model: "m", displayName: "", hidden: false }] }), [
    { id: "m", label: "m", isDefault: false },
  ]);
  const limits = {
    rateLimits: {
      primary: { usedPercent: 26.4, windowDurationMins: 10080, resetsAt: 1794285053 },
      secondary: { usedPercent: 3, windowDurationMins: 300, resetsAt: null },
      credits: { balance: "0" },
    },
    accountId: "acct",
  };
  assert.deepEqual(codexPlanOf(limits), {
    windows: [
      { kind: "session", usedPercent: 3, resetsAt: null },
      { kind: "week", usedPercent: 26, resetsAt: new Date(1794285053 * 1000).toISOString() },
    ],
  });
  assert.deepEqual(codexPlanOf({}), { none: "no-plan" });
  assert.deepEqual(
    await codexPlan(cli, { env: {}, spawn: fakeCodex({ limits }).spawn }),
    codexPlanOf(limits),
  );
});

test("through the agent loop: the run happens in Oriel's sandbox and its transcript goes back", async () => {
  const fake = fakeCodex({
    steps: [
      {
        call: "call_1",
        script:
          "const stories = await jira.listStories(); return stories.filter((s) => !s.gone).length;",
      },
      { usage: { input: 3000, output: 30 } },
      { text: "There are some stories." },
      { usage: { input: 1000, output: 10 } },
    ],
  });
  const { deps } = harness([]);
  const events = [];
  for await (const event of agent({
    ...deps,
    provider: provider(fake),
    bindingsFor: (region, threadId, shown) => regionBindings(region, threadId, shown),
  }).turn(
    {
      thread,
      region: fixtureRegion("weather-epic"),
      history: [],
      text: "How many stories?",
      snapshot: 1,
      spent: { inputTokens: 0, outputTokens: 0 },
    },
    { signal: new AbortController().signal, log: () => {} },
  ))
    events.push(event);
  assert.deepEqual(kinds(events), ["run.started", "run.finished", "text", "done"]);
  const answer = fake.spawned[0]?.answers[0]?.answer.result as {
    contentItems: { text: string }[];
  };
  assert.match(answer.contentItems[0]?.text ?? "", /^Returned: \d+/);
  assert.deepEqual(events.at(-1), { kind: "done", usage: { inputTokens: 4000, outputTokens: 40 } });
  await closed(fake.spawned[0]);
});
