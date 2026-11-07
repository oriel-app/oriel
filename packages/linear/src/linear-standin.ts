// A stand-in for Linear's MCP server (OA-278), so Linear's support through
// a source server can be built and tried with no Linear workspace: it
// reports the real server's tool names and arguments, and answers each from
// Ferrowick's Linear, `fixtures/linear`, in memory. Writes change only this
// process's copy, each at the next minute after the world's last change, so
// no clock is read. Never published, never bundled.
//
// Linear documents neither its tools' arguments nor their answers: those
// here are the parser's (`linear-mcp.ts`), to be checked against the real
// server's (packages/standin-mcp/README.md, "Re-recording"). It rejects an
// argument it doesn't take, as Linear's server has since May 2026. Served
// over stdio by packages/standin-mcp, and in memory to this package's
// tests: `@oriel/linear/standin`.
import { type Instant, type StandInAnswer, type StandInTool, standInCalls } from "@oriel/core";
import { linearTools as t } from "./linear-mcp.ts";
import {
  identifierOf,
  type LinearWorld,
  loadLinearWorld,
  type WorldIssue,
  type WorldProject,
} from "./world.ts";

const ok = (value: unknown): StandInAnswer => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
const failed = (words: string): StandInAnswer => ({
  content: [{ type: "text", text: words }],
  isError: true,
});

// What it reports in its handshake, which the real one's docs don't say.
export const linearInfo = { name: "linear", version: "standin" };

const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

// The fixture's world, a copy a stand-in may change.
export const standInWorld = (world: LinearWorld = loadLinearWorld()): LinearWorld =>
  structuredClone(world);

// Its tools as a caller in this process, for tests.
export const standInCaller = (tools: readonly StandInTool[] = linearStandIn()) =>
  standInCalls(tools);

const pageOf = <T extends { id: string }>(all: readonly T[], args: Record<string, unknown>) => {
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 250);
  const after =
    typeof args.after === "string" ? all.findIndex((each) => each.id === args.after) : -1;
  if (typeof args.after === "string" && after === -1) return null;
  const page = all.slice(after + 1, after + 1 + limit);
  const more = after + 1 + limit < all.length;
  return {
    page,
    pageInfo: { hasNextPage: more, endCursor: more ? (page.at(-1)?.id ?? null) : null },
  };
};

export function linearStandIn(world: LinearWorld = standInWorld()): StandInTool[] {
  const base = `https://linear.app/${world.workspace.urlKey}`;
  let minutes = 0;
  const now = (): Instant => {
    minutes += 1;
    return new Date(Date.parse(world.frozen) + minutes * 60_000).toISOString() as Instant;
  };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const person = (id: string | null) => world.people.find((each) => each.id === id) ?? null;
  const teamOf = (given: unknown) =>
    world.teams.find((each) => [each.id, each.key, each.name].includes(text(given))) ?? null;
  const slug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  // An issue as the stand-in answers it: flat, each thing it names by name
  // with its ID beside it.
  const issueView = (issue: WorldIssue) => {
    const status = world.statuses.find((each) => each.id === issue.status);
    const team = world.teams.find((each) => each.id === issue.team);
    const project = world.projects.find((each) => each.id === issue.project);
    const assignee = person(issue.assignee);
    const identifier = identifierOf(world, issue);
    return {
      id: issue.id,
      identifier,
      title: issue.title,
      description: issue.description,
      priority: {
        value: issue.priority,
        name: ["None", "Urgent", "High", "Medium", "Low"][issue.priority],
      },
      url: `${base}/issue/${identifier}/${slug(issue.title).slice(0, 40)}`,
      updatedAt: issue.updatedAt,
      status: status?.name ?? "",
      statusType: status?.type ?? "",
      labels: [...issue.labels],
      assignee: assignee?.name ?? null,
      assigneeId: issue.assignee,
      project: project?.name ?? null,
      projectId: issue.project,
      cycleId: issue.cycle,
      team: team?.name ?? "",
      teamId: issue.team,
      parentId: issue.parent,
      estimate: issue.estimate,
    };
  };
  const projectView = (project: WorldProject) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    url: `${base}/project/${slug(project.name)}-${project.slugId}`,
    status: { ...project.status },
    lead: project.lead && { id: project.lead, name: person(project.lead)?.name ?? "" },
    targetDate: project.targetDate,
    updatedAt: project.updatedAt,
  });
  const issueBy = (given: unknown) =>
    world.issues.find(
      (each) => each.id === text(given) || identifierOf(world, each) === text(given),
    ) ?? null;
  const projectBy = (given: unknown) =>
    world.projects.find((each) => [each.id, each.name, each.slugId].includes(text(given))) ?? null;

  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    readOnly: boolean,
    call: (args: Record<string, unknown>) => Promise<StandInAnswer> | StandInAnswer,
  ): StandInTool => ({
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: { readOnlyHint: readOnly },
    call: async (args) => {
      const unknown = Object.keys(args).find((key) => !Object.hasOwn(properties, key));
      if (unknown) return failed(`Invalid arguments: unknown parameter ${unknown}`);
      const missing = required.find((key) => args[key] === undefined);
      if (missing) return failed(`Invalid arguments: ${missing} is required`);
      return call(args);
    },
  });
  const unused = (name: string, description: string, readOnly: boolean): StandInTool =>
    tool(name, description, {}, [], readOnly, () => failed(`${name} isn't in the stand-in.`));
  const listing = { limit: number, after: string, before: string, orderBy: string };

  // A save's fields, each as Linear takes it: a person, a status and a
  // cycle by name, number or ID, a project by name, ID or slug; null
  // removes one.
  const saveIssue = (args: Record<string, unknown>): StandInAnswer => {
    const existing = args.id === undefined ? null : issueBy(args.id);
    if (args.id !== undefined && !existing) return failed("Issue not found");
    const team = existing
      ? world.teams.find((each) => each.id === existing.team)
      : teamOf(args.team);
    if (!team)
      return failed(
        args.team === undefined
          ? "Invalid arguments: team is required when creating"
          : "Team not found",
      );
    if (!existing && !text(args.title))
      return failed("Invalid arguments: title is required when creating");
    const next: WorldIssue = existing
      ? { ...existing }
      : {
          id: `00000007-0000-4000-8000-${(0xf000 + world.issues.length).toString(16).padStart(12, "0")}`,
          team: team.id,
          number:
            Math.max(
              0,
              ...world.issues.filter((each) => each.team === team.id).map((each) => each.number),
            ) + 1,
          title: "",
          description: "",
          status:
            world.statuses.find((each) => each.team === team.id && each.type === "unstarted")?.id ??
            "",
          assignee: null,
          project: null,
          cycle: null,
          parent: null,
          estimate: null,
          labels: [],
          priority: 0,
          updatedAt: world.frozen,
        };
    if (args.title !== undefined) next.title = text(args.title);
    if (args.description !== undefined) next.description = text(args.description);
    if (args.estimate !== undefined)
      next.estimate = typeof args.estimate === "number" ? args.estimate : null;
    if (args.labels !== undefined) {
      if (!Array.isArray(args.labels)) return failed("Invalid arguments: labels must be an array");
      next.labels = args.labels.map(text);
    }
    if (args.assignee !== undefined) {
      const found =
        args.assignee === null
          ? null
          : world.people.find((each) =>
              [each.id, each.name, each.displayName, each.email].includes(text(args.assignee)),
            );
      if (found === undefined) return failed("User not found");
      next.assignee = found?.id ?? null;
    }
    if (args.state !== undefined) {
      const found = world.statuses.find(
        (each) => each.team === team.id && [each.id, each.name].includes(text(args.state)),
      );
      if (!found) return failed("Status not found");
      next.status = found.id;
    }
    if (args.project !== undefined) {
      const found = args.project === null ? null : projectBy(args.project);
      if (found === undefined) return failed("Project not found");
      next.project = found?.id ?? null;
    }
    if (args.cycle !== undefined) {
      const found =
        args.cycle === null
          ? null
          : world.cycles.find(
              (each) =>
                each.team === team.id &&
                [each.id, String(each.number), each.name].includes(String(args.cycle)),
            );
      if (found === undefined) return failed("Cycle not found");
      next.cycle = found?.id ?? null;
    }
    if (args.parentId !== undefined) {
      const found = args.parentId === null ? null : issueBy(args.parentId);
      if (found === undefined) return failed("Parent issue not found");
      next.parent = found?.id ?? null;
    }
    next.updatedAt = now();
    if (existing) world.issues[world.issues.indexOf(existing)] = next;
    else world.issues.push(next);
    return ok(issueView(next));
  };

  const saveProject = (args: Record<string, unknown>): StandInAnswer => {
    const existing = args.id === undefined ? null : projectBy(args.id);
    if (args.id !== undefined && !existing) return failed("Project not found");
    const teams = Array.isArray(args.addTeams) ? args.addTeams.map(teamOf) : [];
    if (teams.some((each) => each === null)) return failed("Team not found");
    if (!existing && (!text(args.name) || teams.length === 0))
      return failed("Invalid arguments: name and a team are required when creating");
    const next: WorldProject = existing
      ? { ...existing }
      : {
          id: `00000006-0000-4000-8000-${(0xf000 + world.projects.length).toString(16).padStart(12, "0")}`,
          slugId: (0xf0000000000 + world.projects.length).toString(16).padStart(12, "0"),
          name: "",
          description: "",
          status: { name: "Planned", type: "planned" },
          lead: null,
          targetDate: null,
          teams: [],
          updatedAt: world.frozen,
        };
    if (args.name !== undefined) next.name = text(args.name);
    if (args.description !== undefined) next.description = text(args.description);
    next.teams = [...new Set([...next.teams, ...teams.flatMap((each) => (each ? [each.id] : []))])];
    next.updatedAt = now();
    if (existing) world.projects[world.projects.indexOf(existing)] = next;
    else world.projects.push(next);
    return ok(projectView(next));
  };

  return [
    tool(
      t.teams,
      "List teams in the user's Linear workspace",
      { ...listing, query: string, includeArchived: boolean },
      [],
      true,
      (args) => {
        const page = pageOf(world.teams, args);
        return page ? ok({ teams: page.page, pageInfo: page.pageInfo }) : failed("Invalid cursor");
      },
    ),
    tool(
      t.statuses,
      "List available issue statuses in a Linear team",
      { team: string },
      ["team"],
      true,
      (args) => {
        const team = teamOf(args.team);
        if (!team) return failed("Team not found");
        return ok({
          statuses: world.statuses
            .filter((each) => each.team === team.id)
            .map(({ id, name, type }) => ({ id, name, type })),
        });
      },
    ),
    unused(
      "get_issue_status",
      "Retrieve detailed information about an issue status in Linear by name or ID",
      true,
    ),
    tool(
      t.cycles,
      "Retrieve cycles for a specific Linear team",
      { teamId: string, type: string },
      ["teamId"],
      true,
      (args) => {
        const team = teamOf(args.teamId);
        if (!team) return failed("Team not found");
        return ok({
          cycles: world.cycles
            .filter((each) => each.team === team.id)
            .map(({ id, number, name, startsAt, endsAt }) => ({
              id,
              number,
              name,
              startsAt: `${startsAt}T00:00:00.000Z`,
              endsAt: `${endsAt}T00:00:00.000Z`,
            })),
        });
      },
    ),
    tool(t.users, "Retrieve users in the Linear workspace", { query: string }, [], true, (args) => {
      const query = text(args.query).toLowerCase();
      return ok({
        users: world.people
          .filter(
            (each) =>
              !query ||
              [each.name, each.displayName, each.email].some((one) =>
                one.toLowerCase().includes(query),
              ),
          )
          .map(({ id, name, displayName, email, active }) => ({
            id,
            name,
            displayName,
            email,
            active,
          })),
      });
    }),
    unused("get_user", "Retrieve details of a specific Linear user", true),
    tool(
      t.projects,
      "List projects in the user's Linear workspace",
      {
        ...listing,
        teamId: string,
        createdAt: string,
        updatedAt: string,
        includeArchived: boolean,
      },
      [],
      true,
      (args) => {
        const team = args.teamId === undefined ? null : teamOf(args.teamId);
        if (args.teamId !== undefined && !team) return failed("Team not found");
        const all = world.projects.filter((each) => !team || each.teams.includes(team.id));
        const page = pageOf(all, args);
        return page
          ? ok({ projects: page.page.map(projectView), pageInfo: page.pageInfo })
          : failed("Invalid cursor");
      },
    ),
    tool(
      t.project,
      "Retrieve details of a specific project in Linear",
      { query: string },
      ["query"],
      true,
      (args) => {
        const project = projectBy(args.query);
        return project ? ok(projectView(project)) : failed("Project not found");
      },
    ),
    tool(
      t.issues,
      "List issues in the user's Linear workspace",
      {
        ...listing,
        team: string,
        cycle: string,
        label: string,
        query: string,
        state: string,
        project: string,
        assignee: string,
        delegate: string,
      },
      [],
      true,
      (args) => {
        const team = args.team === undefined ? null : teamOf(args.team);
        if (args.team !== undefined && !team) return failed("Team not found");
        const all = world.issues.filter((each) => !team || each.team === team.id);
        const page = pageOf(all, args);
        return page
          ? ok({ issues: page.page.map(issueView), pageInfo: page.pageInfo })
          : failed("Invalid cursor");
      },
    ),
    tool(
      t.issue,
      "Retrieve detailed information about an issue by ID, including attachments and git branch name",
      { id: string, includeRelations: boolean },
      ["id"],
      true,
      (args) => {
        const issue = issueBy(args.id);
        return issue ? ok(issueView(issue)) : failed("Issue not found");
      },
    ),
    unused("list_comments", "List comments for a specific Linear issue", true),
    unused("list_issue_labels", "List available issue labels in a Linear workspace or team", true),
    unused("list_documents", "List documents in the user's Linear workspace", true),
    unused(
      "search_documentation",
      "Search Linear's documentation to learn about features and usage",
      true,
    ),
    tool(
      t.saveIssue,
      "Create or update a Linear issue. With id, it updates that issue; without, it creates one, and title and team are required.",
      {
        id: string,
        team: string,
        title: string,
        description: string,
        assignee: nullableString,
        state: string,
        project: nullableString,
        cycle: { type: ["string", "number", "null"] },
        estimate: nullableNumber,
        labels: { type: "array", items: string },
        parentId: nullableString,
        priority: number,
        dueDate: nullableString,
      },
      [],
      false,
      saveIssue,
    ),
    tool(
      t.saveProject,
      "Create or update a Linear project. With id, it updates that project; without, name and at least one team (addTeams) are required.",
      {
        id: string,
        name: string,
        description: string,
        addTeams: { type: "array", items: string },
        setTeams: { type: "array", items: string },
        lead: nullableString,
        targetDate: nullableString,
      },
      [],
      false,
      saveProject,
    ),
    unused("save_comment", "Create or update a comment on a Linear issue", false),
    unused("delete_comment", "Delete a comment from a Linear issue", false),
    unused("create_issue_label", "Create a new Linear issue label", false),
  ];
}
