// What the desktop shell decides, apart from Electron, so tests reach it:
// the server's environment, the server's lines, the channel's requests, and
// where the window may go. main.ts does the rest. The protocol is
// packages/server/src/desktop/PROTOCOL.md.
import { join, resolve } from "node:path";

// One request the shell answers. Anything else is refused.
export type Request =
  | { kind: "folder.pick"; prompt: string }
  | { kind: "secret.get"; name: string }
  | { kind: "secret.set"; name: string; secret: string }
  | { kind: "secret.delete"; name: string }
  | { kind: "notify"; title: string; body: string; open: string }
  | { kind: "window.focus" };

export type Parsed =
  | { id: number; request: Request }
  | { id: number; refused: string }
  | { id: null; refused: string };

// The secrets the server keeps, by the fixed names it uses: the Jira
// connection, and the API key the agent can run on (OA-188). Any other name
// is refused.
export const secretNames: readonly string[] = ["jira", "anthropic-key"];
const maxSecret = 16_384;

// A line from the server after its first: a request with a positive integer
// id, or why it's refused. A refusal with an id gets an answer; one without
// can't.
export function parseRequest(line: string): Parsed {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return { id: null, refused: "not JSON" };
  }
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return { id: null, refused: "not a JSON object" };
  const fields = message as Record<string, unknown>;
  const { id } = fields;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    return { id: null, refused: "no id" };
  const text = (key: string) => (typeof fields[key] === "string" ? fields[key] : null);
  const name = text("name");
  const named = name !== null && secretNames.includes(name) ? name : null;
  switch (fields.kind) {
    case "folder.pick": {
      const prompt = text("prompt");
      return prompt === null
        ? { id, refused: "a folder pick needs a prompt" }
        : { id, request: { kind: "folder.pick", prompt: prompt.slice(0, 200) } };
    }
    case "secret.get":
    case "secret.delete":
      return named === null
        ? { id, refused: "not a secret's name" }
        : { id, request: { kind: fields.kind, name: named } };
    case "secret.set": {
      const secret = text("secret");
      if (named === null) return { id, refused: "not a secret's name" };
      if (secret === null || Buffer.byteLength(secret) > maxSecret)
        return { id, refused: "a secret is text of at most 16 KiB" };
      return { id, request: { kind: "secret.set", name: named, secret } };
    }
    case "notify": {
      const title = text("title");
      const body = text("body");
      const open = text("open");
      if (title === null || body === null)
        return { id, refused: "a notification needs a title and a body" };
      if (open === null || open.length > 200 || !/^\/(?![/\\])[!-~]*$/.test(open))
        return { id, refused: "a notification opens a path on the server's origin" };
      return {
        id,
        request: { kind: "notify", title: title.slice(0, 256), body: body.slice(0, 1024), open },
      };
    }
    case "window.focus":
      return { id, request: { kind: "window.focus" } };
    default:
      return { id, refused: "not a request the shell answers" };
  }
}

// The server's first line, `{"kind":"ready","url":"http://127.0.0.1:<port>/"}`:
// its origin, or null for anything else.
export function readyOrigin(line: string): string | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const { kind, url } = message as Record<string, unknown>;
  if (kind !== "ready" || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.port === "")
    return null;
  return parsed.origin;
}

// Whether the window may show `url`: the server's own origin, and nothing
// else, apart from a frame's about:blank or about:srcdoc.
export function mayShow(url: string, origin: string | null, mainFrame: boolean): boolean {
  if (!mainFrame && (url === "about:blank" || url === "about:srcdoc")) return true;
  try {
    return origin !== null && new URL(url).origin === origin;
  } catch {
    return false;
  }
}

// The one permission a page may have: writing text to the clipboard, which
// Copy needs, from the server's own origin. The page can't read the
// clipboard, and every other permission is refused.
export function mayUse(permission: string, requesting: string, origin: string | null): boolean {
  if (permission !== "clipboard-sanitized-write" || origin === null) return false;
  try {
    return new URL(requesting).origin === origin;
  } catch {
    return false;
  }
}

// The link on the stopped page that starts the server again. The shell acts
// on it only while the server is stopped.
export const restartUrl = "http://restart.oriel.invalid/";

// Whether a link the window won't show goes to the default browser: http and
// https only.
export function opensOutside(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Why the OS can't keep a secret for Oriel now, or null when it can. Only
// ciphertext is ever written, so with no key from the OS, or on Linux with
// no keyring, where safeStorage would fall back to a fixed key, nothing is
// kept at all.
export function storageProblem(
  platform: string,
  available: boolean,
  backend: string | null,
): string | null {
  if (!available) return "the OS secret store isn't available";
  if (
    platform === "linux" &&
    (backend === null || backend === "basic_text" || backend === "unknown")
  )
    return "there's no keyring, so the secret store would use a fixed key";
  return null;
}

// Whether safe storage encrypted with a fixed key after all: on Linux,
// ciphertext starting `v10` is under Chromium's hardcoded key, which it
// falls back to when the keyring it picked fails. Such text is never kept.
export function fixedKey(platform: string, ciphertext: Uint8Array): boolean {
  return platform === "linux" && Buffer.from(ciphertext.subarray(0, 3)).toString() === "v10";
}

// A notification's text as the OS shows it: plain text on one line. A
// thread's title is synced data, so on Linux, whose notification servers
// read a body's tags, `&`, `<` and `>` are escaped.
export function notificationText(platform: string, text: string): string {
  // oxlint-disable-next-line no-control-regex
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return platform === "linux"
    ? line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)
    : line;
}

// Splits a stream into lines, dropping any line longer than `max` bytes.
export class Lines {
  private buffer = "";
  private dropping = false;
  private readonly max: number;
  private readonly dropped: () => void;
  constructor(max: number, dropped: () => void) {
    this.max = max;
    this.dropped = dropped;
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, at).replace(/\r$/, "");
      this.buffer = this.buffer.slice(at + 1);
      if (this.dropping) this.dropping = false;
      else if (Buffer.byteLength(line) > this.max) this.dropped();
      else lines.push(line);
    }
    if (Buffer.byteLength(this.buffer) > this.max) {
      if (!this.dropping) this.dropped();
      this.buffer = "";
      this.dropping = true;
    }
    return lines;
  }
}

// PATH as a login shell printed it between two marker lines, which keep out
// whatever its startup files print; null if it printed none.
export const pathStart = "__ORIEL_PATH_START__";
export const pathEnd = "__ORIEL_PATH_END__";
export function printedPath(output: string): string | null {
  const start = output.indexOf(`${pathStart}\n`);
  if (start < 0) return null;
  const from = start + pathStart.length + 1;
  const end = output.indexOf(`\n${pathEnd}`, from);
  if (end < 0) return null;
  const path = output.slice(from, end).trim();
  return path === "" || path.includes("\n") ? null : path;
}

// The server's PATH: the bundle's Deno first, then the person's own PATH,
// then the usual install folders, absolute and each once.
export function serverPath(deno: string, found: string | null, home: string): string {
  const usual = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    join(home, ".local/bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const dirs = [deno, ...(found ?? "").split(":"), ...usual].filter((dir) => dir.startsWith("/"));
  return [...new Set(dirs)].join(":");
}

// LANG as the shell's own environment has it, or else from the system's
// locale, such as `en-GB`.
export function lang(own: string | undefined, locale: string): string {
  if (own) return own;
  const [language, region] = locale.split(/[-_]/);
  if (!language || !/^[a-z]{2,3}$/i.test(language)) return "en_US.UTF-8";
  return region && /^[a-z]{2}$/i.test(region)
    ? `${language.toLowerCase()}_${region.toUpperCase()}.UTF-8`
    : `${language.toLowerCase()}.UTF-8`;
}

// Where the shell keeps things. `--data <dir>` moves all of it, logs included,
// for development and tests.
export function folders(
  argv: readonly string[],
  home: string,
): { data: string; logs: string; shell: string } {
  const at = argv.indexOf("--data");
  const given = at >= 0 && argv[at + 1] ? resolve(argv[at + 1]!) : undefined;
  const data = given ?? join(home, "Library/Application Support/Oriel");
  const logs = given ? join(given, "Logs") : join(home, "Library/Logs/Oriel");
  return { data, logs, shell: join(data, "Shell") };
}
