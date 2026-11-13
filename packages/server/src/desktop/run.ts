// It quits when the shell is gone (its stdin ends, on every OS) or sends SIGTERM.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Log } from "@oriel/core";
import type { AppOptions } from "../app.ts";
import type { SetupOptions } from "../setup/setup.ts";
import type { Secrets } from "../connection.ts";
import { type Serving, serve } from "../serve.ts";
import { channel, type Shell } from "./channel.ts";
import { doorPorts, keepPort, keptPort, portsFrom } from "./port.ts";
import { launchCookie } from "./protocol.ts";

export type DesktopOptions = {
  data: string;
  input: Readable;
  write: (line: string) => void;
  log: Log;
  signals: { once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown };
  firstPort: number;
  firstDoorPort: number;
  app?: Pick<AppOptions, "agent" | "titler" | "sandbox" | "now" | "sources">;
  // The shell answers nothing until the server listens, so this mustn't wait on the store.
  model?: (secrets: Secrets) => Promise<
    Pick<AppOptions, "agent" | "titler" | "models" | "settings"> & {
      looked?: Promise<unknown>;
      setup?: Omit<SetupOptions, "front">;
    }
  >;
};

export class Stopped extends Error {
  readonly closed: Promise<void>;
  constructor(why: string, closed: Promise<void>) {
    super(why);
    this.closed = closed;
  }
}

export type Desktop = {
  serving: Serving;
  exited: Promise<number>;
};

export async function runDesktop(options: DesktopOptions): Promise<Desktop> {
  const { data, log } = options;
  const lines = channel(options.input, options.write, log);
  const stop = Promise.withResolvers<string>();
  void lines.ended.then(() => stop.resolve("stdin ended"));
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    options.signals.once(signal, () => stop.resolve(signal));

  const stopped = stop.promise.then((why): never => {
    throw new Stopped(why, Promise.resolve());
  });
  const secret = await Promise.race([lines.secret, stopped]);
  const secrets = secretsOf(lines.shell);
  const { looked, setup, ...model } = options.model
    ? await Promise.race([options.model(secrets), stopped])
    : {};
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const kept = keptPort(data);
  let port: number | null = null;
  const starting = serve(
    portsFrom(kept ?? options.firstPort),
    {
      ...options.app,
      ...model,
      db: join(data, "oriel.db"),
      exclusive: true,
      cliPaths: true,
      notify: async (notice) => {
        await lines.shell.ask({ kind: "notify", ...notice });
      },
      pickFolder: (prompt) => lines.shell.ask({ kind: "folder.pick", prompt }),
      working: async (threads) => {
        await lines.shell.ask({ kind: "working", threads });
      },
      ...(setup
        ? {
            setup: {
              ...setup,
              front: async () => {
                await lines.shell.ask({ kind: "window.focus" });
              },
            },
          }
        : {}),
      sources: options.app?.sources ?? {},
      log,
    },
    {
      launch: { cookie: launchCookie, secret },
      // Once kept, the door's port never moves: a client keeps sending its token to the port its config names, so a door
      // that moved would leave it with whoever took the old one.
      door: {
        ports: doorPorts(keptPort(data, "mcp-port"), options.firstDoorPort),
        listening: (at) => {
          if (keptPort(data, "mcp-port") !== at) keepPort(data, at, "mcp-port");
        },
      },
      listening(url) {
        port = Number(new URL(url).port);
        lines.ready(url);
      },
      // Any link still live outlived a launch that didn't quit cleanly, or names a port this server may no longer hold,
      // which whoever holds it now could use to take their tokens. So they die before any request is answered.
      async beforeRequests(app) {
        await looked;
        const left = await app.revokeReviewLinks();
        if (left > 0)
          log("desktop: revoked the review links an earlier launch left live", {
            count: left,
            moved: kept !== null && kept !== port,
          });
      },
    },
  );
  // Nothing has been served yet, and links still live are revoked at the next start.
  const started = await Promise.race([starting, stop.promise]);
  if (typeof started === "string") {
    log("desktop: quitting before it started", { why: started });
    throw new Stopped(
      started,
      starting.then(
        (serving) => serving.close(),
        () => {},
      ),
    );
  }
  const serving = started;
  if (serving.port !== kept) keepPort(data, serving.port);
  log("desktop: listening", {
    url: serving.url,
    door: "url" in serving.door ? serving.door.url : serving.door.closed,
  });

  const exited = stop.promise.then(async (why) => {
    log("desktop: quitting", { why });
    try {
      // Revoked first, so no link is used while the rest closes.
      await serving.app.revokeReviewLinks();
      await serving.close();
      return 0;
    } catch (error) {
      log("desktop: quitting failed", { error: String(error) });
      return 1;
    }
  });
  return { serving, exited };
}

function secretsOf(shell: Shell): Secrets {
  return {
    get: (name) => shell.ask({ kind: "secret.get", name }),
    set: async (name, secret) => {
      await shell.ask({ kind: "secret.set", name, secret });
    },
    delete: async (name) => {
      await shell.ask({ kind: "secret.delete", name });
    },
  };
}

// So a stray `console.log` or a dependency's write never lands in the channel. Call it before anything else writes.
export function takeStdout(
  stdout: Pick<NodeJS.WriteStream, "write">,
  stderr: Pick<NodeJS.WriteStream, "write">,
): (line: string) => void {
  const write = stdout.write.bind(stdout);
  stdout.write = stderr.write.bind(stderr) as typeof stdout.write;
  return (line) => void write(line);
}
