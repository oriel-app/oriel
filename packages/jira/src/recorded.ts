// A recording's people and times are scrubbed, so no real person's details are committed.
import type { ItemId } from "@oriel/core";
import type { JiraFixture } from "./fixture.ts";
import type { JiraSourceOptions } from "./source.ts";
import type { ReadTransport } from "./transport.ts";

export const testData = new URL("../test-data/", import.meta.url);

// What both the recording and the replaying source are built with, so their
// requests match.
export const recordedSource = (transport: ReadTransport): JiraSourceOptions => ({
  transport,
  site: "https://oriel.atlassian.net",
  projects: ["SYN"],
  log: () => {},
});

export const recordedReads = (fixture: JiraFixture): ItemId<"jira">[] => [
  ...new Set(fixture.regions.flatMap((region) => region.items)),
];

const dropped = new Set(["emailAddress", "avatarUrls", "timeZone", "locale"]);
// Jira writes times in the account's offset, such as 2026-10-29T09:00:00.000+0100.
const zoned = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})([+-]\d{2})(\d{2})$/;

// Each person becomes a placeholder, the same wherever they appear; times move to UTC, which hides the account's zone.
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
