import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { type Crypt, secretStore, shellSecrets } from "../shell/secrets.ts";

// Stands in for safe storage: a fixed XOR, enough to tell ciphertext from
// the secret on disk.
function fakeCrypt(state: { problem?: string; stale?: boolean; broken?: boolean } = {}) {
  const flip = (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0x5a));
  const crypt: Crypt = {
    problem: async () => state.problem ?? null,
    encrypt: async (text) => Buffer.concat([Buffer.from("v10"), flip(Buffer.from(text))]),
    async decrypt(data) {
      if (state.broken || data.subarray(0, 3).toString() !== "v10") throw new Error("bad");
      return { text: flip(data.subarray(3)).toString(), stale: state.stale ?? false };
    },
  };
  return { crypt, state };
}

function folder(t: TestContext): string {
  const data = mkdtempSync(join(tmpdir(), "oriel-secrets-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  return join(data, "Secrets");
}

test("a secret is kept as ciphertext in its own file, readable by its owner only", async (t) => {
  const dir = folder(t);
  const { crypt } = fakeCrypt();
  const store = secretStore(dir, crypt);
  assert.equal(await store.get("anthropic-key"), null);
  const secret = "sk-ant-api03-tok-123";
  await store.set("anthropic-key", secret);
  assert.equal(await store.get("anthropic-key"), secret);
  const onDisk = readFileSync(join(dir, "anthropic-key"));
  assert.ok(!onDisk.toString("latin1").includes("tok-123"));
  assert.equal(statSync(join(dir, "anthropic-key")).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  // Nothing else is left beside it, such as the temporary file.
  assert.deepEqual(readdirSync(dir), ["anthropic-key"]);
  // Set again, it takes the old one's place.
  await store.set("anthropic-key", "sk-ant-x");
  assert.equal(await store.get("anthropic-key"), "sk-ant-x");
  assert.deepEqual(readdirSync(dir), ["anthropic-key"]);
});

test("delete forgets a secret, and a missing one is fine", async (t) => {
  const dir = folder(t);
  const { crypt, state } = fakeCrypt();
  const store = secretStore(dir, crypt);
  await store.delete("anthropic-key");
  await store.set("anthropic-key", "s");
  // Even when the OS's key is gone, a secret can be forgotten.
  state.problem = "the OS secret store isn't available";
  await store.delete("anthropic-key");
  state.problem = undefined;
  assert.equal(await store.get("anthropic-key"), null);
});

test("with no key from the OS, nothing is read or written, and never as plaintext", async (t) => {
  const dir = folder(t);
  const { crypt, state } = fakeCrypt({ problem: "there's no keyring" });
  const store = secretStore(dir, crypt);
  await assert.rejects(store.set("anthropic-key", "s"));
  assert.throws(() => readdirSync(dir), { code: "ENOENT" });
  state.problem = undefined;
  await store.set("anthropic-key", "s");
  state.problem = "there's no keyring";
  await assert.rejects(store.get("anthropic-key"));
});

test("only the server's own names are kept", async (t) => {
  const dir = folder(t);
  const store = secretStore(dir, fakeCrypt().crypt);
  await store.set("anthropic-key", "s");
  assert.deepEqual(readdirSync(dir), ["anthropic-key"]);
  // No connection keeps one since decision 0059, nor does Jira's from
  // before connections.
  for (const name of [
    "jira",
    "connection.01JC0NNECT10NSST0RED0000AB",
    "../jira",
    "slack",
    "Secrets",
    "jira.123.tmp",
    "connection.01jc0nnect10nsst0red0000ab",
    "connection.01JC0NNECT10NSST0RED0000AB.123.tmp",
    "connection../JC0NNECT10NSST0RED0000AB",
  ]) {
    await assert.rejects(store.get(name), name);
    await assert.rejects(store.set(name, "s"), name);
    await assert.rejects(store.delete(name), name);
  }
});

test("a file the OS's key can't open is an error that quotes nothing", async (t) => {
  const dir = folder(t);
  const { crypt, state } = fakeCrypt();
  const store = secretStore(dir, crypt);
  await store.set("anthropic-key", "tok-123");
  state.broken = true;
  await assert.rejects(store.get("anthropic-key"), (error: Error) => {
    assert.ok(!error.message.includes("tok-123"));
    assert.ok(!error.message.includes("v10"));
    return true;
  });
});

test("a secret under a key the OS has moved on from is written again", async (t) => {
  const dir = folder(t);
  const { crypt, state } = fakeCrypt();
  const store = secretStore(dir, crypt);
  await store.set("anthropic-key", "tok");
  const before = statSync(join(dir, "anthropic-key")).ino;
  state.stale = true;
  assert.equal(await store.get("anthropic-key"), "tok");
  assert.notEqual(statSync(join(dir, "anthropic-key")).ino, before);
});

test("secrets kept in memory never reach safe storage", async (t) => {
  const dir = folder(t);
  let reached = 0;
  const os = () => {
    reached++;
    return fakeCrypt().crypt;
  };
  const store = shellSecrets(true, dir, os);
  assert.equal(await store.get("anthropic-key"), null);
  await store.set("anthropic-key", "tok-123");
  assert.equal(await store.get("anthropic-key"), "tok-123");
  await store.delete("anthropic-key");
  assert.equal(await store.get("anthropic-key"), null);
  await assert.rejects(store.set("slack", "s"));
  assert.equal(reached, 0);
  assert.throws(() => readdirSync(dir), { code: "ENOENT" });
  // Otherwise, the OS's store.
  await shellSecrets(false, dir, os).set("anthropic-key", "tok-123");
  assert.equal(reached, 1);
  assert.deepEqual(readdirSync(dir), ["anthropic-key"]);
});

test("the secrets an older Oriel kept, for connections and the API key, are deleted as the store opens, and nothing else", async (t) => {
  const dir = folder(t);
  mkdirSync(dir, { recursive: true });
  const { crypt } = fakeCrypt();
  await secretStore(dir, crypt).set("anthropic-key", "sk-ant-kept");
  // A folder of an old secret's name, sorted first, doesn't stop the rest.
  mkdirSync(join(dir, "connection.01JB0000000000000000000000"));
  for (const name of [
    "jira",
    "connection.01JC0000000000000000000000",
    "connection.ZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    "connection.x",
    "notes",
  ])
    writeFileSync(join(dir, name), "ciphertext");
  const store = secretStore(dir, crypt);
  assert.deepEqual(readdirSync(dir).toSorted(), [
    "connection.01JB0000000000000000000000",
    "connection.ZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    "connection.x",
    "notes",
  ]);
  assert.equal(await store.get("anthropic-key"), null);
});
