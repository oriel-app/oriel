// Calls to a source server through each agent (decision 0059, OA-276),
// against fakes of Claude Code and Codex: what each process loads, what it
// must report before a call, and Oriel's permission answer, which allows
// exactly the call it asked for and fails any other. No process starts.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { WriteStalled } from "@oriel/core";
import type { Spawn } from "./claude-code.ts";
import {
  checkCallerInit,
  claudeCodeServerCalls,
  codexServerCalls,
  sameArgs,
  serverCallArgs,
  type ServerCallsOptions,
} from "./server-calls.ts";

type Message = Record<string, unknown>;

const options: ServerCallsOptions = {
  server: { name: "atlassian", url: "https://mcp.atlassian.com/v2/mcp", transport: "http" },
  tools: ["getJiraIssue", "searchJiraIssuesUsingJql"],
  others: ["editJiraIssue", "deleteJiraIssue"],
  log: () => {},
};

const init = (over: Message = {}): Message => ({
  type: "system",
  subtype: "init",
  tools: ["mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getJiraIssue"],
  mcp_servers: [{ name: "atlassian", status: "connected" }],
  permissionMode: "default",
  plugins: [],
  skills: [],
  slash_commands: [],
  ...over,
});

// What the fake model calls, for each message Oriel sends it, in order: one
// call or more, each with its tool and input.
type Turn = { tool: string; input: unknown }[];

function child(onLine: (message: Message, emit: (message: Message) => void) => void) {
  const process = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(): boolean;
  };
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  const emit = (message: Message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  process.stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of String(chunk).split("\n").filter(Boolean))
        onLine(JSON.parse(line) as Message, emit);
      callback();
    },
  });
  process.kill = () => {
    setImmediate(() => process.emit("close", 0));
    return true;
  };
  return process;
}

// A stand-in for Claude Code: reports `report` as its init, and for each
// message plays the next turn, asking Oriel's permission for each call and
// answering the ones allowed from the server.
function fakeClaude(turns: Turn[], report: Message = init()) {
  const spawned: { args: readonly string[]; env: Record<string, string>; allowed: Message[] }[] =
    [];
  const spawn: Spawn = (_command, args, { env }) => {
    const run = { args, env, allowed: [] as Message[] };
    spawned.push(run);
    const pending = new Map<string, (response: Message) => void>();
    let asked = 0;
    const proc = child((message, emit) => {
      if (message.type === "control_request") {
        const request = message.request as Message;
        if (request.subtype === "initialize")
          emit({
            type: "control_response",
            response: { subtype: "success", request_id: message.request_id, response: {} },
          });
        return;
      }
      if (message.type === "control_response") {
        const response = message.response as Message;
        pending.get(String(response.request_id))?.(response.response as Message);
        return;
      }
      if (message.type !== "user") return;
      const turn = turns.shift() ?? [];
      void (async () => {
        if (asked === 0) emit(report);
        for (const [i, call] of turn.entries()) {
          const id = `req_${++asked}`;
          const answer = new Promise<Message>((resolve) => pending.set(id, resolve));
          emit({
            type: "control_request",
            request_id: id,
            request: { subtype: "can_use_tool", tool_name: call.tool, input: call.input },
          });
          const said = await answer;
          const callId = `toolu_${asked}_${i}`;
          emit({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: callId, name: call.tool }] },
          });
          if (said.behavior !== "allow") continue;
          run.allowed.push(said);
          emit({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: callId,
                  content: [{ type: "text", text: JSON.stringify({ called: call.tool }) }],
                },
              ],
            },
          });
        }
        emit({
          type: "result",
          subtype: "success",
          is_error: false,
          total_cost_usd: 0.001,
          usage: { input_tokens: 10, output_tokens: 2 },
        });
      })();
    });
    return proc as never;
  };
  return { spawn, spawned };
}

const cli = { path: "/fake/claude", version: "2.1.314" };

test("a Claude Code process loads the one server alone, with its other tools left out", () => {
  const args = serverCallArgs(options);
  const at = (flag: string) => args[args.indexOf(flag) + 1];
  assert.ok(args.includes("--strict-mcp-config"));
  assert.deepEqual(JSON.parse(at("--mcp-config") ?? ""), {
    mcpServers: { atlassian: { type: "http", url: "https://mcp.atlassian.com/v2/mcp" } },
  });
  assert.equal(
    at("--disallowed-tools"),
    "mcp__atlassian__editJiraIssue,mcp__atlassian__deleteJiraIssue",
  );
  assert.equal(at("--setting-sources"), "");
  assert.equal(at("--tools"), "");
  assert.equal(at("--permission-mode"), "default");
  assert.equal(at("--permission-prompt-tool"), "stdio");
  assert.ok(!args.includes("--allowed-tools"), "no call is allowed ahead of Oriel's answer");
});

test("system/init must report exactly the server and the tools Oriel named", () => {
  assert.equal(checkCallerInit(init(), options), null);
  assert.match(
    checkCallerInit(
      init({ tools: [...(init().tools as string[]), "mcp__atlassian__editJiraIssue"] }),
      options,
    ) ?? "",
    /tools other than/,
  );
  assert.match(
    checkCallerInit(
      init({
        mcp_servers: [
          { name: "atlassian", status: "connected" },
          { name: "shell", status: "connected" },
        ],
      }),
      options,
    ) ?? "",
    /servers other than/,
  );
  assert.match(
    checkCallerInit(
      init({ mcp_servers: [{ name: "atlassian", status: "needs-auth" }] }),
      options,
    ) ?? "",
    /isn't connected/,
  );
});

test("Oriel allows the one call it asked for, with its own input, and reads the answer from the stream", async () => {
  const args = { cloudId: "c", issueIdOrKey: "SYN-2", fields: ["summary"] };
  // The model types the same input with its keys in another order.
  const fake = fakeClaude([
    [
      {
        tool: "mcp__atlassian__getJiraIssue",
        input: { fields: ["summary"], issueIdOrKey: "SYN-2", cloudId: "c" },
      },
    ],
  ]);
  const calls = claudeCodeServerCalls(cli, { ...options, spawn: fake.spawn });
  const answer = await calls.call({ tool: "getJiraIssue", args });
  assert.deepEqual(answer, {
    content: [{ type: "text", text: '{"called":"mcp__atlassian__getJiraIssue"}' }],
  });
  assert.deepEqual(fake.spawned[0]?.allowed, [{ behavior: "allow", updatedInput: args }]);
  assert.equal(fake.spawned[0]?.env.ENABLE_TOOL_SEARCH, "false");
  assert.equal(calls.spent().turns, 1);
  calls.close();
});

test("a call with other input is denied, and fails with nothing sent", async () => {
  const fake = fakeClaude([
    [{ tool: "mcp__atlassian__getJiraIssue", input: { cloudId: "c", issueIdOrKey: "SYN-3" } }],
  ]);
  const calls = claudeCodeServerCalls(cli, { ...options, spawn: fake.spawn });
  await assert.rejects(
    calls.call({ tool: "getJiraIssue", args: { cloudId: "c", issueIdOrKey: "SYN-2" } }),
    (error) => error instanceof WriteStalled && /with other input/.test(error.message),
  );
  assert.deepEqual(fake.spawned[0]?.allowed, []);
  calls.close();
});

test("an extra call after the one asked for is denied and fails the call, which may have landed", async () => {
  const asked = { cloudId: "c", issueIdOrKey: "SYN-2", fields: { summary: "New" } };
  const fake = fakeClaude(
    [
      [
        { tool: "mcp__atlassian__editJiraIssue", input: asked },
        { tool: "mcp__atlassian__deleteJiraIssue", input: { cloudId: "c", issueIdOrKey: "SYN-2" } },
      ],
    ],
    init({ tools: ["mcp__atlassian__editJiraIssue"] }),
  );
  const writes = { ...options, tools: ["editJiraIssue"], others: [] };
  const calls = claudeCodeServerCalls(cli, { ...writes, spawn: fake.spawn });
  await assert.rejects(
    calls.call({ tool: "editJiraIssue", args: asked }),
    (error) => !(error instanceof WriteStalled) && /deleteJiraIssue/.test((error as Error).message),
  );
  assert.equal(fake.spawned[0]?.allowed.length, 1, "only the call Oriel asked for went out");
});

test("a process that loaded something else makes no call", async () => {
  const fake = fakeClaude([[]], init({ tools: ["mcp__atlassian__getJiraIssue", "Bash"] }));
  const calls = claudeCodeServerCalls(cli, { ...options, spawn: fake.spawn });
  await assert.rejects(
    calls.call({ tool: "getJiraIssue", args: { cloudId: "c", issueIdOrKey: "SYN-2" } }),
    /tools other than/,
  );
});

test("inputs compare whatever their keys' order", () => {
  assert.ok(sameArgs({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
  assert.ok(!sameArgs({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!sameArgs([1, 2], [2, 1]));
});

// A stand-in for Codex's app server: the person has another server beside
// the source server, and `status` is what it reports of the thread's.
function fakeCodex(status: (config: Message) => Message) {
  const requests: { method: string; params: Message }[] = [];
  const spawn: Spawn = () =>
    child((message, emit) => {
      if (typeof message.method !== "string" || message.id === undefined) return;
      const params = (message.params ?? {}) as Message;
      requests.push({ method: message.method, params });
      const started = requests.find((r) => r.method === "thread/start")?.params.config as Message;
      const results: Record<string, unknown> = {
        initialize: { codexHome: "" },
        "config/read": { config: { mcp_servers: { atlassian: {}, shell: {} } } },
        "skills/list": { data: [] },
        "thread/start": { thread: { id: "thread-1" } },
        "mcpServerStatus/list": started ? status(started) : { data: [] },
        "mcpServer/tool/call": { content: [{ type: "text", text: "{}" }] },
      };
      emit({ id: message.id, result: results[message.method] ?? {} });
    }) as never;
  return { spawn, requests };
}

const codex = { path: "/fake/codex", version: "0.166.0" };

test("a Codex process enables the one server with the named tools, and calls them with no model", async () => {
  const fake = fakeCodex((config) => ({
    data: [
      {
        name: "atlassian",
        runtimeStatus: config["mcp_servers.atlassian.enabled"] ? "running" : "disabled",
        tools: Object.fromEntries(
          (config["mcp_servers.atlassian.enabled_tools"] as string[]).map((tool) => [tool, {}]),
        ),
      },
      {
        name: "shell",
        runtimeStatus: config["mcp_servers.shell.enabled"] ? "running" : "disabled",
      },
    ],
  }));
  const calls = codexServerCalls(codex, { ...options, spawn: fake.spawn });
  await calls.call({ tool: "getJiraIssue", args: { cloudId: "c", issueIdOrKey: "SYN-2" } });
  const config = fake.requests.find((r) => r.method === "thread/start")?.params.config as Message;
  assert.equal(config["mcp_servers.shell.enabled"], false);
  assert.equal(config["mcp_servers.atlassian.enabled"], true);
  assert.deepEqual(config["mcp_servers.atlassian.enabled_tools"], options.tools);
  assert.deepEqual(fake.requests.at(-1), {
    method: "mcpServer/tool/call",
    params: {
      threadId: "thread-1",
      server: "atlassian",
      tool: "getJiraIssue",
      arguments: { cloudId: "c", issueIdOrKey: "SYN-2" },
    },
  });
  assert.ok(!fake.requests.some((r) => r.method === "turn/start"), "no model runs");
  await assert.rejects(
    calls.call({ tool: "editJiraIssue", args: {} }),
    (error) => error instanceof WriteStalled,
  );
  calls.close();
});

test("a Codex process with another server on, or a tool Oriel didn't name, makes no call", async () => {
  const fake = fakeCodex(() => ({
    data: [
      {
        name: "atlassian",
        runtimeStatus: "running",
        tools: { getJiraIssue: {}, editJiraIssue: {} },
      },
      { name: "shell", runtimeStatus: "disabled" },
    ],
  }));
  const calls = codexServerCalls(codex, { ...options, spawn: fake.spawn });
  await assert.rejects(calls.call({ tool: "getJiraIssue", args: {} }), /tools Oriel didn't name/);
  assert.ok(!fake.requests.some((r) => r.method === "mcpServer/tool/call"));
});
