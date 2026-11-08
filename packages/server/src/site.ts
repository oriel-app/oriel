import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { defaultTheme } from "@oriel/web/themes";
import { settingsSections, type TextSize } from "@oriel/web/view";
import { hasLaunchSecret, refusal } from "./guard.ts";

// Everything the server serves. Paths are absolute.
export type Site = {
  port: number;
  // The web app's compiled modules, served under /app/, and its entry module.
  dist: string;
  entry: string;
  // Static files, served under /assets/.
  assets: string;
  // Bare specifier → ES module file, served at `vendorPath(specifier)` and
  // named in the page's import map. Only these files are served.
  vendor: ReadonlyMap<string, string>;
  // The person's theme and text size, which the page's <html> carries, so
  // its first paint is right with no script (decision 0034). The default
  // ones when absent.
  look?: () => Look;
  // The JSON routes under /api/, past the guard; null for a path it doesn't
  // have, which then 404s.
  api?: (request: Request, url: URL) => Promise<Reply | null>;
  // In the desktop app, the launch secret every request but a review link's
  // must carry in this cookie (decision 0036). `pnpm dev` has none.
  launch?: { cookie: string; secret: string };
  // Where the first run is (decision 0038): until it has finished, every
  // page opens it; once finished, it never shows again. Absent under
  // `pnpm dev`, which has no first run.
  firstRun?: () => "pending" | "finished";
  // The sketch origin, which the window's pages may frame, and a review
  // link's page may not (decision 0033).
  sketches?: string;
};

export type Request = {
  method: string;
  url: string;
  headers: {
    host?: string;
    origin?: string;
    cookie?: string;
    "content-type"?: string;
    "last-event-id"?: string | string[];
  };
  // Reads the body, or null when it is longer than `limit` bytes. A route
  // that takes no body never reads it.
  body?: (limit: number) => Promise<string | null>;
};

// A reply with a `stream` sends it after `body`, chunk by chunk, until it
// ends or the client leaves, when its iterator's `return` is called.
export type Reply = {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
  stream?: AsyncIterable<string>;
};

const types: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export type Look = { theme: string; textSize: TextSize };
const defaultLook: Look = { theme: defaultTheme, textSize: "default" };

// The page's <html>, with the attributes a look other than the default sets.
// A theme's name is one window.css has, which Settings checked.
export function htmlTag({ theme, textSize }: Look): string {
  const themed = theme === defaultTheme ? "" : ` data-theme="${theme}"`;
  const sized = textSize === "default" ? "" : ` data-text-size="${textSize}"`;
  return `<html lang="en"${themed}${sized}>`;
}

// Every reply carries these. A review link's page relies on two of them: no
// referrer, so its token never leaves in a Referer header, and no caching.
// `frames`: the one origin a page may frame, the sketch origin; a review
// link's page frames nothing.
export function securityHeaders(
  importMapHash: string,
  frames: string | null = null,
): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'self' 'sha256-${importMapHash}'`,
      "style-src 'self'",
      "img-src 'self'",
      "connect-src 'self'",
      ...(frames ? [`frame-src ${frames}`] : []),
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

// The app's own pages: each is the same shell, which routes in the browser.
const ulidPath = "[0-9A-HJKMNP-TV-Z]{26}";
const pagePaths = [
  /^\/$/,
  /^\/browse$/,
  /^\/done$/,
  // Providers, the first, is /settings itself.
  new RegExp(`^/settings(?:/(?:${settingsSections.slice(1).join("|")}))?$`),
  /^\/setup$/,
  new RegExp(`^/workstreams/${ulidPath}$`),
  new RegExp(`^/threads/${ulidPath}$`),
  // A thread not started yet: a draft in the browser until its first message.
  /^\/threads\/new$/,
];
// A workstream's page was /groups/:id until OA-98; a link to it still leads
// there.
const oldWorkstreamPath = new RegExp(`^/groups/(${ulidPath})$`);
// A review link: the shell only. Its GET opens and decides nothing, because
// chat apps unfurl links with GETs; the page asks with an explicit POST.
const reviewPath = /^\/review\/[A-Za-z0-9_-]{1,64}$/;

// What a review link's page needs, where the review token is the credential:
// the only requests the desktop app answers without its launch secret. Making
// or revoking a link isn't among them.
function forReviewers(method: string, path: string): boolean {
  if (method === "POST") return /^\/api\/review\/(open|decide|dismiss)$/.test(path);
  if (method !== "GET" && method !== "HEAD") return false;
  return reviewPath.test(path) || /^\/(app|assets|vendor)\//.test(path);
}

export function vendorPath(specifier: string): string {
  return `/vendor/${specifier}.js`;
}

// The file `rest` names inside `root`, or null if it would leave `root`.
export function within(root: string, rest: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const path = resolve(root, decoded);
  return path.startsWith(resolve(root) + sep) ? path : null;
}

export function handler(site: Site): (request: Request) => Promise<Reply> {
  const vendorFiles = new Map(
    [...site.vendor].map(([specifier, file]) => [vendorPath(specifier), file]),
  );
  const importMap = JSON.stringify({
    imports: Object.fromEntries([...site.vendor.keys()].map((s) => [s, vendorPath(s)])),
  });
  const importMapHash = createHash("sha256").update(importMap).digest("base64");
  const headers = securityHeaders(importMapHash, site.sketches ?? null);
  const reviewHeaders = securityHeaders(importMapHash);
  const reply = (
    status: number,
    type: string,
    body: string | Uint8Array,
    extra: Record<string, string> = {},
  ): Reply => ({
    status,
    headers: { ...headers, "content-type": type, ...extra },
    body,
  });
  const plain = (status: number, message: string) =>
    reply(status, "text/plain; charset=utf-8", `${message}\n`);
  const page = (look: Look) =>
    [
      "<!doctype html>",
      htmlTag(look),
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="color-scheme" content="light dark">',
      "<title>Oriel</title>",
      '<link rel="icon" href="/assets/icon.svg">',
      '<link rel="stylesheet" href="/assets/window.css">',
      `<script type="importmap">${importMap}</script>`,
      `<script type="module" src="/app/${site.entry}"></script>`,
      '<div id="app"></div>',
      "",
    ].join("\n");

  async function file(path: string | null): Promise<Reply> {
    const type = path === null ? undefined : types[extname(path)];
    if (path === null || type === undefined) return plain(404, "not found");
    try {
      return reply(200, type, await readFile(path));
    } catch (error) {
      if (isMissing(error)) return plain(404, "not found");
      throw error;
    }
  }

  return async (request) => {
    const refused = refusal(request.method, request.headers, site.port);
    if (refused !== null) return plain(403, refused);
    const url = URL.parse(request.url, "http://localhost");
    if (url === null) return plain(400, "bad URL");
    const path = url.pathname;
    if (
      site.launch &&
      !forReviewers(request.method, path) &&
      !hasLaunchSecret(request.headers.cookie, site.launch.cookie, site.launch.secret)
    )
      return plain(403, "this server answers only the Oriel app that started it");
    if (path.startsWith("/api/") && site.api) {
      const answered = await site.api(request, url);
      if (answered) return { ...answered, headers: { ...headers, ...answered.headers } };
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply(405, "text/plain; charset=utf-8", "method not allowed\n", {
        allow: "GET, HEAD",
      });
    }
    const moved = oldWorkstreamPath.exec(path)?.[1];
    if (moved)
      return reply(301, "text/plain; charset=utf-8", "moved\n", {
        location: `/workstreams/${moved}${url.search}`,
      });
    if (pagePaths.some((pattern) => pattern.test(path))) {
      const first = site.firstRun?.() ?? "finished";
      const setup = path === "/setup";
      if ((first === "pending") !== setup)
        return reply(302, "text/plain; charset=utf-8", "the first run\n", {
          location: setup ? "/" : "/setup",
        });
      return reply(200, "text/html; charset=utf-8", page(site.look?.() ?? defaultLook));
    }
    // A review link's reader isn't the person who picked a look.
    if (reviewPath.test(path))
      return reply(200, "text/html; charset=utf-8", page(defaultLook), {
        ...reviewHeaders,
        "x-robots-tag": "noindex",
      });
    const vendorFile = vendorFiles.get(path);
    if (vendorFile !== undefined) return file(vendorFile);
    if (path.startsWith("/app/")) return file(within(site.dist, path.slice("/app/".length)));
    if (path.startsWith("/assets/"))
      return file(within(site.assets, path.slice("/assets/".length)));
    return plain(404, "not found");
  };
}

function isMissing(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR";
}
