// The server's desktop mode end to end, in this process: a fake shell on
// its stdin and stdout, and the server on a loopback port the OS picks.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { instant } from "@oriel/core";
import { open } from "@oriel/db";
import type { ThreadView } from "@oriel/web/view";
import { scriptedAgent } from "../scripted-agent.ts";
import type { Serving } from "../serve.ts";
import { memorySite, memorySiteOrigin } from "@oriel/jira/testing";
import { loadJiraFixture } from "../../../../scripts/fixtures/load.ts";
import { account, estimate, fakeSandbox, t0, testApp } from "../testing.ts";
import { keepPort, keptPort } from "./port.ts";
import type { ServerLine } from "./protocol.ts";
import { runDesktop, Stopped, takeStdout } from "./run.ts";

const secret = "5a".repeat(32);
const cookie = `oriel-launch=${secret}`;

function folder(t: { after(fn: () => void): void }): string {
  const data = join(mkdtempSync(join(tmpdir(), "oriel-desktop-")), "Oriel");
  t.after(() => rmSync(join(data, ".."), { recursive: true, force: true }));
  return data;
}

// A shell that keeps secrets in memory and answers every request at once.
function start(data: string, firstPort = 0) {
  const input = new PassThrough();
  const out: ServerLine[] = [];
  const logged: { message: string; fields: Record<string, unknown> }[] = [];
  // Jira, connected at an earlier launch, to SYN on a site in memory.
  const site = memorySite(loadJiraFixture(), instant(new Date(t0)), { account });
  const secrets = new Map([
    ["jira", JSON.stringify({ site: memorySiteOrigin, ...account, project: "SYN" })],
  ]);
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
    jiraFetch: site.fetch,
    app: {
      now: () => instant(new Date(t0)),
      sandbox: fakeSandbox({ estimate }),
      agent: (deps) => scriptedAgent(deps, () => [{ run: "estimate" }]),
    },
  });
  return { input, out, logged, secrets, signals, running };
}

test("desktop mode names its URL first, answers only with the cookie, and quits when stdin ends", async (t) => {
  const data = folder(t);
  const shell = start(data);
  const { serving, exited } = await shell.running;
  assert.deepEqual(shell.out[0], { kind: "ready", url: serving.url });
  assert.deepEqual(shell.out[1], { id: 1, kind: "secret.get", name: "jira" });
  assert.equal(keptPort(data), serving.port);

  assert.equal((await fetch(serving.url)).status, 403);
  const page = await fetch(serving.url, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="app">/);
  const url = await reviewLink(serving);
  assert.equal(new URL(url).origin, new URL(serving.url).origin);
  const token = new URL(url).pathname.split("/").at(-1);
  // As a reviewer, with no cookie.
  assert.equal((await send(serving.url, new URL(url).pathname, undefined, false)).status, 200);
  assert.equal((await send(serving.url, "/api/review/open", { token }, false)).status, 200);

  shell.input.end();
  assert.equal(await exited, 0);
  // Every line out was the channel's.
  assert.ok(shell.out.every((line) => ("id" in line ? true : line.kind === "ready")));
  assert.equal(shell.out.filter((line) => !("id" in line)).length, 1);
  // Closed, so the database opens again, and the link died at quit.
  open(join(data, "oriel.db"), { exclusive: true }).close();
  const after = await testApp(t, { db: join(data, "oriel.db") });
  assert.equal((await after.post("/api/review/open", { token })).status, 404);
});

test("SIGTERM quits as stdin's end does", async (t) => {
  const shell = start(folder(t));
  const { exited } = await shell.running;
  shell.signals.emit("SIGTERM");
  assert.equal(await exited, 0);
  assert.ok(shell.logged.some((line) => line.fields.why === "SIGTERM"));
});

test("a second server can't open a data folder's database while the first runs", async (t) => {
  const data = folder(t);
  const first = start(data);
  const { exited } = await first.running;
  const second = start(data);
  await assert.rejects(second.running, /locked/);
  first.input.end();
  assert.equal(await exited, 0);
});

test("the kept port is used again, a taken one moves up and is kept, and links left live are revoked", async (t) => {
  const data = folder(t);
  // A launch that made a review link and was killed: nothing ran at quit,
  // so the link is still live in the file.
  const first = start(data);
  const { serving } = await first.running;
  const token = new URL(await reviewLink(serving)).pathname.split("/").at(-1);
  await serving.close();
  const port = serving.port;

  // Something else holds the port now.
  const squatter = createServer();
  await new Promise<void>((resolve) => squatter.listen(port, "127.0.0.1", resolve));
  t.after(() => squatter.close());
  const next = start(data, 1);
  const moved = await next.running;
  assert.ok(moved.serving.port > port);
  assert.equal(keptPort(data), moved.serving.port);
  assert.ok(
    next.logged.some(
      (line) =>
        line.message === "desktop: revoked the review links an earlier launch left live" &&
        line.fields.count === 1 &&
        line.fields.moved === true,
    ),
  );
  assert.equal((await send(moved.serving.url, "/api/review/open", { token }, false)).status, 404);
  next.input.end();
  assert.equal(await moved.exited, 0);

  // With the port free again, the next launch keeps the one it has now.
  keepPort(data, moved.serving.port);
  const third = start(data, 1);
  const again = await third.running;
  assert.equal(again.serving.port, moved.serving.port);
  assert.ok(!third.logged.some((line) => line.message.startsWith("desktop: revoked")));
  third.input.end();
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

test("desktop mode's stdout carries only the channel: everything else written there goes to stderr", () => {
  const written: string[] = [];
  const errors: string[] = [];
  const stdout = {
    write: ((chunk: string) => written.push(chunk) > 0) as NodeJS.WriteStream["write"],
  };
  const stderr = {
    write: ((chunk: string) => errors.push(chunk) > 0) as NodeJS.WriteStream["write"],
  };
  const channelWrite = takeStdout(stdout, stderr);
  stdout.write("a stray log line\n");
  channelWrite('{"kind":"ready","url":"http://127.0.0.1:4320/"}\n');
  assert.deepEqual(written, ['{"kind":"ready","url":"http://127.0.0.1:4320/"}\n']);
  assert.deepEqual(errors, ["a stray log line\n"]);
});

test("asked to stop while starting, it stops at once, and closes what was starting", async (t) => {
  const data = folder(t);
  // A shell that doesn't answer yet: the app waits on the saved connection.
  const input = new PassThrough();
  const asked = Promise.withResolvers<void>();
  const signals = new EventEmitter();
  input.write(`${secret}\n`);
  const running = runDesktop({
    data,
    input,
    write: (line) => {
      if ("id" in (JSON.parse(line) as ServerLine)) asked.resolve();
    },
    log: () => {},
    signals,
    firstPort: 0,
    app: { now: () => instant(new Date(t0)), sandbox: fakeSandbox({}) },
  });
  await asked.promise;
  signals.emit("SIGTERM");
  const stopped = await running.then(
    () => assert.fail("it started"),
    (error: unknown) => error,
  );
  assert.ok(stopped instanceof Stopped);
  // The shell goes; what was starting finishes and is closed, so the
  // database can be opened again.
  input.end();
  await stopped.closed;
  open(join(data, "oriel.db"), { exclusive: true }).close();
});

test("asked to stop before the launch secret, it stops at once", async (t) => {
  const signals = new EventEmitter();
  const running = runDesktop({
    data: folder(t),
    input: new PassThrough(),
    write: () => assert.fail("nothing goes out"),
    log: () => {},
    signals,
    firstPort: 0,
  });
  signals.emit("SIGTERM");
  await assert.rejects(running, Stopped);
});

test("asked to stop while it looks for a model, it stops at once", async (t) => {
  const input = new PassThrough();
  const signals = new EventEmitter();
  const looking = Promise.withResolvers<void>();
  input.write(`${secret}\n`);
  const running = runDesktop({
    data: folder(t),
    input,
    write: () => assert.fail("nothing goes out"),
    log: () => {},
    signals,
    firstPort: 0,
    model: () => {
      looking.resolve();
      return new Promise(() => {});
    },
  });
  await looking.promise;
  input.end();
  await assert.rejects(running, Stopped);
});
