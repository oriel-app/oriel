import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { WriteStalled } from "@oriel/core";
import type { Spawn } from "./claude-code.ts";
import { codexServerCalls, type ServerCallsOptions } from "./server-calls.ts";

type Message = Record<string, unknown>;

const options: ServerCallsOptions = {
  server: { name: "atlassian", url: "https://mcp.atlassian.com/v2/mcp", transport: "http" },
  tools: ["getJiraIssue", "searchJiraIssuesUsingJql"],
  log: () => {},
};

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
  await assert.rejects(calls.call({ tool: "getJiraIssue", args: {} }));
  assert.ok(!fake.requests.some((r) => r.method === "mcpServer/tool/call"));
});
