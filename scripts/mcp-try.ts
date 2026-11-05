// `node scripts/mcp-try.ts`: Oriel's MCP door (decision 0024, the OA-71 spike)
// on a throwaway server: the SYN fixture in memory, with the scripted agent,
// and one workstream on SYN's checkout epic. The window is on one free port
// and the door on another, both on loopback. Two tools are connected, each
// with its token shown here once: one that reads and acts, and one that
// reads only. It writes a client config for each, with its token, into a
// temporary folder, for `claude -p --mcp-config <file> --strict-mcp-config`,
// and logs every request the door answers to stderr: who, what and how.
//
// `--check` runs Oriel's own small client against it instead, prints what
// each call answered, and stops: it lists the tools, reads, removes an item
// from the workstream as the tool that acts, hears the workstream change on
// a subscription, and is refused as the tool that reads only, and as the
// tool that acts once revoked.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { instant, ulid } from "../packages/core/src/ids.ts";
import { serve } from "../packages/server/src/serve.ts";
import { mcpHandler, type McpRequest, serveMcp } from "../packages/server/src/mcp/http.ts";
import { mcpServer, modern } from "../packages/server/src/mcp/protocol.ts";
import { outsideTools } from "../packages/server/src/mcp/tokens.ts";

const { values } = parseArgs({
  options: {
    check: { type: "boolean" },
    port: { type: "string", default: "0" },
    name: { type: "string", default: "Claude Code" },
  },
});

const serving = await serve(0);
const { app } = serving;
const now = () => instant(new Date());
const tools = outsideTools({ now, newId: () => ulid(Date.now()) });
const acting = tools.connect(values.name, "act");
const reading = tools.connect("Read-only probe", "read");
const server = mcpServer({
  outside: app.outside,
  window: new URL(serving.url),
  version: "spike",
  clock: Date.now,
});
const workstream = await app.outside.dispatch(
  "workstream.create",
  { kind: "cluster", grouping: "epic", cluster: "10001" },
  { kind: "user" },
);

// Who asked for what, as the door saw it, never the token.
const logged =
  (handle: (request: McpRequest) => ReturnType<ReturnType<typeof mcpHandler>>) =>
  async (request: McpRequest) => {
    const text = await request.body(1_000_000);
    const reply = await handle({ ...request, body: async () => text });
    let said: { method?: string; params?: Record<string, unknown> } = {};
    try {
      said = JSON.parse(text ?? "{}");
    } catch {}
    const meta = (said.params?.["_meta"] ?? {}) as Record<string, unknown>;
    const client = meta["io.modelcontextprotocol/clientInfo"] ?? said.params?.["clientInfo"];
    console.error(
      JSON.stringify({
        status: reply.status,
        method: said.method ?? request.method,
        name: said.params?.["name"] ?? said.params?.["uri"],
        version: request.headers["mcp-protocol-version"] ?? null,
        ...(said.params?.["notifications"] ? { listens: said.params["notifications"] } : {}),
        client: client ?? null,
      }),
    );
    return reply;
  };

const door = await serveMcp([Number(values.port)], (port) =>
  logged(
    mcpHandler({
      server,
      tools,
      port,
      keepAlive: (beat) => {
        const timer = setInterval(beat, 25_000);
        timer.unref();
        return () => clearInterval(timer);
      },
    }),
  ),
);

const config = (token: string) =>
  JSON.stringify(
    {
      mcpServers: {
        oriel: { type: "http", url: door.url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
const folder = mkdtempSync(join(tmpdir(), "oriel-mcp-"));
writeFileSync(join(folder, "acting.json"), config(acting.token), { mode: 0o600 });
writeFileSync(join(folder, "reading.json"), config(reading.token), { mode: 0o600 });

console.log(`window: ${serving.url}`);
console.log(`workstream: ${serving.url}workstreams/${workstream.workstream}`);
console.log(`door: ${door.url}`);
console.log(`configs: ${folder}/acting.json (${values.name}), ${folder}/reading.json (read only)`);

if (values.check) {
  type Answer = { result: { tools: { name: string }[]; contents: { text: string }[] } };
  let id = 0;
  const call = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const body = {
      jsonrpc: "2.0",
      id: ++id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": modern,
          "io.modelcontextprotocol/clientInfo": { name: "mcp-try", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    };
    const named = params["name"] ?? params["uri"];
    const response = await fetch(door.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": modern,
        "mcp-method": method,
        ...(typeof named === "string" ? { "mcp-name": named } : {}),
      },
      body: JSON.stringify(body),
    });
    // The client's own reading of what came back: enough to print.
    return { status: response.status, body: (await response.json()) as Answer };
  };
  const show = (what: string, value: unknown) =>
    console.log(`\n# ${what}\n${JSON.stringify(value, null, 2).slice(0, 1_500)}`);
  const listed = await call(acting.token, "tools/list");
  show(
    "tools/list, as the tool that acts",
    listed.body.result.tools.map((tool: { name: string }) => tool.name),
  );
  const readOnly = await call(reading.token, "tools/list");
  show(
    "tools/list, as the tool that reads only",
    readOnly.body.result.tools.map((tool: { name: string }) => tool.name),
  );
  const uri = `oriel://workstream/${workstream.workstream}`;
  // A subscription to the workstream, open while the tool acts.
  const heard = Promise.withResolvers<string[]>();
  const stream = await fetch(door.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${acting.token}`,
      accept: "text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": modern,
      "mcp-method": "subscriptions/listen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "listen",
      method: "subscriptions/listen",
      params: {
        _meta: { "io.modelcontextprotocol/protocolVersion": modern },
        notifications: { resourceSubscriptions: [uri] },
      },
    }),
  });
  void (async () => {
    const lines: string[] = [];
    const decoder = new TextDecoder();
    for await (const chunk of stream.body ?? []) {
      for (const line of decoder.decode(chunk).split("\n"))
        if (line.startsWith("data: ")) lines.push(JSON.parse(line.slice(6)).method);
      if (lines.includes("notifications/resources/updated")) break;
    }
    heard.resolve(lines);
  })();
  const before = await call(acting.token, "resources/read", { uri });
  show("resources/read, before", before.body.result.contents[0]?.text.slice(0, 400));
  const removed = await call(acting.token, "tools/call", {
    name: "workstream_remove",
    arguments: { workstream: workstream.workstream, items: ["jira:SYN-10"] },
  });
  show("tools/call workstream_remove, as the tool that acts", removed);
  show("subscriptions/listen heard", await heard.promise);
  show(
    "tools/call workstream_add, as the tool that reads only",
    await call(reading.token, "tools/call", {
      name: "workstream_add",
      arguments: { workstream: workstream.workstream, items: ["jira:SYN-10"] },
    }),
  );
  show(
    "tools/call changeset_approve, which no tool has",
    await call(acting.token, "tools/call", { name: "changeset_approve", arguments: {} }),
  );
  tools.revoke(acting.tool.id);
  show("tools/list, once revoked", await call(acting.token, "tools/list"));
  const page = await app.outside.workstream(workstream.workstream);
  show("the workstream's latest version, as the window shows it", page?.changes[0]);
  await door.close();
  await serving.close();
}
