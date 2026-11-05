// Connecting a program to Oriel's MCP door (the mcp-connect spike, OA-72):
// tokens kept only as hashes, signing in with OAuth with the consent in the
// window, the window's routes, and the stdio shim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import test from "node:test";
import { instant, ulid } from "@oriel/core";
import { ensureWorkspace, loadMigrations, migrate, open, outsideToolStore } from "@oriel/db";
import { mcpHandler, type McpRequest } from "./mcp/http.ts";
import { isLoopbackRedirect, oauth } from "./mcp/oauth.ts";
import { mcpServer, modern } from "./mcp/protocol.ts";
import { headersFor, shim } from "./mcp/shim.ts";
import { accessLife, outsideTools } from "./mcp/tokens.ts";
import { outsideToolsApi } from "./mcp/window-api.ts";
import type { Request } from "./site.ts";
import { json, testApp } from "./testing.ts";

const start = Date.UTC(2026, 10, 6, 9);

function stored() {
  let clock = start;
  let n = 0;
  const db = open(":memory:");
  const now = () => instant(new Date(clock));
  migrate(db, loadMigrations(), now());
  const workspaceId = ulid(start, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "Oriel" }, now());
  const tools = outsideTools({
    store: outsideToolStore(db),
    workspaceId,
    now,
    newId: () => ulid(start + ++n),
  });
  return { db, tools, tick: (ms: number) => void (clock += ms), at: () => clock };
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

test("a tool's token is kept only as its hash, and dies with Revoke", () => {
  const { db, tools } = stored();
  const { tool, token } = tools.connect("  Claude Code ", "act");
  assert.equal(tool.name, "Claude Code");
  const rows = db.prepare("select hash, kind from outside_tool_tokens").all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [{ hash: createHash("sha256").update(token).digest("hex"), kind: "pasted" }],
  );
  assert.ok(!JSON.stringify(db.prepare("select * from outside_tools").all()).includes(token));
  assert.equal(tools.who(token)?.id, tool.id);
  assert.equal(tools.revoke(tool.id), true);
  assert.equal(tools.who(token), null);
  assert.equal(db.prepare("select hash from outside_tool_tokens").all().length, 0);
  assert.equal(tools.list()[0]?.revokedAt !== null, true, "the row stays, as who acted");
});

test("a signed-in tool's access token expires, and its refresh token renews it once", () => {
  const { tools, tick } = stored();
  const client = { id: "oc_test", redirects: ["http://127.0.0.1/callback"] };
  const granted = tools.grant("Codex", "read", "Codex", client);
  assert.equal(tools.who(granted.access)?.name, "Codex");
  assert.equal(tools.who(granted.refresh), null, "a refresh token is never a bearer");
  assert.equal(tools.refresh(granted.refresh, "oc_other"), null, "only its own client");
  tick(accessLife);
  assert.equal(tools.who(granted.access), null);
  const renewed = tools.refresh(granted.refresh, "oc_test");
  assert.ok(renewed);
  assert.equal(tools.who(renewed.access)?.name, "Codex");
  assert.equal(tools.refresh(granted.refresh, "oc_test"), null, "spent");
});

test("only loopback redirects over http may sign a program in", () => {
  assert.equal(isLoopbackRedirect("http://127.0.0.1:53111/callback"), true);
  assert.equal(isLoopbackRedirect("http://localhost/cb"), true);
  assert.equal(isLoopbackRedirect("https://evil.example/cb"), false);
  assert.equal(isLoopbackRedirect("http://127.0.0.1.evil.example/cb"), false);
  assert.equal(isLoopbackRedirect("http://user@127.0.0.1/cb"), false);
});

// The door with OAuth, on a port the requests name, and the app behind it.
async function signingIn(t: test.TestContext) {
  const app = await testApp(t);
  const port = 4431;
  const origin = `http://127.0.0.1:${port}`;
  let clock = start;
  const asked: string[] = [];
  const { tools } = app.app.outside;
  const signIn = oauth({
    tools,
    origin,
    clock: () => clock,
    asked: (ask) => asked.push(ask.says),
  });
  const handle = mcpHandler({
    server: mcpServer({
      outside: app.app.outside,
      window: new URL("http://127.0.0.1:4310/"),
      version: "test",
      clock: () => clock,
    }),
    tools,
    port,
    oauth: signIn,
  });
  const send = (
    method: string,
    path: string,
    body: string | null = null,
    headers: Record<string, string> = {},
  ) => {
    const request: McpRequest = {
      method,
      url: path,
      headers: { host: `127.0.0.1:${port}`, ...headers },
      body: async () => body ?? "",
    };
    return handle(request);
  };
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  return {
    app,
    signIn,
    send,
    form,
    origin,
    asked,
    tick: (ms: number) => void (clock += ms),
  };
}

test("a 401 points a client at the door's own OAuth metadata", async (t) => {
  const { send, origin } = await signingIn(t);
  const refused = await send("POST", "/mcp", "{}");
  assert.equal(refused.status, 401);
  assert.match(
    refused.headers["www-authenticate"] ?? "",
    new RegExp(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`),
  );
  const resource = json<{ resource: string; authorization_servers: string[] }>(
    await send("GET", "/.well-known/oauth-protected-resource/mcp"),
  );
  assert.deepEqual(resource.authorization_servers, [origin]);
  const server = json<{ code_challenge_methods_supported: string[] }>(
    await send("GET", "/.well-known/oauth-authorization-server"),
  );
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  // A page can't reach any of it.
  const paged = await send("POST", "/token", "grant_type=x", { origin: "https://evil.example" });
  assert.equal(paged.status, 403);
});

test("a program signs in only once the person lets it in from the window, matching its code", async (t) => {
  const { app, signIn, send, form, origin, asked } = await signingIn(t);
  const outsider = await send(
    "POST",
    "/register",
    JSON.stringify({ redirect_uris: ["https://evil.example/cb"], client_name: "X" }),
  );
  assert.equal(outsider.status, 400);
  const registered = json<{ client_id: string }>(
    await send(
      "POST",
      "/register",
      JSON.stringify({ redirect_uris: ["http://127.0.0.1:53111/callback"], client_name: "Codex" }),
    ),
  );
  const verifier = "v".repeat(43);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: "http://127.0.0.1:53111/callback",
    code_challenge: s256(verifier),
    code_challenge_method: "S256",
    state: "st",
    resource: `${origin}/mcp`,
  });
  const page = await send("GET", `/authorize?${query}`);
  assert.equal(page.status, 200);
  const [ask] = signIn.asks();
  assert.ok(ask);
  assert.deepEqual(asked, ["Codex"]);
  assert.match(String(page.body), new RegExp(ask.code));
  // Until the person answers, the browser waits.
  const waiting = await send("GET", `/authorize/wait?ask=${ask.id}`);
  assert.equal(waiting.status, 200);
  assert.match(waiting.headers["refresh"] ?? "", /authorize\/wait/);

  // The window's route lets it in, read only, under the person's name.
  const routes = outsideToolsApi({
    tools: app.app.outside.tools,
    oauth: signIn,
    door: () => `${origin}/mcp`,
    shim: null,
  });
  const answer = await routes(
    {
      method: "POST",
      url: `/api/outside-tools/asks/${ask.id}`,
      headers: { "content-type": "application/json" },
      body: async () => JSON.stringify({ name: "Codex on my Mac", mode: "read" }),
    },
    new URL(`http://127.0.0.1:4310/api/outside-tools/asks/${ask.id}`),
  );
  assert.equal(answer?.status, 200);
  const back = await send("GET", `/authorize/wait?ask=${ask.id}`);
  assert.equal(back.status, 302);
  const location = new URL(back.headers["location"] ?? "");
  assert.equal(location.origin + location.pathname, "http://127.0.0.1:53111/callback");
  assert.equal(location.searchParams.get("state"), "st");
  assert.equal(location.searchParams.get("iss"), origin);
  const code = location.searchParams.get("code") ?? "";

  const exchange = (code_verifier: string) =>
    send(
      "POST",
      "/token",
      form({
        grant_type: "authorization_code",
        code,
        code_verifier,
        client_id: registered.client_id,
        redirect_uri: "http://127.0.0.1:53111/callback",
      }),
    );
  const wrong = await exchange("w".repeat(43));
  assert.equal(wrong.status, 400, "a wrong verifier spends the code too");
  // Signing in again, as a client does when one fails.
  await send("GET", `/authorize?${query}`);
  const again = signIn.asks()[0];
  assert.ok(again);
  assert.equal(signIn.decide(again.id, { name: "Codex on my Mac", mode: "read" }), true);
  const code2 = new URL(
    (await send("GET", `/authorize/wait?ask=${again.id}`)).headers["location"] ?? "",
  ).searchParams.get("code");
  const tokens = json<{ access_token: string; refresh_token: string; token_type: string }>(
    await send(
      "POST",
      "/token",
      form({
        grant_type: "authorization_code",
        code: code2 ?? "",
        code_verifier: verifier,
        client_id: registered.client_id,
      }),
    ),
  );
  assert.equal(tokens.token_type, "Bearer");
  const tool = app.app.outside.tools.who(tokens.access_token);
  assert.equal(tool?.name, "Codex on my Mac");
  assert.equal(tool?.mode, "read");
  assert.equal(tool?.says, "Codex");
  const listed = await send(
    "POST",
    "/mcp",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": modern } },
    }),
    {
      authorization: `Bearer ${tokens.access_token}`,
      "mcp-protocol-version": modern,
      "mcp-method": "tools/list",
    },
  );
  assert.equal(listed.status, 200);
  const names = json<{ result: { tools: { name: string }[] } }>(listed).result.tools.map(
    (each) => each.name,
  );
  assert.ok(!names.includes("workstream_remove"), "read only lists no action");
});

test("a program the person turns away goes back with access_denied, and holds nothing", async (t) => {
  const { signIn, send } = await signingIn(t);
  const { client_id } = json<{ client_id: string }>(
    await send(
      "POST",
      "/register",
      JSON.stringify({ redirect_uris: ["http://localhost:4999/cb"], client_name: "Who" }),
    ),
  );
  await send(
    "GET",
    `/authorize?${new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "http://localhost:4999/cb",
      code_challenge: s256("x".repeat(43)),
      code_challenge_method: "S256",
    })}`,
  );
  const [ask] = signIn.asks();
  assert.ok(ask);
  assert.equal(signIn.decide(ask.id, "deny"), true);
  const back = await send("GET", `/authorize/wait?ask=${ask.id}`);
  assert.equal(new URL(back.headers["location"] ?? "").searchParams.get("error"), "access_denied");
  assert.deepEqual(signIn.asks(), []);
});

test("an authorize without S256 PKCE, or for an unregistered client, signs nothing in", async (t) => {
  const { signIn, send } = await signingIn(t);
  const unknown = await send("GET", "/authorize?response_type=code&client_id=oc_nobody");
  assert.equal(unknown.status, 400);
  const { client_id } = json<{ client_id: string }>(
    await send("POST", "/register", JSON.stringify({ redirect_uris: ["http://127.0.0.1/cb"] })),
  );
  const plain = await send(
    "GET",
    `/authorize?${new URLSearchParams({ response_type: "code", client_id, code_challenge: "x".repeat(43), code_challenge_method: "plain" })}`,
  );
  assert.equal(
    new URL(plain.headers["location"] ?? "").searchParams.get("error"),
    "invalid_request",
  );
  assert.deepEqual(signIn.asks(), []);
});

test("the window adds a tool with its token shown once, and never lists the token", async (t) => {
  const app = await testApp(t);
  const routes = outsideToolsApi({
    tools: app.app.outside.tools,
    oauth: null,
    door: () => "http://127.0.0.1:4431/mcp",
    shim: ["/usr/bin/node", "shim.ts"],
  });
  const at = (path: string, body?: unknown): [Request, URL] => [
    {
      method: body === undefined ? "GET" : "POST",
      url: path,
      headers: { "content-type": "application/json" },
      body: async () => JSON.stringify(body),
    },
    new URL(`http://127.0.0.1:4310${path}`),
  ];
  const added = json<{ token: string; howTo: { client: string; command: string | null }[] }>(
    (await routes(...at("/api/outside-tools", { name: "Claude Code", mode: "act" })))!,
  );
  assert.ok(added.token.startsWith("oriel_pt_"));
  const claude = added.howTo.find((each) => each.client === "Claude Code");
  assert.match(claude?.command ?? "", /claude mcp add --transport http --scope user oriel/);
  assert.ok(added.howTo.some((each) => each.command?.includes('"ORIEL_TOKEN"')));
  const listed = await routes(...at("/api/outside-tools"));
  assert.ok(!String(listed?.body).includes(added.token));
  const blank = await routes(...at("/api/outside-tools", { name: "  ", mode: "read" }));
  assert.equal(blank?.status, 400);
});

test("the shim posts each line to the door it finds, and answers for an Oriel that isn't running", async () => {
  const input = new PassThrough();
  const written: string[] = [];
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  let door: string | null = "http://127.0.0.1:4430/mcp";
  const done = shim({
    input,
    write: (line) => written.push(line),
    token: "oriel_pt_x",
    door: () => door,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      const message = JSON.parse(String(init.body)) as { id?: number; method: string };
      if (message.id === undefined) return new Response(null, { status: 202 });
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: message.method === "initialize" ? { protocolVersion: "2025-06-18" } : {},
      });
    }) as typeof fetch,
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  door = null;
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`);
  input.end();
  await done;
  assert.equal(sent[0]?.headers["authorization"], "Bearer oriel_pt_x");
  assert.equal(sent[2]?.headers["mcp-protocol-version"], "2025-06-18", "the agreed version");
  assert.deepEqual(
    written.map((line) => (JSON.parse(line) as { id: number }).id),
    [1, 2, 3],
    "nothing for a notification",
  );
  assert.match(written[2] ?? "", /Oriel isn't running/);
});

test("a 2026-07-28 message through the shim says its method and name in headers", () => {
  const headers = headersFor(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "workstream_list",
        _meta: { "io.modelcontextprotocol/protocolVersion": modern },
      },
    },
    "t",
    null,
  );
  assert.equal(headers["mcp-method"], "tools/call");
  assert.equal(headers["mcp-name"], "workstream_list");
  assert.equal(headers["mcp-protocol-version"], modern);
});

test("a sign-in a page or a link starts is refused, and a client asking again replaces its ask", async (t) => {
  const { signIn, send, asked } = await signingIn(t);
  const { client_id } = json<{ client_id: string }>(
    await send(
      "POST",
      "/register",
      JSON.stringify({ redirect_uris: ["http://127.0.0.1/cb"], client_name: "Claude Code" }),
    ),
  );
  const query = new URLSearchParams({
    response_type: "code",
    client_id,
    code_challenge: s256("y".repeat(43)),
    code_challenge_method: "S256",
  });
  const linked = await send("GET", `/authorize?${query}`, null, { "sec-fetch-site": "cross-site" });
  assert.equal(linked.status, 403);
  assert.deepEqual(signIn.asks(), []);
  const opened = await send("GET", `/authorize?${query}`, null, { "sec-fetch-site": "none" });
  assert.equal(opened.status, 200);
  await send("GET", `/authorize?${query}`, null, { "sec-fetch-site": "none" });
  assert.equal(signIn.asks().length, 1);
  assert.deepEqual(asked, ["Claude Code"], "the window comes forward once");
});
