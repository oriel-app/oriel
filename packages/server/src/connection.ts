// The Jira connection the user typed into the window, and where it's kept
// between runs. For `pnpm dev`, one file, readable by its owner only,
// outside the database and outside the repo's history (`secrets/` is
// gitignored and agents can't read it), as decision 0022 says. In the desktop
// app, the OS's own store for secrets, which the shell reaches for the
// server (decision 0036). No message here carries a value from it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { object, string } from "@oriel/core";

export type JiraConnection = { site: string; email: string; token: string; project: string };

export type ConnectionStore = {
  // The saved connection, or null before one is.
  load(): Promise<JiraConnection | null>;
  save(connection: JiraConnection): Promise<void>;
};

// Secrets by name, kept wherever the OS keeps them, under the app's own
// name, which the store's owner fixes.
export type Secrets = {
  get(name: string): Promise<string | null>;
  set(name: string, secret: string): Promise<void>;
};

const connection = object({ site: string, email: string, token: string, project: string });

export function fileStore(path: string): ConnectionStore {
  return {
    async load() {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("Oriel couldn't read its saved Jira connection");
      }
      const read = parsed(text);
      if (!read) throw new Error("Oriel's saved Jira connection isn't one it can read");
      return read;
    },
    // Written whole and renamed into place, so a crash never leaves half a
    // file, and created readable by its owner only.
    async save(saved) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const next = `${path}.${process.pid}.tmp`;
      writeFileSync(next, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
      renameSync(next, path);
    },
  };
}

// The connection a store for secrets holds for Jira. One it can't reach or read is
// taken as none, so the window asks for Jira again rather than the app not
// starting; the reason is logged, never the value.
export function secretsStore(
  secrets: Secrets,
  log: (message: string, fields: Record<string, unknown>) => void,
): ConnectionStore {
  const name = "jira";
  return {
    async load() {
      let text: string | null;
      try {
        text = await secrets.get(name);
      } catch {
        log("jira: the store for secrets didn't answer", {});
        return null;
      }
      if (text === null) return null;
      const read = parsed(text);
      if (!read) log("jira: the saved connection isn't one Oriel can read", {});
      return read;
    },
    save: (saved) => secrets.set(name, JSON.stringify(saved)),
  };
}

// A saved connection, or null. JSON.parse's own message quotes the text,
// which holds the token, so it's never passed on.
function parsed(text: string): JiraConnection | null {
  const value = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();
  const read = connection(value);
  return read.ok ? read.value : null;
}

export function memoryStore(saved: JiraConnection | null = null): ConnectionStore & {
  saved(): JiraConnection | null;
} {
  let kept = saved;
  return {
    load: async () => kept,
    async save(next) {
      kept = { ...next };
    },
    saved: () => kept,
  };
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
