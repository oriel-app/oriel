// The window's routes for outside tools (OA-72), behind the window's own
// guard, so only the person reaches them: the tools they connected, Add,
// with a token shown once and what to paste into each client, Revoke, and
// the answer to a client that asks to sign in. None is an action: no agent
// or outside tool may connect, let in or revoke a tool (decision 0024).
import { literal, maxNameChars, object, string, union, type Validator } from "@oriel/core";
import type { HowToView, OutsideToolsView, OutsideToolView } from "@oriel/web/view";
import type { Reply, Request } from "../site.ts";
import type { OAuth } from "./oauth.ts";
import type { ConnectedTool, OutsideTools } from "./tokens.ts";

export type ToolView = OutsideToolView;
export type HowTo = HowToView;

const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

export function howToConnect(url: string, token: string | null, shim: string[] | null): HowTo[] {
  const claude = token
    ? {
        client: "Claude Code",
        steps: ["Run this in a terminal. Every Claude Code session then has Oriel."],
        command: `claude mcp add --transport http --scope user oriel ${url} --header ${quoted(`Authorization: Bearer ${token}`)}`,
      }
    : {
        client: "Claude Code",
        steps: [
          "Run this in a terminal.",
          "In Claude Code, type /mcp, pick oriel and Authenticate. Oriel's window asks you to let it in.",
        ],
        command: `claude mcp add --transport http --scope user oriel ${url}`,
      };
  const codex = token
    ? {
        client: "Codex",
        steps: ["Add this to ~/.codex/config.toml."],
        command: `[mcp_servers.oriel]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
      }
    : {
        client: "Codex",
        steps: [
          "Run these in a terminal. The second opens your browser, and Oriel's window asks you to let it in.",
        ],
        command: `codex mcp add oriel --url ${url}\ncodex mcp login oriel`,
      };
  const apps = {
    client: "An app that runs Claude Code or Codex",
    steps: [
      "Add Oriel to Claude Code or Codex as above. An app that runs them for you, and passes on their servers, gets it too.",
    ],
    command: null,
  };
  const stdio =
    token && shim
      ? [
          {
            client: "A program that starts a command",
            steps: ["Add this server to its JSON config."],
            command: JSON.stringify(
              { oriel: { command: shim[0], args: shim.slice(1), env: { ORIEL_TOKEN: token } } },
              null,
              2,
            ),
          },
        ]
      : [];
  return [claude, codex, apps, ...stdio];
}

const view = (tool: ConnectedTool): ToolView => ({
  id: tool.id,
  name: tool.name,
  mode: tool.mode,
  how: tool.client ? "signed-in" : "pasted",
  says: tool.says,
  connectedAt: tool.connectedAt,
  usedAt: tool.usedAt,
  revokedAt: tool.revokedAt,
});

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

async function readJson<T>(request: Request, validator: Validator<T>): Promise<T> {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new Refused(415, "send JSON");
  const text = request.body ? await request.body(4_000) : "";
  if (text === null) throw new Refused(413, "the body is over 4000 bytes");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Refused(400, "the body isn't JSON");
  }
  const result = validator(parsed);
  if (!result.ok)
    throw new Refused(400, result.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return result.value;
}

const mode = union(literal("read"), literal("act"));
const name = string;
const added = object({ name, mode });
const answered = union(object({ name, mode }), object({ deny: literal(true) }));

type Route = {
  method: "GET" | "POST";
  path: RegExp;
  run(params: string[], request: Request): Promise<Reply>;
};
const ulidPart = "([0-9A-HJKMNP-TV-Z]{26})";
const at = (path: string) =>
  new RegExp(`^/api${path.replaceAll(":id", ulidPart).replaceAll(":ask", "([\\w-]{32})")}$`);

export function outsideToolsApi(deps: {
  tools: OutsideTools;
  oauth: Pick<OAuth, "asks" | "decide"> | null;
  // The door's MCP endpoint, once it listens, and why it doesn't.
  door(): string | null;
  problem?: () => string | null;
  // The command that starts the stdio shim, for clients that only start
  // commands; null where there's none.
  shim: string[] | null;
}): (request: Request, url: URL) => Promise<Reply | null> {
  const named = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || [...trimmed].length > Math.min(60, maxNameChars))
      throw new Refused(400, "a name of 1 to 60 characters");
    return trimmed;
  };
  const routes: Route[] = [
    {
      method: "GET",
      path: at("/outside-tools"),
      async run() {
        const door = deps.door();
        const listed: OutsideToolsView = {
          door,
          problem: deps.problem?.() ?? null,
          tools: deps.tools.list().map(view),
          asks: (deps.oauth?.asks() ?? []).map(({ id, says, code, returnsTo }) => ({
            id,
            says,
            code,
            returnsTo,
          })),
          signIn: door && deps.oauth ? howToConnect(door, null, null) : [],
        };
        return json(200, listed);
      },
    },
    {
      method: "POST",
      path: at("/outside-tools"),
      async run(_, request) {
        const asked = await readJson(request, added);
        const door = deps.door();
        if (!door) throw new Refused(409, "Oriel's door for outside tools isn't open");
        const { tool, token } = deps.tools.connect(named(asked.name), asked.mode);
        return json(200, { tool: view(tool), token, howTo: howToConnect(door, token, deps.shim) });
      },
    },
    {
      method: "POST",
      path: at("/outside-tools/:id/revoke"),
      async run([id]) {
        if (!deps.tools.revoke(id as ConnectedTool["id"]))
          throw new Refused(404, "no such tool, or it's revoked");
        return json(200, { revoked: id });
      },
    },
    {
      method: "POST",
      path: at("/outside-tools/asks/:ask"),
      async run([ask], request) {
        const answer = await readJson(request, answered);
        if (!deps.oauth) throw new Refused(404, "no such ask");
        const decided =
          "deny" in answer
            ? deps.oauth.decide(ask ?? "", "deny")
            : deps.oauth.decide(ask ?? "", { name: named(answer.name), mode: answer.mode });
        if (!decided) throw new Refused(404, "that ask has ended");
        return json(200, { decided: ask });
      },
    },
  ];
  return async (request, url) => {
    for (const route of routes) {
      const match = route.path.exec(url.pathname);
      if (!match) continue;
      if (request.method !== route.method) continue;
      try {
        return await route.run(match.slice(1), request);
      } catch (error) {
        if (error instanceof Refused) return json(error.status, { error: error.message });
        throw error;
      }
    }
    return null;
  };
}
