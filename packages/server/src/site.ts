import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { type GroupingId, isGroupingId, type WindowView } from "@oriel/web/view";
import { refusal } from "./guard.ts";

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
  window(grouping: GroupingId): WindowView;
  // The JSON routes under /api/, past the guard; null for a path it doesn't
  // have, which then 404s.
  api?: (request: Request, url: URL) => Promise<Reply | null>;
};

export type Request = {
  method: string;
  url: string;
  headers: {
    host?: string;
    origin?: string;
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

// Every reply carries these. A review link's page relies on two of them: no
// referrer, so its token never leaves in a Referer header, and no caching.
export function securityHeaders(importMapHash: string): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'self' 'sha256-${importMapHash}'`,
      "style-src 'self'",
      "img-src 'self'",
      "connect-src 'self'",
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
  /^\/inbox$/,
  new RegExp(`^/groups/${ulidPath}$`),
  new RegExp(`^/threads/${ulidPath}$`),
];
// A review link: the shell only. Its GET opens and decides nothing, because
// chat apps unfurl links with GETs; the page asks with an explicit POST.
const reviewPath = /^\/review\/[A-Za-z0-9_-]{1,64}$/;

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
  const headers = securityHeaders(createHash("sha256").update(importMap).digest("base64"));
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
  const page = [
    "<!doctype html>",
    '<html lang="en">',
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
    if (path.startsWith("/api/") && site.api) {
      const answered = await site.api(request, url);
      if (answered) return { ...answered, headers: { ...headers, ...answered.headers } };
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply(405, "text/plain; charset=utf-8", "method not allowed\n", {
        allow: "GET, HEAD",
      });
    }
    if (pagePaths.some((pattern) => pattern.test(path)))
      return reply(200, "text/html; charset=utf-8", page);
    if (reviewPath.test(path))
      return reply(200, "text/html; charset=utf-8", page, { "x-robots-tag": "noindex" });
    if (path === "/api/window") {
      const grouping = url.searchParams.get("grouping");
      if (!isGroupingId(grouping)) return plain(400, "grouping must be epic, assignee or stuck");
      return reply(200, "application/json", JSON.stringify(site.window(grouping)));
    }
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
