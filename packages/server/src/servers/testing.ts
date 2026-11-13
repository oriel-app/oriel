import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { FoundServer, SourceServer } from "@oriel/core";
import type { Discovery } from "../source-servers.ts";

export const tinyServerName = "oriel-test-tracker";

export const testServer: SourceServer = {
  name: "Oriel's test tracker server",
  reports: tinyServerName,
  reads: ["search_issues", "get_issue"],
  writes: ["create_issue"],
  instructions: "https://example.invalid/oriel-test-tracker",
};

export const testKnown = [{ kind: "jira", server: testServer }] as const;

export const foundTiny = (over: Partial<FoundServer> = {}): FoundServer => ({
  name: "work-tracker",
  status: "connected",
  reports: tinyServerName,
  url: null,
  command: "node tiny-server.ts",
  tools: ["search_issues", "get_issue", "create_issue"],
  ...over,
});

export function fakeAgent(found: () => readonly FoundServer[] | { problem: string }) {
  const agent = { id: "claude-code", name: "Claude Code" };
  const fake = {
    asked: 0,
    discover: async (): Promise<Discovery> => {
      fake.asked += 1;
      const said = found();
      return "problem" in said ? { agent, problem: said.problem } : { agent, found: said };
    },
  };
  return fake;
}

export async function askTiny(name = "work-tracker"): Promise<FoundServer> {
  const path = join(import.meta.dirname, "tiny-server.ts");
  const child = spawn(process.execPath, [path, tinyServerName], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const answers = new Map<number, (message: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    answers.get(Number(message.id))?.(message);
  });
  let id = 0;
  const ask = (method: string) =>
    new Promise<Record<string, unknown>>((resolve) => {
      answers.set(++id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`);
    });
  try {
    let opened = await ask("server/discover");
    if (opened.error) opened = await ask("initialize");
    type Info = { name?: string };
    const result = (opened.result ?? {}) as {
      _meta?: Record<string, Info>;
      serverInfo?: Info;
    };
    const info = result._meta?.["io.modelcontextprotocol/serverInfo"] ?? result.serverInfo;
    const listed = (await ask("tools/list")).result as { tools: { name: string }[] };
    return foundTiny({
      name,
      reports: info?.name ?? null,
      command: `node ${path}`,
      tools: listed.tools.map((tool) => tool.name),
    });
  } finally {
    child.kill();
  }
}

export const tinyAgent = {
  discover: async (): Promise<Discovery> => ({
    agent: { id: "claude-code", name: "Claude Code" },
    found: [await askTiny()],
  }),
  knownServers: testKnown,
};
