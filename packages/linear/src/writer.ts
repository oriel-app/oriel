// Each mutation is one call of the server's write tools, from a process with only those; what it checks first is read
// through the read tools, and a failure before the write goes out sent nothing. No tool deletes an issue or a project.
import {
  type ItemId,
  type FieldValues,
  type Log,
  noteSent,
  parseItemId,
  SourceRefused,
  type SourceWriter,
  type WriteRequest,
  type WriteResult,
  readEach,
} from "@oriel/core";
import { isProjectKey, projectId } from "./items.ts";
import { type LinearIssue, type LinearProject, linearReads, linearWrites } from "./linear-mcp.ts";
import { isLinearOp, type LinearArgs, type LinearOp, linearOps } from "./shape.ts";
import type { LinearWrites } from "./open-connection.ts";

const refused = (message: string) => new SourceRefused(message, { sent: false });
const labelField = "label:";

type Found = { kind: "issue"; issue: LinearIssue } | { kind: "project"; project: LinearProject };

export function linearWriter(writes: LinearWrites): SourceWriter<"linear"> {
  const { team } = writes;
  const prefix = writes.prefix ?? "linear";
  const reads = linearReads(writes.read);
  const saves = linearWrites(writes.write);
  const idOf = (key: string) => `${prefix}:${key}` as ItemId<"linear">;

  const projects = () => reads.projects(team.id);
  const found = async (id: ItemId): Promise<Found | null> => {
    const key = parseItemId(id)?.key ?? "";
    if (isProjectKey(key)) {
      const known = (await projects()).find((each) => `P-${each.slugId}` === key);
      const project = known ? await reads.project(known.id) : null;
      return project ? { kind: "project", project } : null;
    }
    const issue = await reads.issue(key);
    return issue && issue.identifier === key ? { kind: "issue", issue } : null;
  };

  const valuesOf = async (item: Found, fields: readonly string[]): Promise<FieldValues> => {
    const all: Record<string, unknown> = {};
    if (item.kind === "project") {
      const { project } = item;
      Object.assign(all, {
        summary: project.name,
        description: project.description,
        status: project.status.name,
        updated: project.updatedAt,
      });
    } else {
      const { issue } = item;
      const cycle =
        fields.includes("cycle") && issue.cycle
          ? ((await reads.cycles(team.id)).find((each) => each.id === issue.cycle)?.number ?? null)
          : null;
      const project =
        fields.includes("epic") && issue.project
          ? (await projects()).find((each) => each.id === issue.project)
          : undefined;
      Object.assign(all, {
        summary: issue.title,
        description: issue.description,
        points: issue.estimate,
        assignee: issue.assignee?.name ?? null,
        status: issue.status,
        cycle,
        epic: project ? projectId(project.slugId).replace(/^linear:/, `${prefix}:`) : null,
        labels: [...issue.labels],
        updated: issue.updatedAt,
      });
    }
    return Object.fromEntries(
      fields.flatMap((field) =>
        field.startsWith(labelField) && item.kind === "issue"
          ? [[field, item.issue.labels.includes(field.slice(labelField.length))]]
          : Object.hasOwn(all, field)
            ? [[field, all[field]]]
            : [],
      ),
    );
  };
  const itemOf = (item: Found) =>
    item.kind === "issue"
      ? { id: idOf(item.issue.identifier), stableId: item.issue.id }
      : { id: idOf(`P-${item.project.slugId}`), stableId: item.project.id };

  const statusNamed = async (name: string) => {
    const statuses = await reads.statuses(team.id);
    const alike = statuses.filter((each) => each.name.toLowerCase() === name.toLowerCase());
    const found =
      statuses.find((each) => each.name === name) ?? (alike.length === 1 ? alike[0] : undefined);
    if (!found)
      throw refused(
        `${team.key} has no status ${JSON.stringify(name)}; it has ${statuses.map((each) => each.name).join(", ")}`,
      );
    return found;
  };
  const personNamed = async (name: string) => {
    const people = (await reads.users(name)).filter((each) => each.active);
    const found = people.filter((each) => each.name.toLowerCase() === name.toLowerCase());
    const [one, other] = found;
    if (!one || other)
      throw refused(
        one ? `more than one person is called ${name}` : `nobody active is called ${name}`,
      );
    return one;
  };
  const cycleNumbered = async (number: number) => {
    const found = (await reads.cycles(team.id)).find((each) => each.number === number);
    if (!found) throw refused(`${team.key} has no cycle ${number}`);
    return found;
  };
  const projectFor = async (id: string | null) => {
    if (id === null) return null;
    const key = parseItemId(id)?.key ?? "";
    const found = (await projects()).find((each) => `P-${each.slugId}` === key);
    if (!found) throw refused(`${id} isn't a project of ${team.key}`);
    return found;
  };

  const result = async (before: Found | null, after: Found, fields: readonly string[]) => ({
    item: itemOf(after),
    before: before ? await valuesOf(before, fields) : {},
    after: await valuesOf(after, [...fields, "updated"]),
  });

  const create = async (op: "createProject" | "createIssue", raw: unknown) => {
    if (op === "createProject") {
      const args = parsed(op, raw);
      const project = await noteSent(async (sent) => {
        sent();
        return saves.project({
          name: args.name,
          ...(args.description === undefined ? {} : { description: args.description }),
          addTeams: [team.id],
        });
      });
      return result(null, { kind: "project", project }, ["summary", "description"]);
    }
    const args = parsed(op, raw);
    const issue = await noteSent(async (sent) => {
      const project = await projectFor(args.project);
      const cycle =
        args.cycle === undefined || args.cycle === null ? null : await cycleNumbered(args.cycle);
      sent();
      return saves.issue({
        team: team.id,
        title: args.title,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.estimate === undefined ? {} : { estimate: args.estimate }),
        ...(cycle ? { cycle: cycle.id } : {}),
        ...(project ? { project: project.id } : {}),
      });
    });
    // Nothing it didn't choose: no assignee, which would read as handing the work off, nor a status or labels.
    return result(null, { kind: "issue", issue }, [
      "summary",
      "description",
      "points",
      "cycle",
      "epic",
    ]);
  };

  const edit = async (op: LinearOp, item: Found, raw: unknown) => {
    const onIssue = (field: string, send: () => Promise<Record<string, unknown>>) => {
      if (item.kind !== "issue") throw refused(`${op} takes an issue, not a project`);
      return noteSent(async (sent) => {
        const args = await send();
        sent();
        const issue = await saves.issue({ id: item.issue.id, ...args });
        return result(item, { kind: "issue", issue }, [field]);
      });
    };
    switch (op) {
      case "setTitle":
      case "setDescription": {
        const field = op === "setTitle" ? "summary" : "description";
        const value =
          op === "setTitle" ? parsed(op, raw).title : parsed("setDescription", raw).description;
        if (item.kind === "project")
          return noteSent(async (sent) => {
            sent();
            const project = await saves.project({
              id: item.project.id,
              [op === "setTitle" ? "name" : "description"]: value,
            });
            return result(item, { kind: "project", project }, [field]);
          });
        return onIssue(field, async () => ({
          [op === "setTitle" ? "title" : "description"]: value,
        }));
      }
      case "setEstimate":
        return onIssue("points", async () => ({ estimate: parsed(op, raw).estimate }));
      case "setAssignee": {
        const { name } = parsed(op, raw);
        return onIssue("assignee", async () => ({
          assignee: name === null ? null : (await personNamed(name)).id,
        }));
      }
      case "setStatus": {
        const { status } = parsed(op, raw);
        return onIssue("status", async () => ({ state: (await statusNamed(status)).id }));
      }
      case "setCycle": {
        const { cycle } = parsed(op, raw);
        return onIssue("cycle", async () => ({
          cycle: cycle === null ? null : (await cycleNumbered(cycle)).id,
        }));
      }
      case "addLabel":
      case "removeLabel": {
        const { label } = parsed(op, raw);
        if (item.kind !== "issue") throw refused(`${op} takes an issue, not a project`);
        const kept = item.issue.labels.filter((each) => each !== label);
        return onIssue(`${labelField}${label}`, async () => ({
          labels: op === "addLabel" ? [...kept, label] : kept,
        }));
      }
      case "deleteItem":
        // Never offered (`unsendable`), so never sent.
        throw refused("Linear's MCP server has no tool to delete an issue or a project");
      case "createProject":
      case "createIssue":
        throw refused(`${op} takes no target`);
    }
  };

  const apply = async ({
    op,
    target,
    expectedStableId,
    args,
  }: WriteRequest<"linear">): Promise<WriteResult<"linear">> => {
    if (!isLinearOp(op)) throw refused(`not a Linear operation: ${op}`);
    if (target === null) {
      if (expectedStableId !== null) throw refused(`${op}: a stable ID needs a target`);
      if (op !== "createProject" && op !== "createIssue") throw refused(`${op} needs a target`);
      return create(op, args);
    }
    if (expectedStableId === null) throw refused(`${op}: no stable ID to check ${target} against`);
    const item = await noteSent(async () => found(target));
    if (!item) throw refused(`${target} isn't in Linear`);
    if (itemOf(item).stableId !== expectedStableId) throw refused(`${target} is another item now`);
    return edit(op, item, args);
  };

  const values = async (id: ItemId, fields: readonly string[]) => {
    const item = await found(id);
    return item
      ? { stableId: itemOf(item).stableId, values: await valuesOf(item, fields) }
      : "gone";
  };

  return {
    kind: "linear",
    unsendable: { deleteItem: "A Linear issue or project can't be taken back" },
    apply,
    current: async (id, fields) => {
      const read = await values(id, fields);
      return read === "gone" ? "gone" : read.values;
    },
    read: (ids, fields) => readEach(ids, (id) => values(id, fields)),
  };
}

function parsed<O extends LinearOp>(op: O, args: unknown): LinearArgs<O> {
  const result = linearOps[op].args(args);
  if (!result.ok) throw refused(`${op}: ${result.issues.map((i) => i.message).join("; ")}`);
  return result.value as LinearArgs<O>;
}

export function linearWriterOf(writes: LinearWrites, _log: Log): SourceWriter<"linear"> {
  return linearWriter(writes);
}
