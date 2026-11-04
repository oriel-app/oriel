// Where connections keep their secrets (decision 0049): each under a name
// the server makes from the connection's ID, `connection.<ULID>`. For
// `pnpm dev`, a file of its own, readable by its owner only, in a folder
// named for the database, outside the repo's history (`secrets/` is
// gitignored and agents can't read it), as decision 0022 says. In the
// desktop app, the OS's own store for secrets, which the shell reaches for
// the server (decisions 0036, 0042). No message here carries a value from
// one.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { object, string, type Ulid } from "@oriel/core";
import { isSecretName } from "./desktop/protocol.ts";

// Secrets by name, kept wherever the OS keeps them, under the app's own
// name, which the store's owner fixes.
export type Secrets = {
  get(name: string): Promise<string | null>;
  set(name: string, secret: string): Promise<void>;
  delete(name: string): Promise<void>;
};

// A connection's secret's name, from its ID, which the server made: never
// one the page names.
export const secretName = (id: Ulid): string => `connection.${id}`;

const named = (name: string) => {
  if (!isSecretName(name)) throw new Error("not a secret's name");
  return name;
};

// One file per secret in `dir`, by its name, which can't leave it.
export function fileSecrets(dir: string): Secrets {
  const file = (name: string) => join(dir, named(name));
  return {
    async get(name) {
      try {
        return readFileSync(file(name), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("Oriel couldn't read a connection's secret");
      }
    },
    // Written whole and renamed into place, so a crash never leaves half a
    // file, and created readable by its owner only.
    async set(name, secret) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const next = `${file(name)}.${process.pid}.tmp`;
      writeFileSync(next, secret, { mode: 0o600 });
      renameSync(next, file(name));
    },
    async delete(name) {
      rmSync(file(name), { force: true });
    },
  };
}

// Secrets kept only while the server runs, as tests and a server given no
// store keep them.
export function memorySecrets(
  kept: Map<string, string> = new Map(),
): Secrets & { kept: Map<string, string> } {
  return {
    get: async (name) => kept.get(named(name)) ?? null,
    set: async (name, secret) => void kept.set(named(name), secret),
    delete: async (name) => void kept.delete(named(name)),
    kept,
  };
}

// Jira's saved connection from before connections: its site, account and
// project as one secret, `jira` in the OS's store and `secrets/jira.json`
// under `pnpm dev`. The first start after decision 0049 moves it into a
// connection and deletes it.
export type JiraConnection = { site: string; email: string; token: string; project: string };

export type LegacyJira = {
  load(): Promise<string | null>;
  delete(): Promise<void>;
};

export function legacyFile(path: string): LegacyJira {
  return {
    async load() {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("Oriel couldn't read its saved Jira connection");
      }
    },
    async delete() {
      rmSync(path, { force: true });
    },
  };
}

export function legacySecret(secrets: Secrets): LegacyJira {
  return { load: () => secrets.get("jira"), delete: () => secrets.delete("jira") };
}

const legacyShape = object({ site: string, email: string, token: string, project: string });
const jiraSecretShape = object({ email: string, token: string });

// Text kept as JSON, or null. JSON.parse's own message quotes the text,
// which holds the token, so it's never passed on.
const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export function parsedLegacy(text: string): JiraConnection | null {
  const read = legacyShape(parsedJson(text));
  return read.ok ? read.value : null;
}

// Jira's secret, as its connection keeps it: the account, one value.
export function parsedJiraSecret(text: string): { email: string; token: string } | null {
  const read = jiraSecretShape(parsedJson(text));
  return read.ok ? read.value : null;
}

// A Jira Cloud site as the user might type it: "acme", "acme.atlassian.net",
// or a link to any page on it. Its https origin, or null.
export function jiraSite(typed: string): string | null {
  const text = typed.trim().toLowerCase();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`;
  const url = URL.parse(withScheme);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.includes(".") ? url.hostname : `${url.hostname}.atlassian.net`;
  return /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(host) ? `https://${host}` : null;
}
