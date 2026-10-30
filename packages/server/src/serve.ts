import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { assets, dist, entry, vendor } from "@oriel/web/files";
import { type App, type AppOptions, createApp } from "./app.ts";
import { handler, type Reply, type Site } from "./site.ts";

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

// Listens on 127.0.0.1 only. Port 0 picks a free one. The app is built once
// the port is known, since review links name it.
export async function serve(
  port: number,
  options: Omit<AppOptions, "reviewBase"> = { db: ":memory:", jira: { kind: "fixture" } },
): Promise<Serving> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("not listening on TCP");
  const url = `http://127.0.0.1:${address.port}/`;
  let app: App;
  try {
    app = await createApp({ ...options, reviewBase: new URL("review/", url) });
  } catch (error) {
    server.close();
    throw error;
  }
  const handle = handler({
    ...webFiles(),
    port: address.port,
    window: app.window,
    api: app.api,
  });
  server.on("request", (req, res) => {
    const method = req.method ?? "GET";
    handle({ method, url: req.url ?? "/", headers: req.headers, body: bodyReader(req) })
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
