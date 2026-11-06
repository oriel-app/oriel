import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assets, dist, entry, vendor } from "@oriel/web/files";
import { themeNames } from "@oriel/web/themes";
import { type App, type AppOptions, createApp, type Door } from "./app.ts";
import { handler, type Reply, type Request, type Site } from "./site.ts";
import { sketchHandler, sketchStyle } from "./sketch-site.ts";
import { mcpHandler, type McpRequest } from "./mcp/http.ts";
import { mcpServer } from "./mcp/protocol.ts";

export type Serving = { url: string; port: number; app: App; door: Door; close(): Promise<void> };

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

async function send(res: ServerResponse, method: string, reply: Reply): Promise<void> {
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
  // The MCP door's ports, tried in order: the one kept, alone, once there
  // is one; `listening` hears the one it opened on, to keep. Port 0, as by
  // default, picks a free one.
  door?: { ports: readonly number[]; listening?: (port: number) => void };
};

// Answers each request on `server` with the handler `built` resolves to;
// requests that come before it wait for it.
function answer(
  server: Server,
  built: Promise<(request: Request & McpRequest) => Promise<Reply>>,
): void {
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
// person's theme (decisions 0033 and 0034). Outside tools reach Oriel
// through the MCP door, on a third listener of its own, behind their tokens
// rather than the launch secret (decision 0058). If its port is taken, the
// door stays closed, and the window opens all the same.
export async function serve(
  ports: number | readonly number[],
  options: Omit<AppOptions, "reviewBase" | "sketchBase" | "door"> = {
    db: ":memory:",
    sources: { jira: { mode: "fixture" } },
  },
  serving: ServeOptions = {},
): Promise<Serving> {
  const server = createServer();
  const sketches = createServer();
  const doorServer = createServer();
  const address = await listen(server, typeof ports === "number" ? [ports] : ports);
  const url = `http://127.0.0.1:${address.port}/`;
  const built = Promise.withResolvers<(request: Request) => Promise<Reply>>();
  const sketchBuilt = Promise.withResolvers<(request: Request) => Promise<Reply>>();
  const doorBuilt = Promise.withResolvers<(request: McpRequest) => Promise<Reply>>();
  // Nobody may be waiting on them when they fail.
  built.promise.catch(() => {});
  sketchBuilt.promise.catch(() => {});
  doorBuilt.promise.catch(() => {});
  answer(server, built.promise);
  answer(sketches, sketchBuilt.promise);
  answer(doorServer, doorBuilt.promise);
  serving.listening?.(url);
  const log = options.log ?? (() => {});
  // The door listens before the app is built, as the window does, so the
  // app knows whether it opened. One that can't leaves the window up.
  const door: Door = await listen(doorServer, serving.door?.ports ?? [0]).then(
    ({ port }) => ({ url: `http://127.0.0.1:${port}/mcp`, port }),
    (error: unknown) => {
      log("door: not open", { error: String(error) });
      return {
        closed:
          (error as NodeJS.ErrnoException).code === "EADDRINUSE"
            ? "Its port is taken by another program. Quit that program, then restart Oriel."
            : "It couldn't open. Restart Oriel to try again.",
      };
    },
  );
  if ("port" in door) serving.door?.listening?.(door.port);
  const files = webFiles();
  let app: App | null = null;
  try {
    // Read once: window.css is the web app's build, which doesn't change
    // while the server runs.
    const css = readFileSync(join(files.assets, "window.css"), "utf8");
    const sketchPort = (await listen(sketches, [0])).port;
    const sketchOrigin = `http://127.0.0.1:${sketchPort}`;
    app = await createApp({
      themes: themeNames(css),
      ...options,
      door,
      reviewBase: new URL("review/", url),
      sketchBase: new URL("/sketches/", sketchOrigin),
    });
    await serving.beforeRequests?.(app);
    const launch = serving.launch ? { launch: serving.launch } : {};
    const { setup, outside } = app;
    if ("port" in door)
      doorBuilt.resolve(
        mcpHandler({
          server: mcpServer({ outside, version: "0", clock: Date.now, log }),
          tools: outside.tools,
          port: door.port,
          keepAlive: (beat) => {
            const timer = setInterval(beat, 25_000);
            timer.unref();
            return () => clearInterval(timer);
          },
        }),
      );
    built.resolve(
      handler({
        ...files,
        port: address.port,
        look: app.settings.page,
        firstRun: () => setup.firstRun(),
        api: app.api,
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
    doorBuilt.reject(error);
    await Promise.all([
      closing(server),
      sketches.listening ? closing(sketches) : null,
      doorServer.listening ? closing(doorServer) : null,
    ]);
    await app?.close();
    throw error;
  }
  const started = app;
  return {
    url,
    port: address.port,
    app: started,
    door,
    close: async () => {
      await Promise.all([
        closing(server),
        closing(sketches),
        doorServer.listening ? closing(doorServer) : null,
      ]);
      await started.close();
    },
  };
}

// Listens on the first port that isn't taken. Any other failure stops it.
async function listen(server: Server, ports: readonly number[]): Promise<AddressInfo> {
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
