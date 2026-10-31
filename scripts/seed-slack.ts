// Fills a channel in the test Slack workspace from a local scenario, each
// message posted by the person whose role it names, so authors, threads and
// mentions are real (OA-22). A message names its person as their Slack
// profile has them: title, display name or full name. A scenario is a local
// file, never committed, so no person's details are; keep it under .oriel/. It refuses unless every token is for the test
// workspace and the channel has no messages yet.
//
// Each person authorizes the app (scripts/slack-app.json) once:
//   pnpm seed:slack --authorize       the link to open, signed in as them
//   pnpm seed:slack --add <file>      <file> holds the address Slack sent the
//                                     browser to; their token joins .env
// Then:
//   pnpm seed:slack <scenario> [--dry-run]
//
// A scenario: { "channel": "name", "messages": [{ "as": "<name>",
// "text": "...", "thread": <index of an earlier message to reply under> }] }.
// `{@<name>}` in a text mentions that person.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  array,
  boolean,
  number,
  object,
  optional,
  string,
  type Validator,
} from "../packages/core/src/validate.ts";

// The only workspace this script writes to.
export const testWorkspace = "T0CDS3SHGQ6";

const manifest = object({
  oauth_config: object({
    redirect_urls: array(string),
    scopes: object({ user: array(string) }),
  }),
})(JSON.parse(readFileSync(new URL("slack-app.json", import.meta.url), "utf8")));
if (!manifest.ok) throw new Error("scripts/slack-app.json isn't a manifest this script reads");
const [redirectUri = ""] = manifest.value.oauth_config.redirect_urls;
const userScopes = manifest.value.oauth_config.scopes.user;

export type SlackEnv = { clientId: string | null; clientSecret: string | null; tokens: string[] };

// Reads SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_USER_TOKENS and nothing
// else. Messages never include a value.
export function slackEnv(envFile: string | null): SlackEnv | { error: string } {
  const env = envFile ? parseEnv(envFile) : {};
  const tokens = (env.SLACK_USER_TOKENS ?? "").split(/\s+/).filter(Boolean);
  if (tokens.some((token) => !token.startsWith("xoxp-")))
    return { error: "SLACK_USER_TOKENS holds something that isn't a user token" };
  return {
    clientId: env.SLACK_CLIENT_ID || null,
    clientSecret: env.SLACK_CLIENT_SECRET || null,
    tokens,
  };
}

export function authorizeUrl(clientId: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("user_scope", userScopes.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("team", testWorkspace);
  return url.toString();
}

// The redirect URL has nothing listening, so the browser shows an error page;
// its address holds the code.
export function codeFrom(text: string): { code: string } | { error: string } {
  const address = text.trim();
  const url = URL.canParse(address) ? new URL(address) : null;
  if (!url || `${url.origin}${url.pathname}` !== redirectUri)
    return { error: `that isn't the address Slack sent the browser to, ${redirectUri}?code=…` };
  const refused = url.searchParams.get("error");
  if (refused) return { error: `Slack didn't authorize: ${refused}` };
  const code = url.searchParams.get("code");
  return code ? { code } : { error: "the address has no code" };
}

// .env with the token added to SLACK_USER_TOKENS. Every other line is kept.
export function withToken(envFile: string, token: string): string {
  const env = slackEnv(envFile);
  const tokens = "error" in env ? [] : env.tokens;
  const line = `SLACK_USER_TOKENS=${[...new Set([...tokens, token])].join(" ")}`;
  const existing = /^SLACK_USER_TOKENS=.*$/m;
  if (existing.test(envFile)) return envFile.replace(existing, line);
  return `${envFile}${envFile === "" || envFile.endsWith("\n") ? "" : "\n"}${line}\n`;
}

export type Message = { as: string; text: string; thread?: number | undefined };
export type Scenario = { channel: string; messages: Message[] };

const scenarioShape: Validator<Scenario> = object({
  channel: string,
  messages: array(object({ as: string, text: string, thread: optional(number) })),
});

const mention = /\{@([^}]+)\}/g;
const role = (name: string) => name.trim().toLowerCase();

// Checks what Slack can't post: a reply goes under an earlier message that
// isn't itself a reply, as Slack threads are one level deep.
export function parseScenario(text: string): Scenario | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "the scenario isn't JSON" };
  }
  const parsed = scenarioShape(json);
  if (!parsed.ok)
    return {
      error: `the scenario doesn't fit: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
    };
  const scenario = parsed.value;
  if (!/^[a-z0-9_-]{1,80}$/.test(scenario.channel))
    return { error: "the channel name must be lowercase letters, digits, - or _" };
  if (!scenario.messages.length) return { error: "the scenario has no messages" };
  for (const [i, message] of scenario.messages.entries()) {
    if (!message.text.trim()) return { error: `message ${i} has no text` };
    const { thread } = message;
    if (thread === undefined) continue;
    if (!Number.isInteger(thread) || thread < 0 || thread >= i)
      return { error: `message ${i} replies under ${thread}, which isn't an earlier message` };
    if (scenario.messages[thread]?.thread !== undefined)
      return { error: `message ${i} replies under ${thread}, which is itself a reply` };
  }
  return scenario;
}

export type Person = { token: string; user: string; names: string[] };

// Who posts each name: the one person their profile gives it to. Every name a
// message is posted as or mentions must be exactly one person's.
export function cast(
  people: readonly Person[],
  scenario: Scenario,
): Map<string, Person> | { error: string } {
  const byUser = new Map(people.map((person) => [person.user, person]));
  const byRole = new Map<string, Person>();
  for (const person of byUser.values()) {
    for (const name of person.names) {
      const key = role(name);
      if (!key) continue;
      const other = byRole.get(key);
      if (other && other.user !== person.user)
        return { error: `two people go by "${name}"; a name must be one person's` };
      byRole.set(key, person);
    }
  }
  const roles = scenario.messages.flatMap((m) => [
    m.as,
    ...[...m.text.matchAll(mention)].map((match) => match[1] ?? ""),
  ]);
  for (const name of roles)
    if (!byRole.has(role(name)))
      return {
        error: `no one who authorized goes by "${name}" in their Slack profile`,
      };
  return byRole;
}

export function resolve(text: string, roles: ReadonlyMap<string, Person>): string {
  return text.replace(mention, (whole, name: string) => {
    const person = roles.get(role(name));
    return person ? `<@${person.user}>` : whole;
  });
}

export function dryRun(scenario: Scenario): string[] {
  const short = (text: string) => (text.length > 70 ? `${text.slice(0, 67)}...` : text);
  return [
    "Dry run: nothing is sent and .env is not read.",
    "Per token: auth.test, refuse unless the test workspace; users.profile.get for their names",
    `#${scenario.channel}: create unless it exists; each person in it joins; refuse unless it has no messages`,
    ...scenario.messages.map(
      (m, i) =>
        `${i}. ${m.thread === undefined ? "" : `(under ${m.thread}) `}${m.as}: ${short(m.text)}`,
    ),
  ];
}

// Live run.

export type Call = (
  method: string,
  token: string | null,
  params: Record<string, string>,
) => Promise<unknown>;

export const call: Call = async (method, token, params) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: new URLSearchParams(params),
    });
    if (response.status === 429 && attempt < 5) {
      const seconds = Number(response.headers.get("Retry-After")) || 5;
      await wait(Math.min(seconds, 60) * 1000);
      continue;
    }
    const body = (await response.json()) as unknown;
    const status = object({ ok: boolean, error: optional(string) })(body);
    if (!status.ok) throw new Error(`${method}: ${response.status}, not a Slack reply`);
    if (!status.value.ok) throw new Error(`${method}: ${status.value.error ?? "failed"}`);
    return body;
  }
};

async function send<T>(
  run: Call,
  method: string,
  token: string | null,
  params: Record<string, string>,
  shape: Validator<T>,
): Promise<T> {
  const result = shape(await run(method, token, params));
  if (!result.ok) throw new Error(`${method}: unexpected reply`);
  return result.value;
}

const authShape = object({ user_id: string, team_id: string });
const profileShape = object({
  profile: object({
    title: optional(string),
    display_name: optional(string),
    real_name: optional(string),
  }),
});
const accessShape = object({
  team: object({ id: string }),
  authed_user: object({ id: string, access_token: string }),
});
const channelsShape = object({
  channels: array(object({ id: string, name: string })),
  response_metadata: optional(object({ next_cursor: optional(string) })),
});
const createdShape = object({ channel: object({ id: string }) });
const historyShape = object({ messages: array(object({ subtype: optional(string) })) });
const postedShape = object({ ts: string });

async function person(run: Call, token: string): Promise<Person> {
  const auth = await send(run, "auth.test", token, {}, authShape);
  if (auth.team_id !== testWorkspace)
    throw new Error(`refusing: a token is for workspace ${auth.team_id}, not ${testWorkspace}`);
  const { profile } = await send(run, "users.profile.get", token, {}, profileShape);
  const names = [profile.title, profile.display_name, profile.real_name].map(
    (n) => n?.trim() ?? "",
  );
  return { token, user: auth.user_id, names: [...new Set(names.filter(Boolean))] };
}

// Exchanges the code for the person's token. The token is returned, never
// printed.
export async function authorize(
  run: Call,
  env: SlackEnv,
  code: string,
): Promise<{ token: string; person: Person }> {
  if (!env.clientId || !env.clientSecret)
    throw new Error("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set in .env");
  const access = await send(
    run,
    "oauth.v2.access",
    null,
    { client_id: env.clientId, client_secret: env.clientSecret, code, redirect_uri: redirectUri },
    accessShape,
  );
  if (access.team.id !== testWorkspace)
    throw new Error(`refusing: authorized in workspace ${access.team.id}, not ${testWorkspace}`);
  const token = access.authed_user.access_token;
  return { token, person: await person(run, token) };
}

export async function seed(
  run: Call,
  tokens: readonly string[],
  scenario: Scenario,
  log: (line: string) => void,
  pause = 1200,
): Promise<void> {
  const people: Person[] = [];
  for (const token of tokens) people.push(await person(run, token));
  const roles = cast(people, scenario);
  if ("error" in roles) throw new Error(`refusing: ${roles.error}`);
  const poster = (m: Message) => roles.get(role(m.as)) as Person;
  const first = poster(scenario.messages[0] as Message);

  let channel: string | null = null;
  let cursor = "";
  do {
    const page = await send(
      run,
      "conversations.list",
      first.token,
      { types: "public_channel", exclude_archived: "true", limit: "200", cursor },
      channelsShape,
    );
    channel = page.channels.find((c) => c.name === scenario.channel)?.id ?? null;
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (!channel && cursor);
  if (!channel) {
    const created = await send(
      run,
      "conversations.create",
      first.token,
      { name: scenario.channel },
      createdShape,
    );
    channel = created.channel.id;
    log(`created #${scenario.channel}`);
  }
  const posters = [...new Set(scenario.messages.map(poster))];
  for (const p of posters) await run("conversations.join", p.token, { channel });
  const history = await send(
    run,
    "conversations.history",
    first.token,
    { channel, limit: "100" },
    historyShape,
  );
  // Joins, topics and the like have a subtype; a message anyone posted doesn't.
  if (history.messages.some((m) => m.subtype === undefined))
    throw new Error(`refusing: #${scenario.channel} already has messages`);

  const posted: string[] = [];
  for (const [i, m] of scenario.messages.entries()) {
    if (i > 0) await wait(pause);
    const params: Record<string, string> = { channel, text: resolve(m.text, roles) };
    if (m.thread !== undefined) params.thread_ts = posted[m.thread] ?? "";
    const { ts } = await send(run, "chat.postMessage", poster(m).token, params, postedShape);
    posted.push(ts);
    log(`${i + 1}/${scenario.messages.length} ${m.as}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const usage = "usage: pnpm seed:slack --authorize | --add <file> | <scenario> [--dry-run]";
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const envText = () => (existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
  const fail = (message: string) => {
    console.error(message);
    process.exit(1);
  };
  const env = () => {
    const read = slackEnv(envText());
    return "error" in read ? fail(read.error) : read;
  };
  try {
    if (args.length === 1 && args[0] === "--authorize") {
      const { clientId } = env();
      if (!clientId) fail("SLACK_CLIENT_ID must be set in .env");
      else
        console.log(
          `Open this signed in to Slack as the person, and click Allow. The page after it won't load; copy its address.\n${authorizeUrl(clientId)}`,
        );
    } else if (args.length === 2 && args[0] === "--add") {
      const found = codeFrom(readFileSync(args[1] ?? "", "utf8"));
      if ("error" in found) fail(found.error);
      else {
        const { token, person: added } = await authorize(call, env(), found.code);
        writeFileSync(envPath, withToken(envText() ?? "", token));
        const count = (env() as SlackEnv).tokens.length;
        console.log(
          `added ${added.user}, who goes by "${added.names.join('", "')}"; ${count} people have authorized`,
        );
      }
    } else if (args.length >= 1 && args.length <= 2 && !args[0]?.startsWith("--")) {
      if (args.length === 2 && args[1] !== "--dry-run") fail(usage);
      const scenario = parseScenario(readFileSync(args[0] ?? "", "utf8"));
      if ("error" in scenario) fail(scenario.error);
      else if (args[1] === "--dry-run") for (const line of dryRun(scenario)) console.log(line);
      else await seed(call, env().tokens, scenario, (line) => console.log(line));
    } else fail(usage);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
