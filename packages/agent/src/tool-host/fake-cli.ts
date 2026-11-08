// SPIKE: a stand-in for Claude Code's control channel, run as a real child
// process so a test can kill it mid-call. Its behaviour comes from FAKE_CLI
// (JSON). Every call it receives is appended to the journal file first, so a
// test counts what reached "the server".
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

type Message = Record<string, unknown>;
type Fake = {
  journal: string;
  capability?: boolean;
  servers?: { name: string; url: string; status?: string }[];
  hooksOn?: boolean;
  ignoreTerm?: boolean;
  silentStart?: boolean;
};

const fake = JSON.parse(process.env.FAKE_CLI ?? "{}") as Fake;
// A CLI that ignores SIGTERM, and outlives its stdin closing, so only
// SIGKILL stops it.
if (fake.ignoreTerm) {
  process.on("SIGTERM", () => appendFileSync(fake.journal, "term\n"));
  setInterval(() => {}, 1 << 30);
}
const out = (message: Message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id: unknown, response: Message) =>
  out({ type: "control_response", response: { subtype: "success", request_id: id, response } });
const asked = new Map<string, (response: Message) => void>();
let mine = 0;
const ask = (request: Message) =>
  new Promise<Message>((resolve) => {
    const id = `cli-${++mine}`;
    asked.set(id, resolve);
    out({ type: "control_request", request_id: id, request });
  });
const textAnswer = (text: string) => ({ result: { content: [{ type: "text", text }] } });

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as Message;
  if (message.type === "control_response") {
    const response = message.response as Message;
    asked.get(String(response.request_id))?.(response);
    return;
  }
  if (message.type !== "control_request") return;
  const id = message.request_id;
  const request = message.request as Message;
  if (fake.silentStart) return;
  if (request.subtype === "initialize")
    return ok(id, {
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
      hooks: [{ event: "SessionStart", disabled: !fake.hooksOn }],
    });
  if (request.subtype !== "mcp_call") return;
  const tool = String(request.tool_name);
  appendFileSync(fake.journal, `call ${tool}\n`);
  if (tool === "echo") return ok(id, textAnswer(JSON.stringify(request.arguments)));
  if (tool === "hang") return;
  // A server the person hasn't signed in to: the CLI refuses the call.
  if (tool === "auth")
    return out({
      type: "control_response",
      response: { subtype: "error", request_id: id, error: `needs-auth: ${request.server_name}` },
    });
  if (tool === "crash") process.exit(3);
  if (tool === "big")
    return ok(id, {
      result: {
        content: [
          { type: "text", text: "x".repeat(150_000) },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      },
    });
  if (tool === "elicits")
    return void ask({ subtype: "elicitation", message: "Sign in?" }).then((said) => {
      appendFileSync(fake.journal, `elicitation ${String(said.subtype)}\n`);
      ok(id, textAnswer(said.subtype === "error" ? "declined" : "accepted"));
    });
});
