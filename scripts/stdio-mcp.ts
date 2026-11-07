// Calls a local MCP server's tools over stdio, as a person's agent would:
// for recording what packages/sheets-mcp answers in its fixture mode, with
// no agent between (OA-279). It starts the server with only this process's
// PATH and HOME, so nothing of `.env` reaches it, and stops it on close.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ToolAnswer, ToolCaller } from "../packages/core/src/index.ts";

export type StdioCalls = { call: ToolCaller; close(): void };

export async function stdioCalls(command: string, args: readonly string[]): Promise<StdioCalls> {
  const child = spawn(command, [...args], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  });
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    if (typeof message.id === "number") waiting.get(message.id)?.(message);
  });
  let next = 0;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, (message) => {
        waiting.delete(id);
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result as Record<string, unknown>);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "oriel-recording", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    call: async ({ tool, args: given }) => {
      const result = await request("tools/call", { name: tool, arguments: given });
      return {
        content: Array.isArray(result.content) ? result.content : [],
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent }),
        ...(result.isError === true ? { isError: true } : {}),
      } satisfies ToolAnswer;
    },
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}
