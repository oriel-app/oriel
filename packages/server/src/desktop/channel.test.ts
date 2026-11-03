import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { channel, ShellGone } from "./channel.ts";

const secret = "ab".repeat(32);

function open() {
  const input = new PassThrough();
  const out: unknown[] = [];
  const logged: string[] = [];
  const lines = channel(
    input,
    (line) => {
      assert.ok(line.endsWith("\n") && !line.slice(0, -1).includes("\n"), "one line");
      out.push(JSON.parse(line));
    },
    (message) => logged.push(message),
  );
  const send = (value: unknown) => input.write(`${JSON.stringify(value)}\n`);
  return { input, out, logged, lines, send };
}

test("the first line is the launch secret", async () => {
  const { input, lines } = open();
  input.write(`${secret}\n`);
  assert.equal(await lines.secret, secret);
});

test("a first line that isn't 64 lowercase hex characters is refused without quoting it", async () => {
  for (const line of ["AB".repeat(32), "ab".repeat(31), `${secret}0`, "", "not a secret"]) {
    const { input, lines } = open();
    input.write(`${line}\n`);
    await assert.rejects(
      lines.secret,
      (error: Error) =>
        !error.message.includes(line || "\u0000") && /launch secret/.test(error.message),
    );
  }
});

test("stdin ending before the secret is refused", async () => {
  const { input, lines } = open();
  input.end();
  await assert.rejects(lines.secret, /before the launch secret/);
  await lines.ended;
});

test("the ready line goes first, and requests asked before it follow it", async () => {
  const { input, out, lines, send } = open();
  input.write(`${secret}\n`);
  await lines.secret;
  const got = lines.shell.ask({ kind: "secret.get", name: "jira" });
  assert.deepEqual(out, []);
  lines.ready("http://127.0.0.1:4320/");
  assert.deepEqual(out, [
    { kind: "ready", url: "http://127.0.0.1:4320/" },
    { id: 1, kind: "secret.get", name: "jira" },
  ]);
  send({ id: 1, ok: true, value: "kept" });
  assert.equal(await got, "kept");
});

test("answers are matched by id, in any order", async () => {
  const { input, out, lines, send } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  const folder = lines.shell.ask({ kind: "folder.pick", prompt: "Connect a folder" });
  const kept = lines.shell.ask({ kind: "secret.set", name: "jira", secret: "{}" });
  const told = lines.shell.ask({ kind: "notify", title: "Changed", body: "SYN-21 changed." });
  assert.deepEqual(
    out.slice(1).map((line) => (line as { id: number }).id),
    [1, 2, 3],
  );
  send({ id: 3, ok: true, value: null });
  send({ id: 1, ok: true, value: "/Users/sam/notes" });
  send({ id: 2, ok: true, value: null });
  assert.deepEqual(await Promise.all([folder, kept, told]), ["/Users/sam/notes", null, null]);
});

test("a cancelled pick and a missing secret are null", async () => {
  const { input, lines, send } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  const folder = lines.shell.ask({ kind: "folder.pick", prompt: "Connect a folder" });
  const missing = lines.shell.ask({ kind: "secret.get", name: "jira" });
  send({ id: 1, ok: true, value: null });
  send({ id: 2, ok: true, value: null });
  assert.deepEqual(await Promise.all([folder, missing]), [null, null]);
});

test("a refusal, or an answer of the wrong shape, rejects the request", async () => {
  const { input, lines, send, logged } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  const refused = lines.shell.ask({ kind: "secret.get", name: "jira" });
  const relative = lines.shell.ask({ kind: "folder.pick", prompt: "Connect a folder" });
  const wrong = lines.shell.ask({ kind: "secret.delete", name: "jira" });
  send({ id: 1, ok: false, error: "the person said no" });
  send({ id: 2, ok: true, value: "notes" });
  send({ id: 3, ok: true, value: "deleted" });
  await assert.rejects(refused, /refused secret.get/);
  await assert.rejects(relative, /folder.pick/);
  await assert.rejects(wrong, /secret.delete/);
  assert.equal(logged.length, 3);
});

test("lines that aren't answers, or answer nothing asked, are logged and dropped", async () => {
  const { input, lines, send, logged } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  const got = lines.shell.ask({ kind: "secret.get", name: "jira" });
  input.write("not json\n");
  send({ id: 1 });
  send({ id: 7, ok: true, value: null });
  send({ id: 1, ok: true, value: "kept" });
  send({ id: 1, ok: true, value: "again" });
  assert.equal(await got, "kept");
  input.end();
  await lines.ended;
  assert.deepEqual(logged, [
    "desktop: a line from the shell isn't an answer",
    "desktop: a line from the shell isn't an answer",
    "desktop: the shell answered a request it wasn't asked",
    "desktop: the shell answered a request it wasn't asked",
  ]);
});

test("a request the protocol doesn't allow is never sent", async () => {
  const { input, out, lines } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  await assert.rejects(lines.shell.ask({ kind: "secret.get", name: "../Jira" }), /isn't a request/);
  await assert.rejects(
    lines.shell.ask({ kind: "secret.set", name: "jira", secret: "x".repeat(16_385) }),
    /isn't a request/,
  );
  assert.equal(out.length, 1);
});

test("when stdin ends, waiting requests and later ones reject as the shell gone", async () => {
  const { input, lines } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  const waiting = lines.shell.ask({ kind: "folder.pick", prompt: "Connect a folder" });
  input.end();
  await lines.ended;
  await assert.rejects(waiting, ShellGone);
  await assert.rejects(lines.shell.ask({ kind: "secret.get", name: "jira" }), ShellGone);
});

test("a CRLF line ending is taken as LF", async () => {
  const { input, lines } = open();
  input.write(`${secret}\r\n`);
  assert.equal(await lines.secret, secret);
  lines.ready("http://127.0.0.1:4320/");
  const got = lines.shell.ask({ kind: "secret.get", name: "jira" });
  input.write(`${JSON.stringify({ id: 1, ok: true, value: "kept" })}\r\n`);
  assert.equal(await got, "kept");
});
