// `pnpm design`: the workshop on http://localhost:4400. Everything is read
// on request: the guide's markdown from this package, and window.css and the
// source files from the Oriel checkout, so a change to either shows on
// reload. It only reads the checkout; nothing here writes to it. It listens
// on 127.0.0.1 alone, and answers only a request addressed to this machine,
// so a page on another site can't read it by renaming its own host to it.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { page, pages } from "./guide.ts";
import {
  cssForScheme,
  forcedStates,
  oriel,
  proposalsCss,
  root,
  shownSource,
  sourceAt,
  tokenCss,
  windowCss,
} from "./oriel.ts";
import {
  frame,
  guidePage,
  indexPage,
  notFound,
  plainText,
  searchIndex,
  sourcePage,
  view,
} from "./render.ts";
import { where } from "./where.ts";

export const port = Number(process.env["PORT"] ?? 4400);

const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

const schemeOf = (url: URL) => {
  const s = url.searchParams.get("scheme");
  return s === "light" || s === "dark" ? s : "system";
};

const local = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/;

// The directories /assets/ and /shots/ serve from, and nothing above them.
const served = ["assets", "shots"].map((d) => join(root, d) + "/");

function decoded(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

export function handle(req: IncomingMessage, res: ServerResponse): void {
  const htmlType = "text/html; charset=utf-8";
  try {
    if (!local.test(req.headers.host ?? "")) return send(res, 421, "text/plain", "Not this host");
    if (req.method !== "GET" && req.method !== "HEAD")
      return send(res, 405, "text/plain", "Read only");
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decoded(url.pathname);
    if (path === null) return send(res, 400, "text/plain", "Not a path");
    const v = view(url.searchParams);
    if (path === "/") return send(res, 200, htmlType, indexPage(v));
    if (path === "/oriel/window.css")
      return send(res, 200, types[".css"]!, cssForScheme(windowCss(), schemeOf(url)));
    if (path === "/oriel/states.css")
      return send(res, 200, types[".css"]!, cssForScheme(forcedStates(windowCss()), schemeOf(url)));
    if (path === "/oriel/tokens.css")
      return send(res, 200, types[".css"]!, cssForScheme(tokenCss(windowCss()), schemeOf(url)));
    if (path === "/assets/proposals.css")
      return send(res, 200, types[".css"]!, cssForScheme(proposalsCss(), schemeOf(url)));
    if (path === "/oriel/proposed-states.css")
      return send(
        res,
        200,
        types[".css"]!,
        cssForScheme(forcedStates(proposalsCss()), schemeOf(url)),
      );
    if (path === "/search.json")
      return send(res, 200, "application/json", JSON.stringify(searchIndex()));
    if (path.startsWith("/assets/") || path.startsWith("/shots/")) {
      const file = normalize(join(root, path));
      if (!served.some((d) => file.startsWith(d))) return send(res, 404, "text/plain", "Not found");
      const type = types[extname(file)];
      if (type === undefined) return send(res, 404, "text/plain", "Not found");
      return send(res, 200, type, readFileSync(file));
    }
    if (path.startsWith("/source/")) {
      const file = path.slice("/source/".length);
      // A dated report's line link: the file as it was at its commit.
      const at = url.searchParams.get("at");
      if (at !== null) {
        const then = sourceAt(file, at);
        if (then === null)
          return send(res, 404, htmlType, notFound(v, `No ${file} at ${at} in ${oriel}.`));
        return send(res, 200, htmlType, sourcePage(file, then, v, at));
      }
      const text = shownSource(file);
      if (text === null) return send(res, 404, htmlType, notFound(v, `No ${file} in ${oriel}.`));
      // A page's citation of a name: on to the line it's on today.
      const name = url.searchParams.get("find");
      if (name !== null) {
        const [first] = where(file, name) ?? [];
        if (first === undefined)
          return send(res, 404, htmlType, notFound(v, `No ${name} in ${file} today.`));
        url.searchParams.delete("find");
        res.writeHead(302, { location: `${url.pathname}${url.search}#L${first.line}` });
        res.end();
        return;
      }
      return send(res, 200, htmlType, sourcePage(file, text, v));
    }
    if (path.startsWith("/frame/")) {
      const rest = path.slice("/frame".length);
      const cut = rest.lastIndexOf("/");
      const p = page(rest.slice(0, cut));
      const s = p?.specimens.find((x) => x.id === rest.slice(cut + 1));
      if (!p || !s) return send(res, 404, htmlType, notFound(v, `No specimen at ${path}.`));
      return send(res, 200, htmlType, frame(p, s, v));
    }
    if (path.endsWith(".md")) {
      const p = page(path.slice(0, -3));
      if (!p) return send(res, 404, "text/plain", "Not found");
      return send(res, 200, types[".md"]!, plainText(p));
    }
    const p = page(path.replace(/\/$/, ""));
    if (p) return send(res, 200, htmlType, guidePage(p, v));
    return send(
      res,
      404,
      htmlType,
      notFound(v, `No page at ${path}. There are ${pages().length} pages.`),
    );
  } catch (error) {
    console.error(error);
    return send(
      res,
      500,
      "text/plain; charset=utf-8",
      `The workshop failed: ${(error as Error).message}`,
    );
  }
}

export function start(at = port): Promise<Server> {
  const server = createServer(handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(at, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = await start();
  const address = server.address();
  const at = typeof address === "object" && address ? address.port : port;
  console.log(
    `Oriel design system on http://localhost:${at} (pid ${process.pid}), reading ${oriel}`,
  );
}
