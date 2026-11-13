import { instant } from "../packages/core/src/ids.ts";
import type { FixtureIssue } from "../packages/jira/src/fixture.ts";

const statuses = [
  { name: "To Do", category: "todo" },
  { name: "In Progress", category: "in-progress" },
  { name: "Done", category: "done" },
] as const;
const people = ["amara", "bastian", "yuting", "dara", "esme", "farid", null];
const day = 86_400_000;
const t0 = Date.parse("2026-10-29T09:00:00.000Z");

export function generated(count: number): FixtureIssue[] {
  const epics = Math.max(1, Math.round(count / 50));
  const issue = (n: number, over: Partial<FixtureIssue>): FixtureIssue => ({
    key: `SYN-${5000 + n}`,
    id: String(50_000 + n),
    issueType: "Story",
    summary: `Generated item ${n}: a story title about as long as a real one`,
    description: "What the story is for, in a sentence or two, as most of SYN's are.",
    status: statuses[n % 3] ?? statuses[0],
    epic: null,
    assignee: people[n % people.length] ?? null,
    points: n % 4 === 0 ? null : (n % 8) + 1,
    labels: [],
    comments: [],
    links: [],
    updatedAt: instant(new Date(t0 - ((n * 7) % 60) * day)),
    ...over,
  });
  return Array.from({ length: count }, (_, n) => {
    if (n < epics) return issue(n, { issueType: "Epic", summary: `Generated epic ${n}` });
    const epic = n % 11 === 0 ? null : Math.floor(Math.sqrt((n * 7919) % (epics * epics)));
    return issue(n, { epic: epic === null ? null : `SYN-${5000 + epic}` });
  });
}

export const bigWorld =
  (total: number) =>
  (syn: readonly FixtureIssue[]): FixtureIssue[] => [...syn, ...generated(total - syn.length)];
