import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

type Message = Record<string, unknown>;
type Fake = {
  journal: string;
  version?: string;
  capability?: boolean;
  servers?: { name: string; url: string; status?: string }[];
  hooksOn?: boolean;
  ignoreTerm?: boolean;
  descendant?: boolean;
  silentStart?: boolean;
};

const fake = JSON.parse(process.env.FAKE_CLAUDE ?? "{}") as Fake;
const journal = (line: string) => appendFileSync(fake.journal, `${line}\n`);
if (fake.ignoreTerm) {
  process.on("SIGTERM", () => journal("term"));
  setInterval(() => {}, 1 << 30);
}
if (fake.descendant) {
  const held = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1 << 30)"],
    { stdio: "inherit" },
  );
  journal(`descendant ${held.pid}`);
}
const out = (message: Message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id: unknown, response: Message) =>
  out({ type: "control_response", response: { subtype: "success", request_id: id, response } });
const error = (id: unknown, said: string) =>
  out({ type: "control_response", response: { subtype: "error", request_id: id, error: said } });
const textAnswer = (text: string) => ({ content: [{ type: "text", text }] });
let asked = 0;
let slow: unknown = null;

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as Message;
  if (message.type === "control_response") {
    const response = message.response as Message;
    journal(`answered ${String(response.subtype)}`);
    if (slow !== null) ok(slow, textAnswer("slow"));
    slow = null;
    return;
  }
  if (message.type !== "control_request" || fake.silentStart) return;
  const id = message.request_id;
  const request = message.request as Message;
  if (request.subtype === "initialize")
    return ok(id, {
      claude_code_version: fake.version ?? "2.1.319",
      capabilities: fake.capability === false ? [] : ["mcp_call_result_not_for_model_v1"],
    });
  if (request.subtype === "mcp_status")
    return ok(id, {
      mcpServers: (fake.servers ?? []).map((s) => ({
        name: s.name,
        status: s.status ?? "connected",
        config: { type: "http", url: s.url },
      })),
    });
  if (request.subtype === "get_hooks_listing")
    return ok(id, {
      policy: { allDisabled: !fake.hooksOn },
      hooks: fake.hooksOn ? [{ event: "SessionStart", disabled: false }] : [],
    });
  if (request.subtype !== "mcp_call")
    return error(id, `Unknown subtype ${String(request.subtype)}`);
  const [, server = "", tool = ""] = String(request.tool).split("__");
  if (!fake.servers?.some((s) => s.name === server))
    return error(id, `MCP server not connected: ${server}`);
  journal(`call ${tool} ${request.result_not_for_model === true ? "not-for-model" : "for-model"}`);
  if (tool === "echo") return ok(id, textAnswer(JSON.stringify(request.arguments)));
  if (tool === "slow") slow = id;
  if (tool === "hang" || tool === "slow")
    return out({
      type: "control_request",
      request_id: `cli-${++asked}`,
      request: { subtype: "elicitation", message: "Sign in?" },
    });
  if (tool === "fails") return error(id, '{"error":true,"message":"Issue does not exist"}');
  if (tool === "crash") process.exit(3);
});
