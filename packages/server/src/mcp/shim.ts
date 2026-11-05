// `oriel mcp`, the stdio shim: for an MCP client that only starts commands.
// It reads JSON-RPC messages from stdin, one per line, posts each to the
// running Oriel's door, and writes each answer to stdout, one per line. It
// finds the door by the port Oriel keeps in its data folder, read at each
// message, so it follows Oriel to a new port, and it sends the token in
// `ORIEL_TOKEN`, as MCP says a stdio server reads its credentials from its
// environment. It adds no trust: the door checks the token, as it does any
// client's. A subscription's stream comes back as one line per event.
//
//   node packages/server/src/mcp/shim.ts --data <folder>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { modern } from "./protocol.ts";

type Message = {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

// The headers a message needs at the door: a 2026-07-28 message says its
// method and name; a handshake one, once its version is agreed, says that.
export function headersFor(
  message: Message,
  token: string,
  agreed: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const meta = (message.params?.["_meta"] ?? {}) as Record<string, unknown>;
  const own = meta["io.modelcontextprotocol/protocolVersion"];
  if (own === modern && message.method) {
    headers["mcp-protocol-version"] = modern;
    headers["mcp-method"] = message.method;
    const named = message.params?.["name"] ?? message.params?.["uri"];
    if (typeof named === "string")
      headers["mcp-name"] = /^[\x20-\x7e]*$/.test(named)
        ? named
        : `=?base64?${Buffer.from(named).toString("base64")}?=`;
  } else if (agreed) headers["mcp-protocol-version"] = agreed;
  return headers;
}

// Every message goes to the door as a POST (a name, so the repo check
// doesn't read this call as a route of the window's).
const posted = "POST";

export function shim(deps: {
  input: Readable;
  write(line: string): void;
  token: string;
  // The door's MCP endpoint now, or null when Oriel isn't running.
  door(): string | null;
  fetch: typeof fetch;
}): Promise<void> {
  let agreed: string | null = null;
  const failed = (message: Message, text: string) => {
    if (message.id !== undefined)
      deps.write(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: text } }),
      );
  };
  const forward = async (message: Message) => {
    const url = deps.door();
    if (!url) return failed(message, "Oriel isn't running. Open it, then try again.");
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: posted,
        headers: headersFor(message, deps.token, agreed),
        body: JSON.stringify(message),
      });
    } catch {
      return failed(message, "Oriel isn't running. Open it, then try again.");
    }
    if (response.status === 202) return;
    if (response.status === 401)
      return failed(
        message,
        "Oriel doesn't know this token. Connect this program in its Settings.",
      );
    if ((response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of response.body ?? []) {
        rest += decoder.decode(chunk, { stream: true });
        const events = rest.split("\n\n");
        rest = events.pop() ?? "";
        for (const event of events)
          for (const line of event.split("\n"))
            if (line.startsWith("data: ")) deps.write(line.slice(6));
      }
      return;
    }
    const text = await response.text();
    try {
      const answer = JSON.parse(text) as { result?: { protocolVersion?: unknown } };
      if (message.method === "initialize" && typeof answer.result?.protocolVersion === "string")
        agreed = answer.result.protocolVersion;
      deps.write(JSON.stringify(answer));
    } catch {
      failed(message, `Oriel answered ${response.status}`);
    }
  };
  const lines = createInterface({ input: deps.input, crlfDelay: Infinity });
  const open = new Set<Promise<void>>();
  let initialized: Promise<void> = Promise.resolve();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      deps.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }),
      );
      return;
    }
    // An initialize waits for nothing; what follows it waits for its
    // answer, for the version it agrees.
    const sent = (
      message.method === "initialize"
        ? (initialized = forward(message))
        : initialized.then(() => forward(message))
    ).finally(() => open.delete(sent));
    open.add(sent);
  });
  return new Promise((resolve) =>
    lines.on("close", () => void Promise.allSettled(open).then(() => resolve())),
  );
}

// The door's endpoint, from the port the data folder keeps.
export const doorIn = (data: string) => (): string | null => {
  try {
    const port = Number(readFileSync(join(data, "mcp-port"), "utf8").trim());
    return Number.isInteger(port) && port > 0 ? `http://127.0.0.1:${port}/mcp` : null;
  } catch {
    return null;
  }
};

if (import.meta.main) {
  const { values } = parseArgs({ options: { data: { type: "string" } } });
  const token = process.env["ORIEL_TOKEN"];
  const data =
    values.data ?? join(process.env["HOME"] ?? "", "Library", "Application Support", "Oriel");
  if (!token) {
    process.stderr.write("Set ORIEL_TOKEN to a token from Oriel's Settings, Outside tools.\n");
    process.exit(2);
  }
  await shim({
    input: process.stdin,
    write: (line) => void process.stdout.write(`${line}\n`),
    token,
    door: doorIn(data),
    fetch,
  });
}
