// `node scripts/mcp-try.ts`: Oriel's MCP door (decision 0058) for a real
// client to try, with a tool connected and its token shown once.
//
// With no `--window`, on a throwaway server: the SYN fixture in memory, with
// the scripted agent, and one workstream on SYN's checkout epic, the window
// and the door each on a free loopback port. Two tools are connected: one
// that reads and acts (`--name`), and one that reads only. It runs until
// stopped. `--check` runs Oriel's own small client against it instead,
// prints what each call answered, and stops.
//
// With `--window <url> --headers <file>`, on an Oriel already running, such
// as the desktop app under `pnpm desktop:try` (whose headers file carries the
// launch cookie): it connects one tool through the window's own route, as
// the person would. `--notes` first connects a folder of three notes and
// makes a workstream of them, for a fresh data folder with nothing in it.
//
// Either way it writes, into a temporary folder, each acting tool's config
// for Claude Code (`claude -p --mcp-config <file> --strict-mcp-config`) and
// its `-c` overrides for Codex (`codex exec $(cat <file>)`). It never edits
// a client's own config.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "../packages/server/src/serve.ts";
import { modern } from "../packages/server/src/mcp/protocol.ts";

const { values } = parseArgs({
  options: {
    check: { type: "boolean" },
    port: { type: "string", default: "0" },
    name: { type: "string", default: "Claude Code" },
    mode: { type: "string", default: "act" },
    window: { type: "string" },
    headers: { type: "string" },
    notes: { type: "boolean" },
  },
});
const mode = values.mode === "read" ? "read" : "act";

const folder = mkdtempSync(join(tmpdir(), "oriel-mcp-"));
// What each client is given: Claude Code's MCP config, and Codex's `-c`
// overrides, which approve the door's tools for this run alone.
function configs(file: string, door: string, token: string): void {
  const claude = {
    mcpServers: {
      oriel: { type: "http", url: door, headers: { Authorization: `Bearer ${token}` } },
    },
  };
  writeFileSync(join(folder, `${file}.json`), JSON.stringify(claude, null, 2), { mode: 0o600 });
  const codex = [
    `-c mcp_servers.oriel.url=${JSON.stringify(door)}`,
    `-c mcp_servers.oriel.http_headers.Authorization=${JSON.stringify(`Bearer ${token}`)}`,
    `-c mcp_servers.oriel.default_tools_approval_mode="approve"`,
  ];
  writeFileSync(join(folder, `${file}.codex`), `${codex.join(" ")}\n`, { mode: 0o600 });
}

if (values.window) {
  const window = values.window;
  const extra = Object.fromEntries(
    readFileSync(values.headers ?? "", "utf8")
      .split("\n")
      .flatMap((line) => {
        const at = line.indexOf(":");
        return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : [];
      }),
  );
  const ask = async <T>(path: string, body?: unknown): Promise<T> => {
    const reply = await fetch(new URL(path, window), {
      method: body === undefined ? "GET" : "POST",
      headers: { ...extra, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!reply.ok) throw new Error(`${path}: ${reply.status} ${await reply.text()}`);
    return (await reply.json()) as T;
  };
  if (values.notes) {
    const notes = join(folder, "notes");
    mkdirSync(notes);
    const written = {
      "Ferry timetable.md": "# Ferry timetable\n\nThe winter timetable starts in November.",
      "Ticket prices.md": "# Ticket prices\n\nA return costs the same as two singles.",
      "Harbour works.md": "# Harbour works\n\nThe north berth closes for a week in March.",
    };
    for (const [file, text] of Object.entries(written))
      writeFileSync(join(notes, file), `${text}\n`);
    await ask("api/connections", { kind: "folder", given: { path: notes } });
    type Browse = { clusters: { row: { key: string; count: number } }[] };
    const browse = await ask<Browse>("api/browse?grouping=epic");
    const cluster = browse.clusters.find((each) => each.row.count > 1);
    if (!cluster) throw new Error("no cluster of notes to make a workstream of");
    const made = await ask<{ id: string }>("api/workstreams", {
      kind: "cluster",
      grouping: "epic",
      cluster: cluster.row.key,
    });
    console.log(`workstream: ${new URL(`workstreams/${made.id}`, window)}`);
  }
  const { door } = await ask<{ door: { url: string } | { closed: string } }>("api/outside-tools");
  if (!("url" in door)) throw new Error(`The door is closed: ${door.closed}`);
  const { token } = await ask<{ token: string }>("api/outside-tools", { name: values.name, mode });
  configs("tool", door.url, token);
  console.log(`door: ${door.url}`);
  console.log(`token, shown once: ${token}`);
  console.log(`configs: ${folder}/tool.json, ${folder}/tool.codex (${values.name}, ${mode})`);
  process.exit(0);
}

const serving = await serve(0, undefined, { door: { ports: [Number(values.port)] } });
const { app } = serving;
if (!("url" in serving.door)) throw new Error(`The door is closed: ${serving.door.closed}`);
const door = serving.door.url;
const acting = app.outside.tools.connect(values.name, mode);
const reading = app.outside.tools.connect("Read-only probe", "read");
const workstream = await app.outside.dispatch(
  "workstream.create",
  { kind: "cluster", grouping: "epic", cluster: "10001" },
  { kind: "user" },
);
configs("acting", door, acting.token);
configs("reading", door, reading.token);

console.log(`window: ${serving.url}`);
console.log(`workstream: ${serving.url}workstreams/${workstream.workstream}`);
console.log(`door: ${door}`);
console.log(`token, shown once: ${acting.token} (${values.name}, ${mode})`);
console.log(`configs: ${folder}/acting.{json,codex}, ${folder}/reading.{json,codex} (read only)`);

if (values.check) {
  type Answer = { result: { tools: { name: string }[]; contents: { text: string }[] } };
  let id = 0;
  const call = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const named = params["name"] ?? params["uri"];
    const response = await fetch(door, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": modern,
        "mcp-method": method,
        ...(typeof named === "string" ? { "mcp-name": named } : {}),
      },
      body: JSON.stringify({
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
      }),
    });
    return { status: response.status, body: (await response.json()) as Answer };
  };
  const show = (what: string, value: unknown) =>
    console.log(`\n# ${what}\n${JSON.stringify(value, null, 2).slice(0, 1_500)}`);
  const names = (answer: { body: Answer }) => answer.body.result.tools.map((tool) => tool.name);
  show("tools/list, as the tool that acts", names(await call(acting.token, "tools/list")));
  show("tools/list, as the tool that reads only", names(await call(reading.token, "tools/list")));
  const uri = `oriel://workstreams/${workstream.workstream}`;
  show(
    "resources/read, before",
    (await call(acting.token, "resources/read", { uri })).body.result.contents[0]?.text.slice(
      0,
      300,
    ),
  );
  show(
    "tools/call workstream_remove, as the tool that acts",
    await call(acting.token, "tools/call", {
      name: "workstream_remove",
      arguments: { workstream: workstream.workstream, items: ["jira:SYN-10"] },
    }),
  );
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
  const page = await app.outside.window(`/api/workstreams/${workstream.workstream}`);
  show(
    "the workstream's latest version, as the window shows it",
    (page.body as { changes: unknown[] }).changes[0],
  );
  app.outside.tools.revoke(acting.tool.id);
  show("tools/list, once revoked", await call(acting.token, "tools/list"));
  await serving.close();
}
