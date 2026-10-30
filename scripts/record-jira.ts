// Records read-only REST exchanges with the live SYN into
// packages/jira/test-data/, as cassettes the Jira source's tests replay:
// `sync.json` is a full listing and `read.json` reads every frozen region's
// items. Only reads are sent (GETs and the search POST), only to the
// throwaway site. People are replaced with numbered placeholders (mentions
// included), emails, avatars, time zones and locales are dropped, and times are
// moved to UTC, so no real person's details are committed.
// Usage: pnpm record:jira
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ItemId, JiraFixture } from "../packages/core/src/index.ts";
import { type Exchange, recording } from "../packages/jira/src/cassette.ts";
import { type JiraSourceOptions, jiraSource } from "../packages/jira/src/source.ts";
import { basicAuth, type ReadTransport, readTransport } from "../packages/jira/src/transport.ts";
import { loadJiraFixture } from "./fixtures/load.ts";
import { jiraEnv } from "./seed-jira.ts";

export const testData = new URL("../packages/jira/test-data/", import.meta.url);

// What both the recording and the replaying source are built with, so their
// requests match.
export const recordedSource = (transport: ReadTransport): JiraSourceOptions => ({
  transport,
  site: "https://oriel.atlassian.net",
  projects: ["SYN"],
  log: () => {},
});

// Every frozen region's items, in order, each once.
export const recordedReads = (fixture: JiraFixture): ItemId<"jira">[] => [
  ...new Set(fixture.regions.flatMap((region) => region.items)),
];

const dropped = new Set(["emailAddress", "avatarUrls", "timeZone", "locale"]);
// Jira writes times in the account's offset, such as 2026-10-29T09:00:00.000+0100.
const zoned = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})([+-]\d{2})(\d{2})$/;

// Each person (any object with an accountId, a mention, or a bare
// userAccountId) becomes a placeholder, the same one wherever they appear.
// Times keep Jira's format but move to UTC, which hides the account's zone.
export function scrub(value: unknown, people = new Map<string, string>()): unknown {
  const person = (accountId: string) => {
    const placeholder = people.get(accountId) ?? `person-${people.size + 1}`;
    people.set(accountId, placeholder);
    return placeholder;
  };
  const name = (placeholder: string) => `Person ${placeholder.slice(7)}`;
  if (typeof value === "string") {
    const match = zoned.exec(value);
    if (!match) return value;
    const [, local = "", hours = "", minutes = ""] = match;
    return new Date(`${local}${hours}:${minutes}`).toISOString().replace("Z", "+0000");
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, people));
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value);
  const accountId = entries.find(([key]) => key === "accountId")?.[1];
  if (typeof accountId === "string") {
    const placeholder = person(accountId);
    return { accountId: placeholder, displayName: name(placeholder), active: true };
  }
  if ("type" in value && value.type === "mention" && "attrs" in value) {
    const attrs = value.attrs;
    const id = typeof attrs === "object" && attrs !== null && "id" in attrs ? attrs.id : null;
    const placeholder = person(typeof id === "string" ? id : "unknown");
    return { type: "mention", attrs: { id: placeholder, text: `@${name(placeholder)}` } };
  }
  return Object.fromEntries(
    entries
      .filter(([key]) => !dropped.has(key))
      .map(([key, item]) => [
        key,
        key === "userAccountId" && typeof item === "string" ? person(item) : scrub(item, people),
      ]),
  );
}

export async function record(transport: ReadTransport, fixture: JiraFixture) {
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
    await record(readTransport({ site: env.site, credential }), loadJiraFixture());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
