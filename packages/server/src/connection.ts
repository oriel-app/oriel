// The Jira connection the user typed into the window, and where it's kept
// between runs: one file, readable by its owner only, outside the database
// and outside the repo's history (`secrets/` is gitignored and agents can't
// read it). No message here carries a value from it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { object, string } from "@oriel/core";

export type JiraConnection = { site: string; email: string; token: string; project: string };

export type ConnectionStore = {
  // The saved connection, or null before one is.
  load(): JiraConnection | null;
  save(connection: JiraConnection): void;
};

const connection = object({ site: string, email: string, token: string, project: string });

export function fileStore(path: string): ConnectionStore {
  return {
    load() {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("Oriel couldn't read its saved Jira connection");
      }
      // JSON.parse's own message quotes the text, which holds the token.
      const parsed = (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      })();
      const read = connection(parsed);
      if (!read.ok) throw new Error("Oriel's saved Jira connection isn't one it can read");
      return read.value;
    },
    // Written whole and renamed into place, so a crash never leaves half a
    // file, and created readable by its owner only.
    save(saved) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const next = `${path}.${process.pid}.tmp`;
      writeFileSync(next, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
      renameSync(next, path);
    },
  };
}

export function memoryStore(saved: JiraConnection | null = null): ConnectionStore & {
  saved(): JiraConnection | null;
} {
  let kept = saved;
  return {
    load: () => kept,
    save(next) {
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
