import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { assets, dist, entry, vendor } from "@oriel/web/files";
import { fixtureIndex } from "./fixture.ts";
import { handler, type Site } from "./site.ts";
import { groupings, windowView } from "./window.ts";

export type Serving = { url: string; port: number; close(): Promise<void> };

// The web app's files, and the window built from the fixtures.
export function webSite(): Omit<Site, "port"> {
  const { records, now } = fixtureIndex();
  return {
    dist: fileURLToPath(dist),
    entry,
    assets: fileURLToPath(assets),
    vendor: new Map([...vendor].map(([specifier, url]) => [specifier, fileURLToPath(url)])),
    window: (grouping) => windowView(grouping, groupings[grouping], records, now, true),
  };
}

// Listens on 127.0.0.1 only. Port 0 picks a free one.
export async function serve(port: number, site = webSite()): Promise<Serving> {
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
  const handle = handler({ ...site, port: address.port });
  server.on("request", (req, res) => {
    const method = req.method ?? "GET";
    handle({ method, url: req.url ?? "/", headers: req.headers }).then(
      (reply) => {
        res.writeHead(reply.status, reply.headers);
        res.end(method === "HEAD" ? undefined : reply.body);
      },
      (error: unknown) => {
        console.error(error);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("internal error\n");
      },
    );
  });
  return {
    url: `http://127.0.0.1:${address.port}/`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
