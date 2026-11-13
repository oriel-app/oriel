// Each write lands in one transaction, so nothing is half written: a write that fails changed nothing, and is refused as unsent.
import {
  type Instant,
  isItemId,
  type ItemId,
  type Log,
  parseItemId,
  SourceRefused,
  type SourceWriter,
  type WriteRequest,
  type WriteResult,
} from "@oriel/core";
import { labelField, valuesOf } from "./fields.ts";
import { type Issue, idOf, inTurn, issuesIn, isTrackerId, stableIdOf } from "./issues.ts";
import { tracker, type TrackerArgs, type TrackerOp, trackerOps } from "./shape.ts";
import type { TrackerWrites } from "./open-connection.ts";

const isTrackerOp = tracker.isOp;
const issueFields = tracker.fields;

const refused = (message: string) => new SourceRefused(message, { sent: false });

export function trackerWriter(writes: TrackerWrites): SourceWriter<"tracker"> {
  const issues = issuesIn(writes.own);
  const now = (): Instant => writes.now();
  const found = (id: ItemId): Issue | null => {
    const key = parseItemId(id)?.key;
    return isTrackerId(id) && key !== undefined ? issues.byKey(key) : null;
  };

  const epicOf = (epic: string | null): Issue["epic"] => {
    if (epic === null) return null;
    const issue = isItemId(epic) ? found(epic) : null;
    if (!issue || issue.kind !== "epic") throw refused(`${epic} isn't an epic in the tracker`);
    return { id: idOf(issue.key), stableId: stableIdOf(issue.key) };
  };

  const created = async (issue: Issue): Promise<WriteResult<"tracker">> => {
    await issues.put({ by: "change-set", change: "created", fields: [] }, [issue]);
    return {
      item: { id: idOf(issue.key), stableId: stableIdOf(issue.key) },
      before: {},
      after: valuesOf(issue, [...issueFields, "updated"]),
    };
  };

  const changed = async (
    issue: Issue,
    next: Partial<Issue>,
    fields: readonly string[],
  ): Promise<WriteResult<"tracker">> => {
    const after: Issue = { ...issue, ...next, updatedAt: now() };
    const set = fields.map((field) => (field.startsWith(labelField) ? "labels" : field));
    await issues.put({ by: "change-set", change: "edited", fields: set }, [after]);
    return {
      item: { id: idOf(issue.key), stableId: stableIdOf(issue.key) },
      before: valuesOf(issue, fields),
      after: valuesOf(after, [...fields, "updated"]),
    };
  };

  const create = <O extends "createEpic" | "createStory">(op: O, args: TrackerArgs<O>) => {
    const base = {
      key: issues.nextKey(),
      summary: args.summary,
      description: args.description ?? "",
      status: "To do" as const,
      assignee: null,
      labels: [],
      updatedAt: now(),
    };
    if (op === "createEpic") return created({ ...base, kind: "epic", epic: null, points: null });
    const story = args as TrackerArgs<"createStory">;
    return created({
      ...base,
      kind: "story",
      epic: epicOf(story.epic),
      points: story.points ?? null,
    });
  };

  const edit = (op: TrackerOp, issue: Issue, raw: unknown): Promise<WriteResult<"tracker">> => {
    switch (op) {
      case "setSummary": {
        const { summary } = parsed(op, raw);
        return changed(issue, { summary }, ["summary"]);
      }
      case "setDescription": {
        const { description } = parsed(op, raw);
        return changed(issue, { description }, ["description"]);
      }
      case "setEstimate": {
        const { points } = parsed(op, raw);
        if (issue.kind === "epic")
          throw refused(`${issue.key} is an epic, which takes no estimate`);
        return changed(issue, { points }, ["points"]);
      }
      case "setAssignee": {
        const { name } = parsed(op, raw);
        return changed(issue, { assignee: name }, ["assignee"]);
      }
      case "setStatus": {
        const { status } = parsed(op, raw);
        return changed(issue, { status }, ["status"]);
      }
      case "addLabel": {
        const { label } = parsed(op, raw);
        const labels = issue.labels.includes(label) ? issue.labels : [...issue.labels, label];
        return changed(issue, { labels }, [`${labelField}${label}`]);
      }
      case "removeLabel": {
        const { label } = parsed(op, raw);
        const labels = issue.labels.filter((each) => each !== label);
        return changed(issue, { labels }, [`${labelField}${label}`]);
      }
      case "deleteItem":
        // An epic another change set put a story in since stays, as
        // deleting it would leave that story in an epic that's gone.
        if (
          issue.kind === "epic" &&
          issues.all().some((each) => each.epic?.stableId === stableIdOf(issue.key))
        )
          throw refused(`${issue.key} holds stories, so it stays`);
        return (async () => {
          await issues.put({ by: "change-set", change: "deleted", fields: [] }, [], [issue.key]);
          return {
            item: { id: idOf(issue.key), stableId: stableIdOf(issue.key) },
            before: valuesOf(issue, issueFields),
            after: {},
          };
        })();
      case "createEpic":
      case "createStory":
        throw refused(`${op} takes no target`);
    }
  };

  const apply = async ({
    op,
    target,
    expectedStableId,
    args,
  }: WriteRequest<"tracker">): Promise<WriteResult<"tracker">> => {
    if (!isTrackerOp(op)) throw refused(`not a tracker operation: ${op}`);
    if (target === null) {
      if (expectedStableId !== null) throw refused(`${op}: a stable ID needs a target`);
      if (op !== "createEpic" && op !== "createStory") throw refused(`${op} needs a target`);
      return create(op, parsed(op, args));
    }
    if (expectedStableId === null) throw refused(`${op}: no stable ID to check ${target} against`);
    const issue = found(target);
    if (!issue) throw refused(`${target} isn't in the tracker`);
    if (stableIdOf(issue.key) !== expectedStableId) throw refused(`${target} is another issue now`);
    return edit(op, issue, args);
  };

  const values = (id: ItemId, fields: readonly string[]) => {
    const issue = found(id);
    return issue ? { stableId: stableIdOf(issue.key), values: valuesOf(issue, fields) } : "gone";
  };

  return {
    kind: "tracker",
    // Anything that fails before its transaction commits changed nothing.
    apply: async (request) => {
      try {
        return await inTurn(writes.own, () => apply(request));
      } catch (error) {
        if (error instanceof SourceRefused) throw error;
        throw new SourceRefused(error instanceof Error ? error.message : String(error), {
          sent: false,
          cause: error,
        });
      }
    },
    current: async (id, fields) => {
      const found = values(id, fields);
      return found === "gone" ? "gone" : found.values;
    },
    read: async (id, fields) => values(id, fields),
  };
}

function parsed<O extends TrackerOp>(op: O, args: unknown): TrackerArgs<O> {
  const result = trackerOps[op].args(args);
  if (!result.ok) throw refused(`${op}: ${result.issues.map((i) => i.message).join("; ")}`);
  return result.value as TrackerArgs<O>;
}

export function trackerWriterOf(writes: TrackerWrites, _log: Log): SourceWriter<"tracker"> {
  return trackerWriter(writes);
}
