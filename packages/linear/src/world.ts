// A Linear workspace written down (OA-278): its teams, each team's workflow
// and cycles, its people, projects and issues, as the stand-in for Linear's
// MCP server answers from in memory. `fixtures/linear/world.json` is one,
// written by scripts/fixtures/linear.ts: Ferrowick's engineering team, with
// the SYN fixture's people and a launch-shaped project. Shapes are Linear's
// own (UUIDs, a team's key and number, a status's type), never Oriel's.
import { readFileSync } from "node:fs";
import {
  array,
  type FixtureRegion,
  type Infer,
  type Instant,
  isInstant,
  type ItemId,
  itemId,
  literal,
  nullable,
  number,
  object,
  refine,
  type Result,
  string,
  union,
  type Validator,
} from "@oriel/core";

const instant = refine(string, isInstant, "expected an instant");
// A date with no time, as a project's target and a cycle's ends are kept.
const day = refine(string, (text) => /^\d{4}-\d{2}-\d{2}$/.test(text), "expected a date");
const uuid = refine(
  string,
  (text) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text),
  "expected a UUID",
);

// A status's type, Linear's category of it.
export const statusTypes = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;
export type StatusType = (typeof statusTypes)[number];
const statusType = union(...statusTypes.map((type) => literal(type)));

// A project's status, by its type.
export const projectStatusTypes = [
  "backlog",
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;
const projectStatusType = union(...projectStatusTypes.map((type) => literal(type)));

const team = object({ id: uuid, key: string, name: string });
const status = object({ id: uuid, team: uuid, name: string, type: statusType });
// A person, and one who has left: Linear keeps them, inactive.
const personFields = { id: uuid, name: string, displayName: string, email: string };
const person = object({ ...personFields, active: literal(true) });
const gone = object({ ...personFields, active: literal(false) });
const cycle = object({
  id: uuid,
  team: uuid,
  number: number,
  name: nullable(string),
  startsAt: day,
  endsAt: day,
});
const project = object({
  id: uuid,
  // The 12 hex digits ending its URL, which Oriel keys it by.
  slugId: refine(string, (text) => /^[0-9a-f]{12}$/.test(text), "expected a slug ID"),
  name: string,
  description: string,
  status: object({ name: string, type: projectStatusType }),
  lead: nullable(uuid),
  targetDate: nullable(day),
  teams: array(uuid),
  updatedAt: instant,
});
const issue = object({
  id: uuid,
  team: uuid,
  number: number,
  title: string,
  description: string,
  status: uuid,
  assignee: nullable(uuid),
  project: nullable(uuid),
  cycle: nullable(uuid),
  parent: nullable(uuid),
  estimate: nullable(number),
  labels: array(string),
  priority: number,
  updatedAt: instant,
});
const region = object({
  name: string,
  origin: union(
    object({
      kind: literal("cluster"),
      grouping: literal("epic"),
      // The project's UUID, and its item ID.
      cluster: uuid,
      anchor: string,
    }),
    object({ kind: literal("picked") }),
  ),
  items: array(string),
});

export const linearWorldFile = object({
  // Its address on linear.app, as `https://linear.app/<urlKey>/…`.
  workspace: object({ urlKey: string, name: string }),
  teams: array(team),
  statuses: array(status),
  people: array(union(person, gone)),
  cycles: array(cycle),
  projects: array(project),
  issues: array(issue),
  regions: array(region),
});

export type LinearWorldFile = Infer<typeof linearWorldFile>;
export type WorldTeam = Infer<typeof team>;
export type WorldStatus = Infer<typeof status>;
export type WorldPerson = Infer<typeof person> | Infer<typeof gone>;
export type WorldCycle = Infer<typeof cycle>;
export type WorldProject = Infer<typeof project>;
export type WorldIssue = Infer<typeof issue>;
export type LinearWorld = Omit<LinearWorldFile, "regions"> & {
  frozen: Instant;
  regions: FixtureRegion[];
};

export const linearWorldPath = new URL("../../../fixtures/linear/world.json", import.meta.url);

// An issue's identifier, its team's key and its number: ENG-4.
export const identifierOf = (world: Pick<LinearWorldFile, "teams">, each: WorldIssue) =>
  `${world.teams.find((one) => one.id === each.team)?.key ?? "?"}-${each.number}`;

export const projectKey = (slugId: string) => `P-${slugId}`;

// Shape first, then what shapes can't say: every reference resolves, an
// identifier is used once, and a region's items are the world's, a
// tombstone's aside.
export function parseLinearWorld(input: unknown): Result<LinearWorld> {
  const shaped = (linearWorldFile as Validator<LinearWorldFile>)(input);
  if (!shaped.ok) return shaped;
  const world = shaped.value;
  const problems: { path: string; message: string }[] = [];
  const has = (list: readonly { id: string }[], id: string | null) =>
    id === null || list.some((each) => each.id === id);
  const identifiers = new Set<string>();
  world.issues.forEach((each, i) => {
    const at = `$.issues[${i}]`;
    const id = identifierOf(world, each);
    if (identifiers.has(id)) problems.push({ path: at, message: `${id} is used twice` });
    identifiers.add(id);
    for (const [field, list, value] of [
      ["team", world.teams, each.team],
      ["status", world.statuses, each.status],
      ["assignee", world.people, each.assignee],
      ["project", world.projects, each.project],
      ["cycle", world.cycles, each.cycle],
      ["parent", world.issues, each.parent],
    ] as const)
      if (!has(list, value)) problems.push({ path: `${at}.${field}`, message: "not in the world" });
  });
  const projects = new Map(world.projects.map((each) => [each.id, each]));
  const regions = world.regions.map((each): FixtureRegion => {
    const origin = each.origin;
    if (origin.kind === "picked") return { name: each.name, origin, items: each.items as ItemId[] };
    const found = projects.get(origin.cluster);
    if (!found || origin.anchor !== itemId("linear", projectKey(found.slugId)))
      problems.push({ path: `$.regions.${each.name}`, message: "its project isn't in the world" });
    return {
      name: each.name,
      origin: {
        kind: "cluster",
        grouping: "epic",
        cluster: origin.cluster,
        anchor: { id: origin.anchor as ItemId, stableId: origin.cluster },
      },
      items: each.items as ItemId[],
    };
  });
  if (problems.length) return { ok: false, issues: problems };
  // Frozen as of its last change, so its "stuck" rules come out the same.
  const frozen = [...world.issues, ...world.projects]
    .map((each) => each.updatedAt)
    .toSorted()
    .at(-1) as Instant | undefined;
  if (!frozen) return { ok: false, issues: [{ path: "$", message: "an empty world" }] };
  return { ok: true, value: { ...world, frozen, regions } };
}

export function loadLinearWorld(path: URL = linearWorldPath): LinearWorld {
  const read = parseLinearWorld(JSON.parse(readFileSync(path, "utf8")) as unknown);
  if (read.ok) return read.value;
  throw new Error(
    `invalid Linear fixture:\n${read.issues.map((each) => `${each.path}: ${each.message}`).join("\n")}`,
  );
}
