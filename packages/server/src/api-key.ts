// The Anthropic API key the agent can run on, on the desktop app (decisions
// 0036 and 0038): kept in the OS secret store through the shell, never in
// settings.json or the database. Settings sets and removes it, after one
// small request checks that Anthropic takes it. Under `pnpm dev` the key is
// `.env`'s, and the page can't set one. No reply, log or error carries it.
import { type KeyCheck, checkKey } from "@oriel/agent";
import type { Log } from "@oriel/core";
import type { Secrets } from "./connection.ts";

// Its name in the secret store, which the shell takes only among a fixed few.
export const apiKeyName = "anthropic-key";

export type KeyStore = {
  // The key, or null. Read from the store once, then kept in memory; a store
  // that doesn't answer is taken as no key, and asked again next time.
  get(): Promise<string | null>;
  set(key: string): Promise<void>;
  delete(): Promise<void>;
};

export function keyStore(secrets: Secrets, log: Log): KeyStore {
  let kept: Promise<string | null> | null = null;
  return {
    get() {
      kept ??= secrets.get(apiKeyName).then(
        (key) => (key !== null && keyShape(key) ? key : null),
        () => {
          kept = null;
          log("api key: the secret store didn't answer", {});
          return null;
        },
      );
      return kept;
    },
    async set(key) {
      await secrets.set(apiKeyName, key);
      kept = Promise.resolve(key);
    },
    async delete() {
      await secrets.delete(apiKeyName);
      kept = Promise.resolve(null);
    },
  };
}

// What a header can hold, as `.env`'s key must be too: printable ASCII,
// with no space.
export const keyShape = (key: string): boolean => /^[!-~]{1,512}$/.test(key);

export class KeyRefused extends Error {}

// Checks `typed` and keeps it, or says why not, in words that never quote it.
export async function keepKey(
  store: KeyStore,
  typed: string,
  check: (key: string) => Promise<KeyCheck> = (key) => checkKey(key),
): Promise<void> {
  const key = typed.trim();
  if (!keyShape(key)) throw new KeyRefused("That isn't an API key. Paste the whole key.");
  const checked = await check(key);
  if (checked === "rejected")
    throw new KeyRefused("Anthropic doesn't accept that key. Check it on Anthropic's console.");
  if (checked === "unreachable")
    throw new KeyRefused("Oriel couldn't reach Anthropic to check the key. Try again.");
  try {
    await store.set(key);
  } catch {
    throw new KeyRefused("Oriel couldn't keep the key: the OS secret store didn't take it.");
  }
}
