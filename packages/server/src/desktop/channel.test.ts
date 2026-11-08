import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { channel } from "./channel.ts";

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

test("a first line that isn't 64 lowercase hex characters is refused without quoting it", async () => {
  for (const line of ["AB".repeat(32), "ab".repeat(31), `${secret}0`, "", "not a secret"]) {
    const { input, lines } = open();
    input.write(`${line}\n`);
    await assert.rejects(lines.secret, (error: Error) => !error.message.includes(line || "\u0000"));
  }
});

test("a request the protocol doesn't allow is never sent", async () => {
  const { input, out, lines } = open();
  input.write(`${secret}\n`);
  lines.ready("http://127.0.0.1:4320/");
  await assert.rejects(lines.shell.ask({ kind: "secret.get", name: "../Jira" }), Error);
  // Only the names the server keeps: the API key, each connection's by its
  // ULID, and the Jira connection kept before connections.
  await assert.rejects(lines.shell.ask({ kind: "secret.get", name: "slack" }), Error);
  for (const name of [
    "connection.01jc0nnect10nsst0red0000ab",
    "connection.01JC0NNECT10NSST0RED0000AB.tmp",
    "connection.01JC0NNECT10NSST0RED0000A",
    "connection.../C0NNECT10NSST0RED0000AB",
    "slack.01JC0NNECT10NSST0RED0000AB",
  ])
    await assert.rejects(lines.shell.ask({ kind: "secret.get", name }), Error, name);
  await assert.rejects(
    lines.shell.ask({ kind: "secret.delete", name: "anthropic-key.old" }),
    Error,
  );
  await assert.rejects(
    lines.shell.ask({ kind: "secret.set", name: "jira", secret: "x".repeat(16_385) }),
    Error,
  );
  assert.equal(out.length, 1);
  lines.shell
    .ask({ kind: "secret.get", name: "connection.01JC0NNECT10NSST0RED0000AB" })
    .catch(() => {});
  assert.equal(out.length, 2);
});
