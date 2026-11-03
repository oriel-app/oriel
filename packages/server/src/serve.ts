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

export type Serving = { url: string; port: number; app: App; close(): Promise<void> };

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
};

// Listens on 127.0.0.1 only, on the first of `ports` that's free. Port 0
// picks a free one. The app is built once the port is known, since review
// links name it.
export async function serve(
  ports: number | readonly number[],
  options: Omit<AppOptions, "reviewBase"> = { db: ":memory:", jira: { kind: "fixture" } },
  serving: ServeOptions = {},
): Promise<Serving> {
  const server = createServer();
  const address = await listen(server, typeof ports === "number" ? [ports] : ports);
  const url = `http://127.0.0.1:${address.port}/`;
  const built = Promise.withResolvers<(request: Request) => Promise<Reply>>();
  // Nobody may be waiting on it when it fails.
  built.promise.catch(() => {});
  server.on("request", (req, res) => {
    const method = req.method ?? "GET";
    built.promise
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
  serving.listening?.(url);
  const files = webFiles();
  let app: App | null = null;
  try {
    app = await createApp({
      themes: themeNames(readFileSync(join(files.assets, "window.css"), "utf8")),
      ...options,
      reviewBase: new URL("review/", url),
    });
    await serving.beforeRequests?.(app);
  } catch (error) {
    built.reject(error);
    server.closeAllConnections();
    server.close();
    await app?.close();
    throw error;
  }
  built.resolve(
    handler({
      ...files,
      port: address.port,
      window: app.window,
      look: app.settings.page,
      api: app.api,
      ...(serving.launch ? { launch: serving.launch } : {}),
    }),
  );
  return {
    url,
    port: address.port,
    app,
    close: async () => {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      // Event streams never end on their own.
      server.closeAllConnections();
      await closed;
      await app.close();
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
