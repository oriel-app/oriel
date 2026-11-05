import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assets, dist, entry, vendor } from "@oriel/web/files";
import { themeNames } from "@oriel/web/themes";
import { type App, type AppOptions, createApp } from "./app.ts";
import { handler, type Reply, type Request, type Site } from "./site.ts";
import { sketchHandler, sketchStyle } from "./sketch-site.ts";
import { mcpHandler, serveMcp } from "./mcp/http.ts";
import { type Ask, type OAuth, oauth } from "./mcp/oauth.ts";
import { mcpServer } from "./mcp/protocol.ts";
import { outsideToolsApi } from "./mcp/window-api.ts";

export type Serving = {
  url: string;
  port: number;
  app: App;
  // The MCP door for outside tools, when it was asked for.
  door: { url: string; port: number } | null;
  close(): Promise<void>;
};

// The web app's files.
export function webFiles(): Pick<Site, "dist" | "entry" | "assets" | "vendor"> {
  return {
    dist: fileURLToPath(dist),
    entry,
    assets: fileURLToPath(assets),
    vendor: new Map([...vendor].map(([specifier, url]) => [specifier, fileURLToPath(url)])),
  };
}

// Reads a request's body, or null once it passes `limit` bytes, when the
// rest is left unread.
export function bodyReader(req: IncomingMessage): (limit: number) => Promise<string | null> {
  let read: Promise<string | null> | null = null;
  return (limit) => {
    read ??= (async () => {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > limit) return null;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > limit) return null;
        chunks.push(buffer);
      }
      return Buffer.concat(chunks).toString("utf8");
    })();
    return read;
  };
}

export async function send(res: ServerResponse, method: string, reply: Reply): Promise<void> {
  res.writeHead(reply.status, reply.headers);
  if (!reply.stream) {
    res.end(method === "HEAD" ? undefined : reply.body);
    return;
  }
  const stream = reply.stream[Symbol.asyncIterator]();
  // A client that leaves ends the stream, which lets go of what it watched.
  res.once("close", () => void stream.return?.());
  if (method === "HEAD") {
    await stream.return?.();
    res.end();
    return;
  }
  res.flushHeaders();
  if (reply.body.length) res.write(reply.body);
  for (;;) {
    const next = await stream.next();
    if (next.done || res.destroyed) break;
    if (!res.write(next.value)) await once(res, "drain");
  }
  res.end();
}

export type ServeOptions = {
  // The desktop app's launch secret, and the cookie that carries it.
  launch?: Site["launch"];
  // Called once the server listens, before the app is built. Requests that
  // come meanwhile wait for it.
  listening?: (url: string) => void;
  // Runs once the app is built, before any request reaches it.
  beforeRequests?: (app: App) => Promise<void>;
  // The MCP door for outside tools (decision 0024), on a loopback listener
  // of its own, on the first of `ports` that's free. `asked` hears each
  // client that asks to sign in, for the window to come forward. `shim`
  // starts the stdio shim, for clients that only start commands.
  door?: {
    ports: readonly number[];
    asked?: (ask: Ask) => void;
    listening?: (port: number) => void;
    shim?: string[] | null;
  };
};

// Answers each request on `server` with the handler `built` resolves to;
// requests that come before it wait for it.
function answer(server: Server, built: Promise<(request: Request) => Promise<Reply>>): void {
  server.on("request", (req, res) => {
    const method = req.method ?? "GET";
    built
      .then((handle) =>
        handle({ method, url: req.url ?? "/", headers: req.headers, body: bodyReader(req) }),
      )
      .then((reply) => send(res, method, reply))
      .catch((error: unknown) => {
        console.error(error);
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("internal error\n");
      });
  });
}

const closing = (server: Server) => {
  const closed = new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  // Event streams never end on their own.
  server.closeAllConnections();
  return closed;
};

// Listens on 127.0.0.1 only, on the first of `ports` that's free. Port 0
// picks a free one. The app is built once the port is known, since review
// links name it. Sketches are served by a second listener, the sketch
// origin, on a free port of its own, behind the same launch secret, in the
// person's theme (decisions 0033 and 0034).
export async function serve(
  ports: number | readonly number[],
  options: Omit<AppOptions, "reviewBase" | "sketchBase"> = {
    db: ":memory:",
    sources: { jira: { mode: "fixture" } },
  },
  serving: ServeOptions = {},
): Promise<Serving> {
  const server = createServer();
  const sketches = createServer();
  const address = await listen(server, typeof ports === "number" ? [ports] : ports);
  const url = `http://127.0.0.1:${address.port}/`;
  const built = Promise.withResolvers<(request: Request) => Promise<Reply>>();
  const sketchBuilt = Promise.withResolvers<(request: Request) => Promise<Reply>>();
  // Nobody may be waiting on them when they fail.
  built.promise.catch(() => {});
  sketchBuilt.promise.catch(() => {});
  answer(server, built.promise);
  answer(sketches, sketchBuilt.promise);
  serving.listening?.(url);
  const files = webFiles();
  let app: App | null = null;
  let door: Awaited<ReturnType<typeof serveMcp>> | null = null;
  let doorProblem: string | null = null;
  try {
    // Read once: window.css is the web app's build, which doesn't change
    // while the server runs.
    const css = readFileSync(join(files.assets, "window.css"), "utf8");
    const sketchPort = (await listen(sketches, [0])).port;
    const sketchOrigin = `http://127.0.0.1:${sketchPort}`;
    app = await createApp({
      themes: themeNames(css),
      ...options,
      reviewBase: new URL("review/", url),
      sketchBase: new URL("/sketches/", sketchOrigin),
    });
    await serving.beforeRequests?.(app);
    const launch = serving.launch ? { launch: serving.launch } : {};
    const { setup, outside } = app;
    let signIn: OAuth | null = null;
    // A door that can't open, its kept port taken, leaves the window up,
    // and Settings says why.
    door = serving.door
      ? await serveMcp(serving.door.ports, (port) => {
          signIn = oauth({
            tools: outside.tools,
            origin: `http://127.0.0.1:${port}`,
            clock: Date.now,
            ...(serving.door?.asked ? { asked: serving.door.asked } : {}),
          });
          return mcpHandler({
            server: mcpServer({ outside, window: new URL(url), version: "0", clock: Date.now }),
            tools: outside.tools,
            port,
            oauth: signIn,
            keepAlive: (beat) => {
              const timer = setInterval(beat, 25_000);
              timer.unref();
              return () => clearInterval(timer);
            },
          });
        }).catch((error: unknown) => {
          doorProblem = `Its port is taken by another program. Quit that program, then restart Oriel.`;
          options.log?.("door: not open", { error: String(error) });
          return null;
        })
      : null;
    if (door) serving.door?.listening?.(door.port);
    const opened = door;
    const tools = outsideToolsApi({
      tools: outside.tools,
      oauth: signIn,
      door: () => opened?.url ?? null,
      problem: () => doorProblem,
      shim: serving.door?.shim ?? null,
    });
    const api = app.api;
    built.resolve(
      handler({
        ...files,
        port: address.port,
        look: app.settings.page,
        firstRun: () => setup.firstRun(),
        api: async (request, at) => (await api(request, at)) ?? tools(request, at),
        sketches: sketchOrigin,
        ...launch,
      }),
    );
    // Each theme and text size's sheet, built the first time a frame asks
    // for it.
    const sheets = new Map<string, string>();
    const { settings } = app;
    sketchBuilt.resolve(
      sketchHandler({
        port: sketchPort,
        framedBy: address.port,
        sketch: app.sketch,
        sheet: () => {
          const { theme, textSize } = settings.page();
          const key = `${theme} ${textSize}`;
          const sheet = sheets.get(key) ?? sketchStyle(css, theme, textSize);
          sheets.set(key, sheet);
          return sheet;
        },
        ...launch,
      }),
    );
  } catch (error) {
    built.reject(error);
    sketchBuilt.reject(error);
    await Promise.all([
      closing(server),
      sketches.listening ? closing(sketches) : null,
      door?.close(),
    ]);
    await app?.close();
    throw error;
  }
  const started = app;
  const open = door;
  return {
    url,
    port: address.port,
    app: started,
    door: open && { url: open.url, port: open.port },
    close: async () => {
      await Promise.all([closing(server), closing(sketches), open?.close()]);
      await started.close();
    },
  };
}

// Listens on the first port that isn't taken. Any other failure stops it.
export async function listen(server: Server, ports: readonly number[]): Promise<AddressInfo> {
  for (const [i, port] of ports.entries()) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      const taken = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (taken && i < ports.length - 1) continue;
      throw error;
    }
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("not listening on TCP");
    return address;
  }
  throw new Error("no port to listen on");
}
