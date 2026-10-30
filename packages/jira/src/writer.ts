// The Jira writer. Only packages/changeset imports this subpath (checked by
// scripts/check-repo.ts), and `apply` takes only a request a person approved:
// its type comes from `SourceWriter`, so nothing here can mint one.
//
// Before and after values are keyed by field name: "summary", "description"
// (plain text), "points", "assignee" (an account ID), "epic" (an item ID), and
// "link:<linkId>" ({ url, title }, or null when there is no such link). A
// create has no before values and a delete no after values.
import {
  array,
  boolean,
  type FieldValues,
  type ItemId,
  isJiraOp,
  itemId,
  type JiraArgs,
  jiraOps,
  type JiraOp,
  type Log,
  number,
  object,
  optional,
  parseItemId,
  type SourceWriter,
  string,
  unknown,
  type Validator,
  type WriteResult,
} from "@oriel/core";
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
import { failure, type JiraRequest, type Transport } from "./transport.ts";

// Only this entry hands out a transport that can write.
export { restTransport, type Transport } from "./transport.ts";

export type JiraWriterOptions = {
  transport: Transport;
  // Where a story with no epic is created.
  project: string;
  log: Log;
};

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

const webUrl = (url: string) =>
  URL.canParse(url) && ["https:", "http:"].includes(new URL(url).protocol);

export function jiraWriter(options: JiraWriterOptions): SourceWriter<"jira"> {
  const { transport, log } = options;
  if (!projectKey.test(options.project)) throw new RangeError("expected a project key, like SYN");

  const send = async (request: JiraRequest) => {
    const response = await transport(request);
    if (response.status < 200 || response.status > 299) throw failure(request, response);
    return response;
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

  const existing = async (target: ItemId<"jira"> | null, names: readonly string[]) => {
    if (target === null) throw new Error("this operation needs a target item");
    const found = await values(keyOf(target), names);
    if (found === "gone") throw new Error(`${target} is gone from Jira`);
    return found;
  };

  // Once Jira has accepted a write, the change set must hear about it, so a
  // failed read afterwards leaves `after` empty instead of throwing. Revert's
  // conflict check then has nothing to match, and stops. `after` also carries
  // the item's `updated`, which tells revert whether anyone has touched an
  // item Oriel created since Oriel last wrote to it.
  const afterwards = async (key: string, stableId: string, names: readonly string[]) => {
    try {
      const after = await existing(itemId("jira", key), [...names, "updated"]);
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
    target: ItemId<"jira"> | null,
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

  const createStory = async (args: JiraArgs<"createStory">): Promise<WriteResult<"jira">> => {
    const epic = args.epic === null ? null : parseItemId(args.epic);
    if (args.epic !== null && epic?.source !== "jira")
      throw new Error("createStory: epic must be a Jira item ID, like jira:SYN-1");
    const project = epic ? projectOf(epic.key) : options.project;
    const fields: Record<string, unknown> = {
      project: { key: project },
      issuetype: { id: await storyType(project) },
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

  const storyTypes = new Map<string, Promise<string>>();
  const storyType = (project: string) => {
    const known = storyTypes.get(project);
    if (known) return known;
    const found = call(
      transport,
      { method: "GET", path: `${api}/issue/createmeta/${project}/issuetypes` },
      issueTypes,
    ).then(({ issueTypes }) => {
      const story = issueTypes.find((type) => type.name === "Story" && type.subtask !== true);
      if (!story) throw new Error(`${project} has no Story issue type`);
      return story.id;
    });
    found.catch(() => storyTypes.delete(project));
    storyTypes.set(project, found);
    return found;
  };

  const write = (
    op: JiraOp,
    target: ItemId<"jira"> | null,
    args: unknown,
  ): Promise<WriteResult<"jira">> => {
    switch (op) {
      case "createStory":
        return createStory(valid(jiraOps.createStory, args, op));
      case "setSummary": {
        const { summary } = valid(jiraOps.setSummary, args, op);
        return edit(target, ["summary"], async (key) => put(key, { summary }));
      }
      case "setDescription": {
        const { description } = valid(jiraOps.setDescription, args, op);
        return edit(target, ["description"], async (key) =>
          put(key, { description: textToAdf(description) }),
        );
      }
      case "setEstimate": {
        const { points } = valid(jiraOps.setEstimate, args, op);
        return edit(target, ["points"], async (key) =>
          put(key, { [await requirePoints(projectOf(key))]: points }),
        );
      }
      case "setAssignee": {
        const { accountId } = valid(jiraOps.setAssignee, args, op);
        return edit(target, ["assignee"], async (key) => ({
          method: "PUT",
          path: `${api}/issue/${key}/assignee`,
          body: { accountId },
        }));
      }
      case "addLink":
        return addLink(target, valid(jiraOps.addLink, args, op));
      case "removeLink": {
        const { linkId } = valid(jiraOps.removeLink, args, op);
        if (!numericId(linkId).ok) throw new Error("removeLink: a link ID is a number");
        const name = linkField(linkId);
        return edit(target, [name], async (key, before) => {
          if (before[name] === null) throw new Error(`removeLink: ${key} has no link ${linkId}`);
          return { method: "DELETE", path: `${api}/issue/${key}/remotelink/${linkId}` };
        });
      }
      case "deleteItem":
        valid(jiraOps.deleteItem, args, op);
        return deleteItem(target);
    }
  };

  const addLink = async (
    target: ItemId<"jira"> | null,
    { url, title }: JiraArgs<"addLink">,
  ): Promise<WriteResult<"jira">> => {
    if (!webUrl(url)) throw new Error("addLink: the URL must be http or https");
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

  const deleteItem = async (target: ItemId<"jira"> | null): Promise<WriteResult<"jira">> => {
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
    apply: async (request) => {
      if (!isJiraOp(request.op)) throw new Error(`not a Jira operation: ${request.op}`);
      return write(request.op, request.target, request.args);
    },
    current: async (id, fields) => {
      const found = await values(keyOf(id), fields);
      return found === "gone" ? "gone" : found.values;
    },
  };
}
