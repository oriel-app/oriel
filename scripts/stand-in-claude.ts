// Run as `stand-in-claude.ts <folder> <claude's arguments…>`; it answers from a state file
// in <folder>.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { harnessRunTool, harnessServer } from "../packages/agent/src/claude-code.ts";

export type StandIn = {
  version: string;
  updatesTo: string;
  signedIn: boolean;
  signIn: "works" | "fails";
};

type Answer = { out: string[]; err: string[]; code: number; next?: StandIn };

export function command(state: StandIn, args: readonly string[]): Answer {
  const [first, second] = args;
  if (first === "--version") return { out: [`${state.version} (Claude Code)`], err: [], code: 0 };
  if (first === "auth" && second === "login") {
    const opening = [
      "Opening browser to sign in…",
      "If the browser didn't open, visit: https://claude.ai/oauth/authorize?code=true&state=standin0123456789abcdefghij",
    ];
    if (state.signIn === "fails")
      return { out: opening, err: ["Login timed out: no answer from the browser."], code: 1 };
    return {
      out: [...opening, "Login successful."],
      err: [],
      code: 0,
      next: { ...state, signedIn: true },
    };
  }
  if (first === "auth" && second === "status")
    return state.signedIn
      ? { out: [JSON.stringify({ loggedIn: true, ...account })], err: [], code: 0 }
      : { out: [JSON.stringify({ loggedIn: false })], err: [], code: 1 };
  if (first === "update")
    return state.version === state.updatesTo
      ? { out: ["Claude Code is up to date."], err: [], code: 0 }
      : {
          out: [`Successfully updated from ${state.version} to version ${state.updatesTo}`],
          err: [],
          code: 0,
          next: { ...state, version: state.updatesTo },
        };
  return { out: [], err: [`The stand-in doesn't answer: ${args.join(" ")}`], code: 2 };
}

const account = { authMethod: "claude.ai", email: "pm@example.com", subscriptionType: "pro" };

type Message = Record<string, unknown>;

export const endlessScript = "while (true) {}";
const runCall = "toolu_stand_in_run";

const response = (model: string, block: Message, json: string | null, stop: string) =>
  [
    { type: "message_start", message: { model, usage: { input_tokens: 12, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: block },
    ...(json === null
      ? []
      : [
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: json },
          },
        ]),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 4 } },
    { type: "message_stop" },
  ].map((event) => ({ type: "stream_event", event, parent_tool_use_id: null }));

export function session(state: StandIn, model: string, line: Message, run = false): Message[] {
  const request = (line.request ?? {}) as Message;
  if (run && line.type === "control_response") {
    const answered = (line.response ?? {}) as Message;
    if (answered.request_id !== runCall) return [];
    return response(model, { type: "text", text: "The stand-in's run ended." }, null, "end_turn");
  }
  if (line.type === "control_request") {
    const id = line.request_id;
    return request.subtype === "initialize"
      ? [
          {
            type: "control_response",
            response: {
              subtype: "success",
              request_id: id,
              response: { account: state.signedIn ? account : {} },
            },
          },
        ]
      : [
          {
            type: "control_response",
            response: { subtype: "error", request_id: id, error: "The stand-in doesn't answer." },
          },
        ];
  }
  if (line.type !== "user") return [];
  const init = {
    type: "system",
    subtype: "init",
    tools: run ? [harnessRunTool] : [],
    mcp_servers: run ? [{ name: harnessServer, status: "connected" }] : [],
    permissionMode: "dontAsk",
    plugins: [],
    skills: [],
    slash_commands: [],
    claude_code_version: state.version,
    model,
  };
  if (run) {
    const input = { script: endlessScript };
    return [
      init,
      ...response(
        model,
        { type: "tool_use", id: runCall, name: harnessRunTool, input: {} },
        JSON.stringify(input),
        "tool_use",
      ),
      {
        type: "control_request",
        request_id: runCall,
        request: {
          subtype: "mcp_message",
          server_name: harnessServer,
          message: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "run", arguments: input, _meta: { "claudecode/toolUseId": runCall } },
          },
        },
      },
    ];
  }
  return [
    init,
    {
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "end_turn",
      result: "The stand-in answers",
      usage: { input_tokens: 12, output_tokens: 4 },
    },
  ];
}

if (import.meta.main) {
  const [folder = "", ...args] = process.argv.slice(2);
  const file = join(folder, "state.json");
  const state = JSON.parse(readFileSync(file, "utf8")) as StandIn;
  if (args.includes("-p")) {
    const at = args.indexOf("--model");
    const model = at >= 0 ? (args[at + 1] ?? "") : "";
    const run = args.includes("--allowed-tools");
    for await (const text of createInterface({ input: process.stdin })) {
      let line: unknown;
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof line !== "object" || line === null) continue;
      for (const answer of session(state, model, line as Message, run))
        process.stdout.write(`${JSON.stringify(answer)}\n`);
    }
  } else {
    const answer = command(state, args);
    if (answer.next) {
      writeFileSync(`${file}.tmp`, JSON.stringify(answer.next));
      renameSync(`${file}.tmp`, file);
    }
    for (const line of answer.out) console.log(line);
    for (const line of answer.err) console.error(line);
    process.exitCode = answer.code;
  }
}
