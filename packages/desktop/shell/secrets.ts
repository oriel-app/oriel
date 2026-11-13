// Only ciphertext is ever on disk, and no secret is ever logged.
import {
  type Dirent,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isSecretName } from "./rules.ts";

export type Crypt = {
  problem(): Promise<string | null>;
  encrypt(text: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<{ text: string; stale: boolean }>;
};

export type SecretStore = {
  get(name: string): Promise<string | null>;
  set(name: string, secret: string): Promise<void>;
  delete(name: string): Promise<void>;
};

const named = (name: string) => {
  if (!isSecretName(name)) throw new Error("not a secret's name");
  return name;
};

export function shellSecrets(inMemory: boolean, dir: string, os: () => Crypt): SecretStore {
  return inMemory ? memorySecrets() : secretStore(dir, os());
}

export function memorySecrets(): SecretStore {
  const kept = new Map<string, string>();
  return {
    get: async (name) => kept.get(named(name)) ?? null,
    set: async (name, secret) => void kept.set(named(name), secret),
    delete: async (name) => void kept.delete(named(name)),
  };
}

const retired = (name: string) =>
  name === "jira" ||
  name === "anthropic-key" ||
  /^connection\.[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(name);

export function secretStore(dir: string, crypt: Crypt): SecretStore {
  const file = (name: string) => join(dir, named(name));
  let kept: Dirent[] = [];
  try {
    kept = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A folder the store can't reach mustn't stop the app opening: its own reads and writes say so.
  }
  for (const each of kept)
    if (each.isFile() && retired(each.name)) rmSync(join(dir, each.name), { force: true });
  const usable = async () => {
    const problem = await crypt.problem();
    if (problem) throw new Error(problem);
  };
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
        // Not safe storage's error: the text it couldn't read must go nowhere.
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
