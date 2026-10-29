// Records read-only REST exchanges with the live SYN into
// packages/jira/test-data/, as cassettes the Jira source's tests replay:
// `sync.json` is a full listing and `read.json` reads every frozen region's
// items. Only reads are sent (GETs and the search POST), only to the
// throwaway site. People are replaced with numbered placeholders, and emails,
// avatars, time zones and locales are dropped, so no real person's details are
// committed.
// Usage: pnpm record:jira
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ItemId, JiraFixture } from "../packages/core/src/index.ts";
import { type Exchange, recording } from "../packages/jira/src/cassette.ts";
import { type JiraSourceOptions, jiraSource } from "../packages/jira/src/source.ts";
import { basicAuth, restTransport, type Transport } from "../packages/jira/src/transport.ts";
import { loadJiraFixture } from "./fixtures/load.ts";
import { jiraEnv } from "./seed-jira.ts";

export const testData = new URL("../packages/jira/test-data/", import.meta.url);

// What both the recording and the replaying source are built with, so their
// requests match.
export const recordedSource = (transport: Transport): JiraSourceOptions => ({
  transport,
  site: "https://oriel.atlassian.net",
  projects: ["SYN"],
  log: () => {},
});

// Every frozen region's items, in order, each once.
export const recordedReads = (fixture: JiraFixture): ItemId<"jira">[] => [
  ...new Set(fixture.regions.flatMap((region) => region.items)),
];

export function readOnly(inner: Transport): Transport {
  return async (request) => {
    const search = request.method === "POST" && request.path === "/rest/api/3/search/jql";
    if (request.method !== "GET" && !search)
      throw new Error(`refusing to record a write: ${request.method} ${request.path}`);
    return inner(request);
  };
}

const dropped = new Set(["emailAddress", "avatarUrls", "timeZone", "locale"]);

// Each person (any object with an accountId) becomes a placeholder, the same
// one wherever they appear.
export function scrub(value: unknown, people = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map((item) => scrub(item, people));
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value);
  const accountId = entries.find(([key]) => key === "accountId")?.[1];
  if (typeof accountId === "string") {
    const placeholder = people.get(accountId) ?? `person-${people.size + 1}`;
    people.set(accountId, placeholder);
    return { accountId: placeholder, displayName: `Person ${placeholder.slice(7)}`, active: true };
  }
  return Object.fromEntries(
    entries.filter(([key]) => !dropped.has(key)).map(([key, item]) => [key, scrub(item, people)]),
  );
}

export async function record(transport: Transport, fixture: JiraFixture) {
  const people = new Map<string, string>();
  const save = (name: string, exchanges: Exchange[]) => {
    const scrubbed = exchanges.map((exchange) => ({
      request: exchange.request,
      response: scrub(exchange.response, people),
    }));
    writeFileSync(new URL(name, testData), `${JSON.stringify(scrubbed, null, 2)}\n`);
    console.log(`${name}: ${exchanges.length} exchanges`);
  };

  const listing: Exchange[] = [];
  const source = jiraSource(recordedSource(recording(transport, listing)));
  let records = 0;
  for await (const page of source.sync(null)) records += page.records.length;
  if (records === 0) throw new Error("SYN has no issues: run pnpm seed:jira first");
  save("sync.json", listing);

  const reads: Exchange[] = [];
  await jiraSource(recordedSource(recording(transport, reads))).read(recordedReads(fixture));
  save("read.json", reads);
}

if (import.meta.main) {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const env = jiraEnv(existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }
  try {
    mkdirSync(testData, { recursive: true });
    const credential = basicAuth(env.email, env.token);
    await record(readOnly(restTransport({ site: env.site, credential })), loadJiraFixture());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
