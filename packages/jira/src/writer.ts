// The Jira writer. Only packages/changeset imports this subpath (checked by
// scripts/check-repo.ts), and `apply` takes only a request a person approved:
// its type comes from `SourceWriter`, so nothing here can mint one.
//
// Before and after values are keyed by core's field names (`FieldValues`):
// "summary", "description"
// (plain text), "points", "assignee" (an account ID), "epic" (an item ID), and
// "link:<linkId>" ({ url, title }, or null when there is no such link). A
// create has no before values and a delete no after values.
import {
  array,
  boolean,
  type FieldValues,
  type ItemId,
  itemId,
  type Log,
  number,
  object,
  optional,
  parseItemId,
  SourceRefused,
  type SourceWriter,
  string,
  unknown,
  type Validator,
  type WriteResult,
} from "@oriel/core";
import { isJiraOp, type JiraArgs, type JiraOp, jiraOps } from "./ops.ts";
import { adfToText, textToAdf } from "./adf.ts";
import {
  api,
  call,
  discoverPoints,
  epicOf,
  indexFieldShape,
  issue,
  issueKey,
  keyOf,
  numericId,
  pointsOf,
  projectKey,
  projectOf,
  rawField,
} from "./rest.ts";
import { failure, type JiraRequest, type JiraResponse, type Transport } from "./transport.ts";

// Only this entry hands out a transport that can write.
export { restTransport, type Transport } from "./transport.ts";

export type JiraWriterOptions = {
  transport: Transport;
  // Where a story with no epic is created.
  project: string;
  log: Log;
};

// A write's target: an item's handle and the stable ID it must have.
type Target = { id: ItemId<"jira">; stableId: string } | null;
type Send = (request: JiraRequest) => Promise<JiraResponse>;

const issueFields = ["summary", "description", "points", "assignee", "epic"] as const;
type IssueField = (typeof issueFields)[number];
const isIssueField = (name: string): name is IssueField =>
  (issueFields as readonly string[]).includes(name);
const linkField = (linkId: string) => `link:${linkId}`;

const valuesIssue = issue(
  object({
    summary: indexFieldShape.summary,
    issuetype: indexFieldShape.issuetype,
    parent: indexFieldShape.parent,
    assignee: indexFieldShape.assignee,
    updated: indexFieldShape.updated,
    description: optional(unknown),
  }),
);
const remoteLink = object({ id: number, object: object({ url: string, title: optional(string) }) });
const created = object({ id: numericId, key: issueKey });
const createdLink = object({ id: number });
const issueTypes = object({
  issueTypes: array(object({ id: string, name: string, subtask: optional(boolean) })),
});

const valid = <T>(validate: Validator<T>, args: unknown, op: string): T => {
  const result = validate(args, "$.args");
  if (result.ok) return result.value;
  const where = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
  throw new Error(`${op}: bad arguments (${where})`);
};

export function jiraWriter(options: JiraWriterOptions): SourceWriter<"jira"> {
  const { transport, log } = options;
  if (!projectKey.test(options.project)) throw new RangeError("expected a project key, like SYN");

  // Each write is one request, its `send`. A 4xx to it is Jira refusing it,
  // having made no change; any other failure of it may have landed. Each
  // apply gets its own, which notes when the write went out: anything that
  // fails before then (a read, a check, the request's credentials) sent
  // nothing.
  const sender = () => {
    const state = { sent: false };
    const send: Send = async (request) => {
      state.sent = true;
      const response = await transport(request);
      if (response.status >= 400 && response.status <= 499)
        throw new SourceRefused(failure(request, response).message, { sent: true });
      if (response.status < 200 || response.status > 299) throw failure(request, response);
      return response;
    };
    return { send, state };
  };

  const pointsFields = new Map<string, Promise<string | undefined>>();
  const pointsField = (project: string) => {
    const known = pointsFields.get(project);
    if (known) return known;
    const found = discoverPoints(transport, [project], log).then((map) => map.get(project));
    found.catch(() => pointsFields.delete(project));
    pointsFields.set(project, found);
    return found;
  };
  const requirePoints = async (project: string) => {
    const field = await pointsField(project);
    if (!field) throw new Error(`${project}'s board has no points field to estimate in`);
    return field;
  };

  // The item's current values for `names`, or "gone". Reads follow a moved
  // issue to its new key.
  const values = async (
    key: string,
    names: readonly string[],
  ): Promise<{ key: string; stableId: string; values: FieldValues } | "gone"> => {
    const unknownName = names.find(
      (name) => !isIssueField(name) && name !== "updated" && !name.startsWith("link:"),
    );
    if (unknownName !== undefined) throw new RangeError(`not a Jira field: ${unknownName}`);
    const points = names.includes("points") ? await pointsField(projectOf(key)) : undefined;
    const fields = ["summary", "description", "issuetype", "parent", "assignee", "updated"];
    const request: JiraRequest = {
      method: "GET",
      path: `${api}/issue/${key}?fields=${[...fields, ...(points ? [points] : [])].join(",")}`,
    };
    const response = await transport(request);
    if (response.status === 404 || response.status === 403) return "gone";
    const found = await call(async () => response, request, valuesIssue);
    // A move to another project can change which field holds points.
    if (points !== undefined && projectOf(found.key) !== projectOf(key))
      return values(found.key, names);
    const read: Record<IssueField, () => unknown> = {
      summary: () => found.fields.summary,
      description: () => adfToText(found.fields.description),
      points: () => pointsOf(rawField(response.body, points)),
      assignee: () => found.fields.assignee?.accountId ?? null,
      epic: () => epicOf(found.fields),
    };
    const entries = await Promise.all(
      names.map(async (name): Promise<[string, unknown]> => {
        if (name === "updated") return [name, found.fields.updated];
        if (isIssueField(name)) return [name, read[name]()];
        return [name, await link(found.key, name.slice("link:".length))];
      }),
    );
    return { key: found.key, stableId: found.id, values: Object.fromEntries(entries) };
  };

  const link = async (key: string, linkId: string) => {
    if (!numericId(linkId).ok) return null;
    const request: JiraRequest = {
      method: "GET",
      path: `${api}/issue/${key}/remotelink/${linkId}`,
    };
    const response = await transport(request);
    if (response.status === 404) return null;
    const found = await call(async () => response, request, remoteLink);
    return { url: found.object.url, title: found.object.title ?? found.object.url };
  };

  // The target's current values, read through its handle, so long as the
  // handle still names the item with the stable ID expected of it.
  const existing = async (target: Target, names: readonly string[]) => {
    if (target === null) throw new Error("this operation needs a target item");
    const found = await values(keyOf(target.id), names);
    if (found === "gone") throw new Error(`${target.id} is gone from Jira`);
    if (found.stableId !== target.stableId)
      throw new Error(
        `${target.id} names another item in Jira now (stable ID ${found.stableId}, not ${target.stableId})`,
      );
    return found;
  };

  // Once Jira has accepted a write, the change set must hear about it, so a
  // failed read afterwards leaves `after` empty instead of throwing. Revert's
  // conflict check then has nothing to match, and stops. `after` also carries
  // the item's `updated`, which tells revert whether anyone has touched an
  // item Oriel created since Oriel last wrote to it.
  const afterwards = async (key: string, stableId: string, names: readonly string[]) => {
    try {
      const after = await existing({ id: itemId("jira", key), stableId }, [...names, "updated"]);
      return {
        item: { id: itemId("jira", after.key), stableId: after.stableId },
        after: after.values,
      };
    } catch (error) {
      log("jira: wrote, but couldn't read the result back", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return { item: { id: itemId("jira", key), stableId }, after: {} };
    }
  };

  // Reads before, sends, reads after.
  const edit = async (
    send: Send,
    target: Target,
    names: readonly string[],
    request: (key: string, before: FieldValues) => Promise<JiraRequest>,
  ): Promise<WriteResult<"jira">> => {
    const before = await existing(target, names);
    await send(await request(before.key, before.values));
    return { before: before.values, ...(await afterwards(before.key, before.stableId, names)) };
  };

  const put = (key: string, fields: Record<string, unknown>): JiraRequest => ({
    method: "PUT",
    path: `${api}/issue/${key}`,
    body: { fields },
  });

  const createStory = async (
    send: Send,
    args: JiraArgs<"createStory">,
  ): Promise<WriteResult<"jira">> => {
    const epic = args.epic === null ? null : parseItemId(args.epic);
    if (args.epic !== null && epic?.source !== "jira")
      throw new Error("createStory: epic must be a Jira item ID, like jira:SYN-1");
    const project = epic ? projectOf(epic.key) : options.project;
    const fields: Record<string, unknown> = {
      project: { key: project },
      issuetype: { id: await issueType(project, "Story") },
      summary: args.summary,
    };
    if (args.description) fields.description = textToAdf(args.description);
    if (epic) fields.parent = { key: epic.key };
    if (args.points !== undefined && args.points !== null)
      fields[await requirePoints(project)] = args.points;
    const response = await send({ method: "POST", path: `${api}/issue`, body: { fields } });
    const made = created(response.body);
    if (!made.ok) throw new Error("createStory: Jira's answer had no issue ID and key");
    const names = ["summary", "description", "points", "epic"];
    return { before: {}, ...(await afterwards(made.value.key, made.value.id, names)) };
  };

  // A new epic goes in the project the writer was made for.
  const createEpic = async (
    send: Send,
    args: JiraArgs<"createEpic">,
  ): Promise<WriteResult<"jira">> => {
    const project = options.project;
    const fields: Record<string, unknown> = {
      project: { key: project },
      issuetype: { id: await issueType(project, "Epic") },
      summary: args.summary,
    };
    if (args.description) fields.description = textToAdf(args.description);
    const response = await send({ method: "POST", path: `${api}/issue`, body: { fields } });
    const made = created(response.body);
    if (!made.ok) throw new Error("createEpic: Jira's answer had no issue ID and key");
    const names = ["summary", "description"];
    return { before: {}, ...(await afterwards(made.value.key, made.value.id, names)) };
  };

  const typeIds = new Map<string, Promise<string>>();
  const issueType = (project: string, name: "Story" | "Epic") => {
    const known = typeIds.get(`${project}/${name}`);
    if (known) return known;
    const found = call(
      transport,
      { method: "GET", path: `${api}/issue/createmeta/${project}/issuetypes` },
      issueTypes,
    ).then(({ issueTypes }) => {
      const type = issueTypes.find((type) => type.name === name && type.subtask !== true);
      if (!type) throw new Error(`${project} has no ${name} issue type`);
      return type.id;
    });
    found.catch(() => typeIds.delete(`${project}/${name}`));
    typeIds.set(`${project}/${name}`, found);
    return found;
  };

  const write = (
    send: Send,
    op: JiraOp,
    target: Target,
    args: unknown,
  ): Promise<WriteResult<"jira">> => {
    switch (op) {
      case "createEpic":
        return createEpic(send, valid(jiraOps.createEpic.args, args, op));
      case "createStory":
        return createStory(send, valid(jiraOps.createStory.args, args, op));
      case "setSummary": {
        const { summary } = valid(jiraOps.setSummary.args, args, op);
        return edit(send, target, ["summary"], async (key) => put(key, { summary }));
      }
      case "setDescription": {
        const { description } = valid(jiraOps.setDescription.args, args, op);
        return edit(send, target, ["description"], async (key) =>
          put(key, { description: textToAdf(description) }),
        );
      }
      case "setEstimate": {
        const { points } = valid(jiraOps.setEstimate.args, args, op);
        return edit(send, target, ["points"], async (key) =>
          put(key, { [await requirePoints(projectOf(key))]: points }),
        );
      }
      case "setAssignee": {
        const { accountId } = valid(jiraOps.setAssignee.args, args, op);
        return edit(send, target, ["assignee"], async (key) => ({
          method: "PUT",
          path: `${api}/issue/${key}/assignee`,
          body: { accountId },
        }));
      }
      case "addLink":
        return addLink(send, target, valid(jiraOps.addLink.args, args, op));
      case "removeLink": {
        const { linkId } = valid(jiraOps.removeLink.args, args, op);
        const name = linkField(linkId);
        return edit(send, target, [name], async (key, before) => {
          if (before[name] === null) throw new Error(`removeLink: ${key} has no link ${linkId}`);
          return { method: "DELETE", path: `${api}/issue/${key}/remotelink/${linkId}` };
        });
      }
      case "deleteItem":
        valid(jiraOps.deleteItem.args, args, op);
        return deleteItem(send, target);
    }
  };

  const addLink = async (
    send: Send,
    target: Target,
    { url, title }: JiraArgs<"addLink">,
  ): Promise<WriteResult<"jira">> => {
    const before = await existing(target, []);
    const response = await send({
      method: "POST",
      path: `${api}/issue/${before.key}/remotelink`,
      body: { object: { url, title } },
    });
    const made = createdLink(response.body);
    if (!made.ok) throw new Error("addLink: Jira's answer had no link ID");
    const name = linkField(String(made.value.id));
    return { before: { [name]: null }, ...(await afterwards(before.key, before.stableId, [name])) };
  };

  const deleteItem = async (send: Send, target: Target): Promise<WriteResult<"jira">> => {
    const before = await existing(target, issueFields);
    await send({ method: "DELETE", path: `${api}/issue/${before.key}` });
    return {
      item: { id: itemId("jira", before.key), stableId: before.stableId },
      before: before.values,
      after: {},
    };
  };

  return {
    kind: "jira",
    // A target must come with the stable ID it is expected to have, and a
    // create with none. A failure before the write went out sent nothing.
    apply: async ({ op, target, expectedStableId, args }) => {
      const { send, state } = sender();
      try {
        if (!isJiraOp(op)) throw new Error(`not a Jira operation: ${op}`);
        if (target === null) {
          if (expectedStableId !== null) throw new Error(`${op}: a stable ID needs a target`);
          return await write(send, op, null, args);
        }
        if (expectedStableId === null)
          throw new Error(`${op}: no stable ID to check ${target} against`);
        return await write(send, op, { id: target, stableId: expectedStableId }, args);
      } catch (error) {
        if (state.sent || error instanceof SourceRefused) throw error;
        const said = error instanceof Error ? error.message : String(error);
        throw new SourceRefused(said, { sent: false, cause: error });
      }
    },
    current: async (id, fields) => {
      const found = await values(keyOf(id), fields);
      return found === "gone" ? "gone" : found.values;
    },
    read: async (id, fields) => {
      const found = await values(keyOf(id), fields);
      return found === "gone" ? "gone" : { stableId: found.stableId, values: found.values };
    },
  };
}
