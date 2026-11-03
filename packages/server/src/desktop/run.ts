// The server's desktop mode (decision 0036): the server as the desktop
// shell's child. It reads the launch secret and talks to the shell over
// stdin and stdout (PROTOCOL.md), keeps its database and port in the data
// folder the shell names, keeps the Jira connection and the API key in the
// OS secret store through the shell, and quits when the shell is gone (its
// stdin ends, on every OS) or sends SIGTERM.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Log } from "@oriel/core";
import type { AppOptions } from "../app.ts";
import type { SetupOptions } from "../setup/setup.ts";
import { type Secrets, secretsStore } from "../connection.ts";
import { type Serving, serve } from "../serve.ts";
import { channel, type Shell } from "./channel.ts";
import { keepPort, keptPort, portsFrom } from "./port.ts";
import { launchCookie } from "./protocol.ts";

export type DesktopOptions = {
  // The data folder: the database, `oriel.db`, and the kept port.
  data: string;
  // The server's stdin, from the shell.
  input: Readable;
  // Writes one line, with its newline, to the shell: the channel alone.
  write: (line: string) => void;
  // Every log line, to stderr.
  log: Log;
  // Where SIGTERM and SIGINT arrive: the process.
  signals: { once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown };
  // The port the first launch tries; 0 lets the OS pick, as tests do.
  firstPort: number;
  // The agent, the titler and, for tests, the sandbox and the clock: as
  // `pnpm dev` builds them.
  app?: Pick<AppOptions, "agent" | "titler" | "sandbox" | "now">;
  // Finds the models the agent can run on, with the person's settings and
  // the shell's secret store, which holds the API key: it runs once the
  // secret is in, and a stop meanwhile doesn't wait for it. The shell
  // answers nothing until the server listens, so it mustn't wait on the
  // store.
  // `looked`, when given, holds every request until the first look ends, as
  // it did when the look came first, so no page shows it unfinished.
  // `setup`: the first run and its commands for the person's CLI (decision
  // 0038), which bring the window to the front through the shell.
  model?: (secrets: Secrets) => Promise<
    Pick<AppOptions, "agent" | "titler" | "models" | "settings" | "keys"> & {
      looked?: Promise<unknown>;
      setup?: Omit<SetupOptions, "front">;
    }
  >;
  // How Jira is reached; tests pass a site in memory.
  jiraFetch?: typeof fetch;
};

export class Stopped extends Error {
  // Resolves once whatever was starting has closed again.
  readonly closed: Promise<void>;
  constructor(why: string, closed: Promise<void>) {
    super(why);
    this.closed = closed;
  }
}

export type Desktop = {
  serving: Serving;
  // Resolves to the exit status once the server has quit.
  exited: Promise<number>;
};

// Rejects when the launch secret is missing or malformed, or the server
// can't start, with nothing listening; or with `Stopped` when asked to stop
// before it started.
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
      jira: {
        kind: "window",
        store: secretsStore(secrets, log),
        // Any Jira Cloud site the person connects (decision 0038).
        anySite: true,
        ...(options.jiraFetch ? { fetch: options.jiraFetch } : {}),
      },
      log,
    },
    {
      launch: { cookie: launchCookie, secret },
      listening(url) {
        port = Number(new URL(url).port);
        lines.ready(url);
      },
      // A desktop review link lives only while the app runs (decision 0036).
      // Any still live now outlived a launch that didn't quit cleanly, or
      // names a port this server may no longer hold, which whoever holds it
      // now could use to take their tokens. So they die before any request
      // is answered.
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
  // Asked to stop while starting, as when the shell quits at once or a saved
  // connection's check is slow, it stops now: nothing has been served, and
  // links still live are revoked at the next start. Whatever finishes
  // starting is closed again.
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
  log("desktop: listening", { url: serving.url });

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

// The OS's store for secrets, which the shell reaches for the server.
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

// Points `stdout.write` at stderr, so a stray `console.log` or a dependency's
// write never lands in the channel, and returns the one writer the channel
// uses. Call it before anything else writes.
export function takeStdout(
  stdout: Pick<NodeJS.WriteStream, "write">,
  stderr: Pick<NodeJS.WriteStream, "write">,
): (line: string) => void {
  const write = stdout.write.bind(stdout);
  stdout.write = stderr.write.bind(stderr) as typeof stdout.write;
  return (line) => void write(line);
}
