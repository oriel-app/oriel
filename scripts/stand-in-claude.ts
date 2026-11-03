// A stand-in for Claude Code, for `pnpm desktop:try` (packages/desktop/README.md).
// The desktop app runs it from Settings' Claude Code path, as it would the
// person's own, and it answers what the first run asks from a state file in
// its folder, so a try never runs, signs in or updates the person's CLI:
// `--version`, `auth login`, `auth status`, `update`, and a session's
// `initialize` and turn, with fixed text and no model. A thread's turn,
// which needs Oriel's run tool, stops at the harness's check.
//
// Run as `stand-in-claude.ts <folder> <claude's arguments…>`.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type StandIn = {
  version: string;
  // The version `update` moves to.
  updatesTo: string;
  signedIn: boolean;
  signIn: "works" | "fails";
};

type Answer = { out: string[]; err: string[]; code: number; next?: StandIn };

// What a command prints and how it exits, and the state it leaves.
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

// A session's answers to one line from Oriel: `initialize`, saying whether
// there's an account, and a turn, as a title's turn would answer.
export function session(state: StandIn, model: string, line: Message): Message[] {
  const request = (line.request ?? {}) as Message;
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
  return [
    {
      type: "system",
      subtype: "init",
      tools: [],
      mcp_servers: [],
      permissionMode: "dontAsk",
      plugins: [],
      skills: [],
      slash_commands: [],
      claude_code_version: state.version,
      model,
    },
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
    for await (const text of createInterface({ input: process.stdin })) {
      let line: unknown;
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof line !== "object" || line === null) continue;
      for (const answer of session(state, model, line as Message))
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
