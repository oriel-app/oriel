// Everything it says goes to stderr: stdout carries the protocol only.
import { parseArgs } from "node:util";
import { type AccessSource, fixedAccess, googleAccess } from "./access.ts";
import { type Fixture, loadFixture, saveFixture } from "./fixture.ts";
import type { After } from "./loopback.ts";
import { type Fetch, googleClientOf, signIn } from "./oauth.ts";
import type { Random } from "./pkce.ts";
import { mcpServer } from "./server.ts";
import { standIn, standInToken } from "./stand-in.ts";
import { serveStdio } from "./stdio.ts";
import { clientFile, configFolder, tokenFile } from "./token-file.ts";

export type CliIo = {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  stdin: AsyncIterable<string | Buffer> | Iterable<string | Buffer>;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  fetch: Fetch;
  open: (url: string) => Promise<void>;
  now: () => number;
  random?: Random;
  after?: After;
};

export const usage = `Usage:
  sheets-mcp                     the MCP server, over stdio
  sheets-mcp --fixture <file>    the same tools over spreadsheets in a JSON file
  sheets-mcp --fixture <file> --shared
                                 the same, writing to the file, which each
                                 call reads afresh
  sheets-mcp login               sign in to Google in your browser, once
  sheets-mcp logout              forget the sign-in

login reads GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET if the client has
one, from the environment, and keeps them beside the sign-in, so the server
needs no environment. Set there, they win over what's kept.
`;

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const say = (line: string) => io.stderr.write(`${line}\n`);
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        fixture: { type: "string" },
        shared: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch {
    io.stderr.write(usage);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (
    values.help ||
    rest.length ||
    (command !== undefined && values.fixture !== undefined) ||
    (values.shared && values.fixture === undefined)
  ) {
    io.stderr.write(usage);
    return values.help ? 0 : 2;
  }
  const folder = configFolder(io.env, io.home);
  const file = tokenFile(folder);
  const keptClient = clientFile(folder);

  if (command === "login") {
    const client = googleClientOf(io.env);
    if (!client) {
      say("Set GOOGLE_CLIENT_ID first, and GOOGLE_CLIENT_SECRET if the client has one.");
      return 1;
    }
    say("Opening your browser to sign in to Google…");
    const result = await signIn(client, io);
    if (result.status === "failed") {
      say(`Didn't sign in: ${result.problem}.`);
      return 1;
    }
    // The client first: a token kept alone would be refreshed with none.
    keptClient.write(client);
    file.write(result.tokens.refresh);
    say(`Signed in. The sign-in is kept in ${folder}.`);
    return 0;
  }
  if (command === "logout") {
    const removed = [file.remove(), keptClient.remove()].some(Boolean);
    say(removed ? `Signed out: deleted the sign-in in ${folder}.` : "Not signed in.");
    return 0;
  }
  if (command !== undefined) {
    io.stderr.write(usage);
    return 2;
  }

  let fetch = io.fetch;
  let source: AccessSource;
  if (values.fixture !== undefined) {
    let fixture;
    try {
      fixture = loadFixture(values.fixture);
    } catch (error) {
      say(
        error instanceof SyntaxError ? `The fixture isn't JSON.` : String((error as Error).message),
      );
      return 1;
    }
    const now = () => new Date(io.now()).toISOString();
    const path = values.fixture;
    const shared = (current: Fixture): typeof fetch => {
      return async (input, init) => {
        const google = standIn(current, { now });
        const response = await google.fetch(input, init);
        if ((init?.method ?? "GET") !== "GET")
          saveFixture(path, { spreadsheets: google.spreadsheets });
        return response;
      };
    };
    fetch = values.shared
      ? (input, init) => shared(loadFixture(path))(input, init)
      : standIn(fixture, { now }).fetch;
    source = fixedAccess(standInToken);
  } else {
    const given = googleClientOf(io.env);
    source = googleAccess({ client: () => given ?? keptClient.read(), file, fetch, now: io.now });
  }
  await serveStdio(mcpServer({ fetch, source, log: say }), io.stdin, io.stdout);
  return 0;
}
