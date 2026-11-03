// The API key on the desktop app (OA-188): kept in the OS secret store
// through the shell, read once, checked with Anthropic before it's kept, and
// never quoted in an error.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { KeyCheck } from "@oriel/agent";
import { apiKeyName, keepKey, KeyRefused, keyStore } from "./api-key.ts";
import type { Secrets } from "./connection.ts";

const key = "sk-ant-api-key-test-value";

function memorySecrets(): Secrets & { kept: Map<string, string>; asked: number; down: boolean } {
  const kept = new Map<string, string>();
  const secrets = {
    kept,
    asked: 0,
    down: false,
    async get(name: string) {
      secrets.asked++;
      if (secrets.down) throw new Error("the shell refused secret.get");
      return kept.get(name) ?? null;
    },
    async set(name: string, secret: string) {
      if (secrets.down) throw new Error("the shell refused secret.set");
      kept.set(name, secret);
    },
    async delete(name: string) {
      kept.delete(name);
    },
  };
  return secrets;
}

test("the key is read from the store once, kept, and forgotten under its one name", async () => {
  const secrets = memorySecrets();
  const store = keyStore(secrets, () => {});
  assert.equal(await store.get(), null);
  assert.equal(await store.get(), null);
  assert.equal(secrets.asked, 1);
  await store.set(key);
  assert.deepEqual([...secrets.kept], [[apiKeyName, key]]);
  assert.equal(await store.get(), key);
  await store.delete();
  assert.equal(secrets.kept.size, 0);
  assert.equal(await store.get(), null);
  assert.equal(secrets.asked, 1);
});

test("a store that doesn't answer is no key, logged without it, and asked again", async () => {
  const secrets = memorySecrets();
  secrets.kept.set(apiKeyName, key);
  secrets.down = true;
  const logged: unknown[] = [];
  const store = keyStore(secrets, (message, fields) => logged.push([message, fields]));
  assert.equal(await store.get(), null);
  assert.doesNotMatch(JSON.stringify(logged), new RegExp(key));
  secrets.down = false;
  assert.equal(await store.get(), key);
  // A value a header can't hold is none.
  secrets.kept.set(apiKeyName, "two words");
  assert.equal(await keyStore(secrets, () => {}).get(), null);
});

test("a key is kept only once Anthropic takes it, and a refusal never quotes it", async () => {
  const secrets = memorySecrets();
  const store = keyStore(secrets, () => {});
  const checked: string[] = [];
  const answering =
    (answer: KeyCheck) =>
    async (typed: string): Promise<KeyCheck> => {
      checked.push(typed);
      return answer;
    };
  const refused = async (typed: string, answer: KeyCheck, why: RegExp) =>
    assert.rejects(keepKey(store, typed, answering(answer)), (error: Error) => {
      assert.ok(error instanceof KeyRefused);
      assert.match(error.message, why);
      assert.ok(!error.message.includes(typed.trim()) || typed.trim() === "");
      return true;
    });
  await refused("", "ok", /isn't an API key/);
  await refused("sk-ant two", "ok", /isn't an API key/);
  assert.deepEqual(checked, []);
  await refused(key, "rejected", /doesn't accept that key/);
  await refused(key, "unreachable", /couldn't reach Anthropic/);
  assert.equal(secrets.kept.size, 0);
  await keepKey(store, `  ${key}\n`, answering("ok"));
  assert.equal(secrets.kept.get(apiKeyName), key);
  assert.equal(checked.at(-1), key);
  secrets.down = true;
  await refused(key, "ok", /secret store didn't take it/);
});
