// The server's desktop mode end to end, in this process: a fake shell on
// its stdin and stdout, and the server on a loopback port the OS picks.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { instant } from "@oriel/core";
import { open } from "@oriel/db";
import type { SettingsView, ThreadView } from "@oriel/web/view";
import { scriptedAgent } from "../scripted-agent.ts";
import type { Serving } from "../serve.ts";
import { memorySite, memorySiteOrigin } from "@oriel/jira/testing";
import { loadJiraFixture } from "@oriel/jira";
import { account, estimate, fakeSandbox, t0, testApp } from "../testing.ts";
import { keyStore } from "../api-key.ts";
import { models } from "../model.ts";
import { memorySettings } from "../settings.ts";
import { keptPort } from "./port.ts";
import type { ServerLine } from "./protocol.ts";
import { type DesktopOptions, runDesktop } from "./run.ts";

const secret = "5a".repeat(32);
const cookie = `oriel-launch=${secret}`;

function folder(t: { after(fn: () => void): void }): string {
  const data = join(mkdtempSync(join(tmpdir(), "oriel-desktop-")), "Oriel");
  t.after(() => rmSync(join(data, ".."), { recursive: true, force: true }));
  return data;
}

// A shell that keeps secrets in memory and answers every request at once.
// `model` stands in for main.ts's, in place of the scripted agent.
function start(
  data: string,
  firstPort = 0,
  given?: { secrets: Map<string, string>; model: DesktopOptions["model"] },
) {
  const input = new PassThrough();
  const out: ServerLine[] = [];
  const logged: { message: string; fields: Record<string, unknown> }[] = [];
  // Jira, connected at an earlier launch, to SYN on a site in memory.
  const site = memorySite(loadJiraFixture(), instant(new Date(t0)), { account });
  const secrets =
    given?.secrets ??
    new Map([["jira", JSON.stringify({ site: memorySiteOrigin, ...account, project: "SYN" })]]);
  const signals = new EventEmitter();
  const write = (line: string) => {
    const sent = JSON.parse(line) as ServerLine;
    out.push(sent);
    if (!("id" in sent)) return;
    const value =
      sent.kind === "secret.get"
        ? (secrets.get(sent.name) ?? null)
        : sent.kind === "secret.set"
          ? (secrets.set(sent.name, sent.secret), null)
          : sent.kind === "secret.delete"
            ? (secrets.delete(sent.name), null)
            : null;
    input.write(`${JSON.stringify({ id: sent.id, ok: true, value })}\n`);
  };
  input.write(`${secret}\n`);
  const running = runDesktop({
    data,
    input,
    write,
    log: (message, fields = {}) => logged.push({ message, fields }),
    signals,
    firstPort,
    firstDoorPort: 0,
    jiraFetch: site.fetch,
    app: {
      now: () => instant(new Date(t0)),
      sandbox: fakeSandbox({ estimate }),
      ...(given ? {} : { agent: (deps) => scriptedAgent(deps, () => [{ run: "estimate" }]) }),
    },
    ...(given ? { model: given.model } : {}),
  });
  return { input, out, logged, secrets, signals, running };
}

test("desktop mode answers only with the launch cookie, a review link without it, and the link dies at quit", async (t) => {
  const data = folder(t);
  const shell = start(data);
  const { serving, exited } = await shell.running;
  assert.equal((await fetch(serving.url)).status, 403);
  assert.equal((await fetch(serving.url, { headers: { cookie } })).status, 200);
  const url = await reviewLink(serving);
  assert.equal(new URL(url).origin, new URL(serving.url).origin);
  const token = new URL(url).pathname.split("/").at(-1);
  // As a reviewer, with no cookie.
  assert.equal((await send(serving.url, new URL(url).pathname, undefined, false)).status, 200);
  assert.equal((await send(serving.url, "/api/review/open", { token }, false)).status, 200);

  shell.input.end();
  assert.equal(await exited, 0);
  // Closed, so the database opens again, and the link died at quit.
  open(join(data, "oriel.db"), { exclusive: true }).close();
  const after = await testApp(t, { db: join(data, "oriel.db") });
  assert.equal((await after.post("/api/review/open", { token })).status, 404);
});

test("the MCP door listens apart from the window, keeps its port, and a tool the person connects gets in", async (t) => {
  const data = folder(t);
  const shell = start(data);
  const { serving, exited } = await shell.running;
  assert.ok("url" in serving.door);
  const { url: door, port } = serving.door;
  assert.notEqual(port, serving.port);
  assert.equal(keptPort(data, "mcp-port"), port);
  // The window's cookie opens nothing at the door, and the door has none of
  // the window's routes; a tool's token opens nothing of the window's.
  assert.equal(
    (await fetch(door, { method: "POST", headers: { cookie }, body: "{}" })).status,
    401,
  );
  assert.equal((await fetch(new URL("/api/outside-tools", door))).status, 404);
  assert.equal((await send(serving.url, "/api/outside-tools", undefined, false)).status, 403);
  const added = await send(serving.url, "/api/outside-tools", { name: "Codex", mode: "read" });
  const { token } = (await added.json()) as { token: string };
  assert.equal(
    (await fetch(serving.url, { headers: { authorization: `Bearer ${token}` } })).status,
    403,
  );
  const listed = await fetch(door, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${port}`,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
    }),
  });
  assert.equal(listed.status, 200);
  const tools = (await send(serving.url, "/api/outside-tools")).json();
  assert.deepEqual(((await tools) as { door: unknown }).door, serving.door);
  shell.input.end();
  assert.equal(await exited, 0);
});

test("a second server can't open a data folder's database while the first runs", async (t) => {
  const data = folder(t);
  const first = start(data);
  const { exited } = await first.running;
  const second = start(data);
  await assert.rejects(second.running);
  first.input.end();
  assert.equal(await exited, 0);
});

test("review links a killed launch left live are revoked at the next launch", async (t) => {
  const data = folder(t);
  // A launch that made a review link and was killed: nothing ran at quit,
  // so the link is still live in the file.
  const first = start(data);
  const { serving } = await first.running;
  const token = new URL(await reviewLink(serving)).pathname.split("/").at(-1);
  await serving.close();
  // Something else holds its port now, so the next launch moves up and
  // doesn't reuse a connection the killed one left open.
  const squatter = createServer();
  await new Promise<void>((resolve) => squatter.listen(serving.port, "127.0.0.1", resolve));
  t.after(() => squatter.close());
  const next = start(data, 1);
  const again = await next.running;
  assert.equal((await send(again.serving.url, "/api/review/open", { token }, false)).status, 404);
  next.input.end();
  assert.equal(await again.exited, 0);
});

// A request to the server, with the launch cookie unless `asApp` is false.
function send(base: string, path: string, body?: unknown, asApp = true): Promise<Response> {
  return fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base.slice(0, -1),
      "content-type": "application/json",
      ...(asApp ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Makes a change set in a new workstream's thread, and a review link to it.
async function reviewLink(serving: Serving): Promise<string> {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const reply = await send(serving.url, path, body);
    assert.ok(reply.ok, `${path}: ${reply.status}`);
    return (await reply.json()) as T;
  };
  const workstream = await call<{ id: string }>("/api/workstreams", {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
  });
  const thread = await call<{ id: string }>(`/api/workstreams/${workstream.id}/threads`, {
    text: "Estimate",
  });
  await serving.app.settled();
  const [set] = (await call<ThreadView>(`/api/threads/${thread.id}`)).changeSets;
  assert.ok(set);
  return (await call<{ url: string }>(`/api/change-sets/${set.id}/review-link`, {})).url;
}

test("the API key is kept in the shell's store from Settings, and the next launch runs on it", async (t) => {
  const data = folder(t);
  const secrets = new Map<string, string>();
  const key = "sk-ant-desktop-test-value";
  // As main.ts builds it: the first look isn't awaited, since the shell
  // answers only once the server listens; requests wait for it instead.
  const model: DesktopOptions["model"] = async (store) => {
    const keys = keyStore(store, () => {});
    const settings = memorySettings();
    const chooser = models({
      key: null,
      kept: keys,
      env: { PATH: "" },
      check: async () => ({ ok: false, problem: { kind: "missing", message: "No Claude Code." } }),
    });
    const looked = chooser.look(settings.get());
    return { models: chooser, settings, keys: { store: keys, check: async () => "ok" }, looked };
  };
  const api = (serving: Serving, path: string, body?: unknown) => send(serving.url, path, body);
  const apiRow = async (serving: Serving) => {
    const view = (await (await api(serving, "/api/settings")).json()) as SettingsView;
    return view.providers.find((p) => p.kind === "api")?.status;
  };

  const first = start(data, 0, { secrets, model });
  t.after(() => void first.input.end());
  const one = await first.running;
  assert.equal(await apiRow(one.serving), "no-key");
  const saved = await api(one.serving, "/api/settings/key", { key });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(await saved.text(), new RegExp(key));
  assert.equal(secrets.get("anthropic-key"), key);
  assert.ok(
    first.out.some(
      (line) => "id" in line && line.kind === "secret.set" && line.name === "anthropic-key",
    ),
  );
  first.input.end();
  assert.equal(await one.exited, 0);

  // The key is the shell's, not the data folder's.
  const second = start(folder(t), 0, { secrets, model });
  t.after(() => void second.input.end());
  const two = await second.running;
  assert.equal(await apiRow(two.serving), "ready");
  assert.equal((await api(two.serving, "/api/settings/key", { key: null })).status, 200);
  assert.equal(secrets.has("anthropic-key"), false);
  assert.equal(await apiRow(two.serving), "no-key");
  // No log line carries the key.
  assert.doesNotMatch(JSON.stringify([first.logged, second.logged]), new RegExp(key));
  second.input.end();
  assert.equal(await two.exited, 0);
});
