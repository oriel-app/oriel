// Read tools for a sync, write tools for a replay, never both in one process; each answer goes to
// its connector's parser, never to a model.
import { type Log, type ToolCaller, WriteStalled } from "@oriel/core";
import type { ClaudeCode, Spawn } from "./claude-code.ts";
import {
  type Codex,
  codexAnswer,
  type DevServer,
  devOverrides,
  initialize,
  type Server,
  spawnCodex,
  startServer,
  threadConfig,
} from "./codex.ts";
import { ProviderError } from "./provider.ts";
import { claudeCodeToolHost, type Grant, type ToolHost } from "./tool-host.ts";

export type ServerCalls = {
  call: ToolCaller;
  close(): void;
};

export type CalledServer =
  | { name: string; url: string; transport: "http" | "sse" }
  | { name: string; dev: DevServer }
  | { name: string; local: { command: string; args: readonly string[] } }
  | { name: string };

export type ServerCallsOptions = {
  server: CalledServer;
  tools: readonly string[];
  // Those of `tools` its declaration lists as reads; the rest are writes.
  reads?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  spawn?: Spawn;
  log: Log;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export function grantOf(server: CalledServer): Grant {
  if ("url" in server) return { name: server.name, url: server.url };
  if ("dev" in server)
    return { name: server.name, command: server.dev.command, args: server.dev.args };
  if ("local" in server)
    return { name: server.name, command: server.local.command, args: server.local.args };
  throw new WriteStalled(
    `Claude Code didn't say where ${server.name} is, so Oriel can't check it before calling it.`,
  );
}

// A host that failed a call is closed and the next call opens another; a call whose run ended
// before it was sent leaves the host, which other runs share, as it was.
export function reopening(server: string, open: () => Promise<ToolHost>): ServerCalls {
  let opened: Promise<ToolHost> | null = null;
  const drop = (at: Promise<ToolHost>) => {
    if (opened === at) opened = null;
    void at.then((host) => host.close()).catch(() => {});
  };
  return {
    async call(call, signal) {
      const at = (opened ??= Promise.resolve().then(open));
      let host: ToolHost;
      try {
        host = await at;
      } catch (error) {
        drop(at);
        throw error;
      }
      try {
        return await host.call({ server, tool: call.tool, args: call.args }, signal);
      } catch (error) {
        if (!(signal?.aborted && error instanceof WriteStalled)) drop(at);
        throw error;
      }
    },
    close() {
      const at = opened;
      opened = null;
      void at?.then((host) => host.close()).catch(() => {});
    },
  };
}

export function claudeCodeServerCalls(cli: ClaudeCode, options: ServerCallsOptions): ServerCalls {
  const { server } = options;
  return reopening(server.name, () =>
    claudeCodeToolHost(cli, {
      grants: [grantOf(server)],
      tools: options.tools.map((tool) => ({
        server: server.name,
        tool,
        read: options.reads?.includes(tool) === true,
      })),
      dev: "dev" in server ? [server.dev] : [],
      parent: options.env ?? process.env,
      log: options.log,
    }),
  );
}

export function checkCodexServers(listed: unknown, options: ServerCallsOptions): string | null {
  const data = isObject(listed) && Array.isArray(listed.data) ? listed.data.filter(isObject) : null;
  if (!data) return "it didn't say which MCP servers it loaded";
  const on = data.filter((each) => each.runtimeStatus !== "disabled");
  if (on.length !== 1 || text(on[0]?.name) !== options.server.name)
    return "it loaded MCP servers other than the one Oriel named";
  const tools = isObject(on[0]?.tools) ? Object.keys(on[0].tools) : [];
  if (tools.some((tool) => !options.tools.includes(tool)))
    return "it offers tools Oriel didn't name";
  return null;
}

export function codexServerCalls(cli: Codex, options: ServerCallsOptions): ServerCalls {
  let opened: Promise<{ server: Server; threadId: string }> | null = null;
  const { server: called } = options;
  const name = called.name;

  const open = async () => {
    const server = startServer({
      cli,
      spawn: options.spawn ?? spawnCodex,
      parent: options.env ?? process.env,
      signal: new AbortController().signal,
      log: options.log,
      overrides: "dev" in called ? devOverrides([called.dev]) : [],
      idleMs: 2 * 60 * 1000,
    });
    try {
      await initialize(server);
      void (async () => {
        for (;;) {
          const message = await server.take();
          if (message.id !== undefined && typeof message.method === "string")
            server.respond(message.id, codexAnswer(message.method));
        }
      })().catch(() => {});
      const effective = await server.request("config/read", { cwd: server.cwd });
      const skills = await server.request("skills/list", { cwds: [server.cwd], forceReload: true });
      const started = await server.request("thread/start", {
        cwd: server.cwd,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: "read-only",
        baseInstructions: "Oriel calls MCP tools on this thread. It runs no turn.",
        developerInstructions: "",
        ephemeral: true,
        config: {
          ...threadConfig(effective, skills),
          [`mcp_servers.${name}.enabled`]: true,
          [`mcp_servers.${name}.enabled_tools`]: [...options.tools],
          ...Object.fromEntries(
            options.tools.map((tool) => [
              `mcp_servers.${name}.tools.${tool}.approval_mode`,
              "approve",
            ]),
          ),
        },
        dynamicTools: [],
      });
      const thread = isObject(started) && isObject(started.thread) ? started.thread : {};
      const threadId = text(thread.id);
      if (!threadId) throw new ProviderError("Oriel stopped Codex: it started no thread.");
      const refused = checkCodexServers(
        await server.request("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly" }),
        options,
      );
      if (refused) {
        server.stop(refused);
        throw new ProviderError(`Oriel stopped Codex: ${refused}.`);
      }
      return { server, threadId };
    } catch (error) {
      server.close();
      throw error;
    }
  };

  return {
    async call(call, signal) {
      if (!options.tools.includes(call.tool))
        throw new WriteStalled(`${call.tool} isn't a tool this process may call`);
      opened ??= open();
      const at = opened;
      // A process that didn't start asked nothing of the server.
      const { server, threadId } = await at.catch((error: unknown) => {
        if (opened === at) opened = null;
        throw new WriteStalled(error instanceof Error ? error.message : String(error));
      });
      if (signal?.aborted) throw new WriteStalled("the run ended before this call was sent");
      const answer = await server.request("mcpServer/tool/call", {
        threadId,
        server: name,
        tool: call.tool,
        arguments: call.args,
      });
      if (!isObject(answer) || !Array.isArray(answer.content))
        throw new ProviderError(`Codex answered ${call.tool} with no content.`);
      return {
        content: answer.content,
        ...(answer.structuredContent !== undefined && answer.structuredContent !== null
          ? { structuredContent: answer.structuredContent }
          : {}),
        ...(answer.isError === true ? { isError: true } : {}),
      };
    },
    close() {
      const at = opened;
      opened = null;
      void at?.then(({ server }) => server.close()).catch(() => {});
    },
  };
}
