// The secret store (OA-188, decision 0039). Each secret the server keeps, by
// one of the fixed names it uses, is encrypted with Electron's safeStorage,
// whose key the OS keeps under Oriel's own name (the Keychain on macOS), and
// written to its own file in the data folder's `Secrets/`. Only ciphertext
// is ever on disk, and no secret is ever logged. The encryption is a
// parameter, so tests reach the files without Electron.
//
// Under `--background` or `--launch-file`, for development, secrets are kept
// in memory instead, so a launch from a script never reaches safe storage or
// the OS's key (rules.ts, secretsInMemory).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { secretNames } from "./rules.ts";

export type Crypt = {
  // Why nothing can be kept now, or null.
  problem(): Promise<string | null>;
  encrypt(text: string): Promise<Buffer>;
  // `stale`: the OS's key has moved on, so the file is written again.
  decrypt(data: Buffer): Promise<{ text: string; stale: boolean }>;
};

export type SecretStore = {
  get(name: string): Promise<string | null>;
  set(name: string, secret: string): Promise<void>;
  delete(name: string): Promise<void>;
};

const named = (name: string) => {
  if (!secretNames.includes(name)) throw new Error("not a secret's name");
  return name;
};

// The store the shell uses: in memory, where `os` is never called, or the
// OS's.
export function shellSecrets(inMemory: boolean, dir: string, os: () => Crypt): SecretStore {
  return inMemory ? memorySecrets() : secretStore(dir, os());
}

// Secrets kept only while the app runs, and gone when it quits.
export function memorySecrets(): SecretStore {
  const kept = new Map<string, string>();
  return {
    get: async (name) => kept.get(named(name)) ?? null,
    set: async (name, secret) => void kept.set(named(name), secret),
    delete: async (name) => void kept.delete(named(name)),
  };
}

export function secretStore(dir: string, crypt: Crypt): SecretStore {
  const file = (name: string) => join(dir, named(name));
  const usable = async () => {
    const problem = await crypt.problem();
    if (problem) throw new Error(problem);
  };
  // Written whole and renamed into place, readable by its owner only.
  const write = async (name: string, secret: string) => {
    const data = await crypt.encrypt(secret);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const next = `${file(name)}.${process.pid}.tmp`;
    writeFileSync(next, data, { mode: 0o600 });
    renameSync(next, file(name));
  };
  return {
    async get(name) {
      const path = file(name);
      await usable();
      let data: Buffer;
      try {
        data = readFileSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("the secret's file can't be read");
      }
      let read: { text: string; stale: boolean };
      try {
        read = await crypt.decrypt(data);
      } catch {
        // Safe storage's own message is fixed, but the text it couldn't
        // read never goes anywhere.
        throw new Error("the secret can't be decrypted with the OS's key");
      }
      if (read.stale) await write(name, read.text);
      return read.text;
    },
    async set(name, secret) {
      file(name);
      await usable();
      await write(name, secret);
    },
    // Needs no key: a secret that can't be read can still be forgotten.
    async delete(name) {
      rmSync(file(name), { force: true });
    },
  };
}
