// The one description of a region's module. The declarations (`dts.ts`), the
// guest stubs (`shim.ts`) and the host side (`bindings.ts`) are all generated
// from the list `describe` returns, so they can't disagree about what exists.
// Each parameter carries its TypeScript type, as the agent sees it, beside the
// validator the host checks the guest's value with.
import {
  type ItemId,
  isNewRef,
  type NewRef,
  nullable,
  number,
  object,
  optional,
  parseItemId,
  type Reader,
  type ReadResult,
  type Region,
  string,
  type Validator,
} from "@oriel/core";
import { type JiraContent, jiraContent, type JiraOp } from "@oriel/jira";

// The names the script sees, in the order the guest passes them to it. Each
// function lives in one: a namespace, or a global function of that name.
export const globals = ["jira", "search"] as const;

// Each region item's issue type, as the index has it (`JiraAttrs.issueType`).
// Only epics can parent a new story.
export type IssueTypes = ReadonlyMap<string, string>;

// A region as the module sees it: its IDs, sorted; the item it was opened on,
// if any; and the epics a new story may go in.
export type Scope = {
  ids: readonly ItemId<"jira">[];
  anchor: ItemId<"jira"> | null;
  epics: readonly ItemId<"jira">[];
};

const isJiraId = (id: string): id is ItemId<"jira"> => parseItemId(id)?.source === "jira";

function sortKey(id: ItemId<"jira">): [string, number] {
  const key = id.slice("jira:".length);
  const dash = key.lastIndexOf("-");
  return [key.slice(0, dash), Number(key.slice(dash + 1))];
}

// Project key, then issue number: a total order, since keys have no leading
// zeros, and the same in every locale.
function byKey(a: ItemId<"jira">, b: ItemId<"jira">): number {
  const [projectA, numberA] = sortKey(a);
  const [projectB, numberB] = sortKey(b);
  if (projectA === projectB) return numberA - numberB;
  return projectA < projectB ? -1 : 1;
}

// IDs reach generated code, so each must have its source's strict key shape.
export function scopeOf(region: Region, issueTypes: IssueTypes): Scope {
  const ids: ItemId<"jira">[] = [];
  for (const { id } of region.items) {
    if (!isJiraId(id)) throw new RangeError(`not a Jira item ID: ${JSON.stringify(id)}`);
    if (!ids.includes(id)) ids.push(id);
  }
  ids.sort(byKey);
  if (region.origin.kind !== "group" || region.origin.anchor === null)
    return { ids, anchor: null, epics: ids.filter((id) => issueTypes.get(id) === "Epic") };
  const { anchor } = region.origin;
  const member = ids.find((id) => id === anchor);
  if (!member) throw new RangeError(`the region's anchor ${anchor} isn't one of its items`);
  // A new story in a region opened on an epic always goes in that epic.
  return { ids, anchor: member, epics: [member] };
}

// Per-run host state.
export type Host = {
  reader: Reader;
  ids: readonly ItemId<"jira">[];
  has(id: string): id is ItemId<"jira">;
  // Refs from creates this run has captured.
  created: ReadonlySet<NewRef>;
};

export type Param<T> = { name: string; type: string; check: Validator<T>; optional: boolean };

type Values<P extends readonly Param<unknown>[]> = {
  -readonly [K in keyof P]: P[K] extends Param<infer T> ? T : never;
};

// `space` is the namespace the function lives in, or null for a global.
type Base = { space: "jira" | null; name: string; doc: string; params: readonly Param<unknown>[] };

export type ReadFn = Base & {
  kind: "read";
  // The TypeScript type the read resolves to.
  returns: string;
  outsideRegion: boolean;
  run(args: readonly unknown[], host: Host): Promise<unknown>;
};

export type WriteFn = Base & {
  kind: "write";
  op: JiraOp;
  // A create returns the new item's ref; other writes return nothing.
  creates: boolean;
  // The target and the op's arguments, before the op catalogue checks them.
  build(
    args: readonly unknown[],
    host: Host,
  ): { target: ItemId<"jira"> | NewRef | null; args: Record<string, unknown> };
};

export type Fn = ReadFn | WriteFn;

export const pathOf = (fn: Fn): string => (fn.space ? `${fn.space}.${fn.name}` : fn.name);

const param = <T>(name: string, type: string, check: Validator<T>): Param<T> => ({
  name,
  type,
  check,
  optional: false,
});

const optionalParam = <T>(name: string, type: string, check: Validator<T>) => ({
  name,
  type,
  check: optional(check),
  optional: true,
});

function checkArgs<P extends readonly Param<unknown>[]>(
  params: P,
  args: readonly unknown[],
): Values<P> {
  if (args.length > params.length)
    throw new TypeError(`expected at most ${params.length} arguments, got ${args.length}`);
  const values: unknown[] = [];
  const problems: string[] = [];
  params.forEach((p, i) => {
    const result = p.check(args[i], p.name);
    if (result.ok) values.push(result.value);
    else problems.push(...result.issues.map((issue) => `${issue.path}: ${issue.message}`));
  });
  if (problems.length) throw new TypeError(problems.join("; "));
  return values as Values<P>;
}

function read<const P extends readonly Param<unknown>[]>(
  spec: Omit<ReadFn, "kind" | "params" | "run"> & {
    params: P;
    run(values: Values<P>, host: Host): Promise<unknown>;
  },
): ReadFn {
  return {
    ...spec,
    kind: "read",
    run: (args, host) => spec.run(checkArgs(spec.params, args), host),
  };
}

function write<const P extends readonly Param<unknown>[]>(
  spec: Omit<WriteFn, "kind" | "params" | "build"> & {
    params: P;
    build(values: Values<P>, host: Host): ReturnType<WriteFn["build"]>;
  },
): WriteFn {
  return {
    ...spec,
    kind: "write",
    build: (args, host) => spec.build(checkArgs(spec.params, args), host),
  };
}

// The guest's view of a live read. Built field by field, so the value has
// exactly the shape `Item` declares and nothing the reader added.
type View = ReturnType<typeof item> | ReturnType<typeof gone>;

const item = (id: ItemId<"jira">, content: JiraContent) => ({
  id,
  gone: false,
  issueType: content.issueType,
  summary: content.summary,
  description: content.description,
  status: { name: content.status.name, category: content.status.category },
  epic: content.epic,
  assignee: content.assignee && {
    accountId: content.assignee.accountId,
    name: content.assignee.name,
  },
  points: content.points,
  labels: [...content.labels],
  comments: content.comments.map((c) => ({ author: c.author, body: c.body, at: c.at })),
  links: content.links.map((l) => ({ linkId: l.linkId, url: l.url, title: l.title })),
});

const gone = (id: ItemId<"jira">, reason: "deleted" | "forbidden" | "moved") => ({
  id,
  gone: true,
  reason,
});

// A Jira item's content as the guest sees it. A reader may sit behind any
// transport, so what it returns is checked here.
function jiraItem(id: ItemId<"jira">, content: unknown) {
  const parsed = jiraContent(content);
  if (!parsed.ok) throw new Error(`the source returned ${id} in a shape Oriel can't read`);
  return item(id, parsed.value);
}

async function answers(reader: Reader, ids: readonly ItemId[]) {
  const byId = new Map<string, ReadResult>(
    (await reader.read(ids)).map((result) => [result.id, result]),
  );
  return (id: ItemId) => {
    const result = byId.get(id);
    if (!result) throw new Error(`the source returned nothing for ${id}`);
    return result;
  };
}

// Reads region items live under their region handles. A missing item is a
// tombstone, never a throw. A moved item is followed once: its identity is the
// source's stable ID, so it is still the region's item.
async function live(reader: Reader, ids: readonly ItemId<"jira">[]): Promise<View[]> {
  if (!ids.length) return [];
  const first = await answers(reader, ids);
  const moves = ids.flatMap((id) => {
    const result = first(id);
    return result.status === "moved" ? [result.to] : [];
  });
  const second = moves.length ? await answers(reader, moves) : null;
  return ids.map((id) => {
    const result = first(id);
    if (result.status === "ok") return jiraItem(id, result.content);
    if (result.status === "gone") return gone(id, result.reason);
    const next = second?.(result.to);
    if (next?.status === "ok") return jiraItem(id, next.content);
    return gone(id, next?.status === "gone" ? next.reason : "moved");
  });
}

function writable(id: string, host: Host): ItemId<"jira"> | NewRef {
  if (host.has(id)) return id;
  if (isNewRef(id) && host.created.has(id)) return id;
  if (isNewRef(id)) throw new RangeError(`${id} isn't a story created earlier in this run`);
  throw new RangeError(
    `${JSON.stringify(id)} isn't in this region; writes take only its IDs and refs from createStory`,
  );
}

const outside = (id: string) =>
  new RangeError(`${JSON.stringify(id)} isn't in this region; use search() to look outside it`);

const getItem = read({
  space: "jira",
  name: "getItem",
  doc: "One item in this region, read live.",
  params: [param("id", "RegionId", string)],
  returns: "Item | Gone",
  outsideRegion: false,
  run: async ([id], host) => {
    if (!host.has(id)) throw outside(id);
    const [view] = await live(host.reader, [id]);
    return view;
  },
});

const listItems = read({
  space: "jira",
  name: "listItems",
  doc: "Every item in this region, read live, in RegionId order.",
  params: [],
  returns: "readonly (Item | Gone)[]",
  outsideRegion: false,
  run: (_, host) => live(host.reader, host.ids),
});

const getEpic = (epic: ItemId<"jira">) =>
  read({
    space: "jira",
    name: "getEpic",
    doc: `The epic this region was opened on, ${epic}, read live.`,
    params: [],
    returns: "Item | Gone",
    outsideRegion: false,
    run: async (_, host) => {
      const [view] = await live(host.reader, [epic]);
      return view;
    },
  });

const listStories = (epic: ItemId<"jira">) =>
  read({
    space: "jira",
    name: "listStories",
    doc: "This region's stories, read live: the epic's children when the region was made. One may since have moved epic or been deleted.",
    params: [],
    returns: "readonly (Item | Gone)[]",
    outsideRegion: false,
    run: (_, host) =>
      live(
        host.reader,
        host.ids.filter((id) => id !== epic),
      ),
  });

const searchFn = read({
  space: null,
  name: "search",
  doc: "The escape hatch: anything indexed, in this region or outside it, by key or title words. Results are read-only and can't be written.",
  params: [param("query", "string", string), optionalParam("limit", "number", number)],
  returns: "readonly Found[]",
  outsideRegion: true,
  run: async ([query, limit], host) => {
    const count = Math.min(Math.max(Math.trunc(limit ?? 20), 1), 50);
    const records = await host.reader.search(query, count);
    return records.slice(0, count).map((r) => ({
      id: r.id,
      title: r.title,
      location: r.location,
      updatedAt: r.updatedAt,
    }));
  },
});

// A new story's fields: each one's validator and its type as the agent sees
// it, under the same keys. A field is optional exactly when its validator
// takes undefined, so the declared `?` follows the validator.
const storyKeys = ["summary", "description", "points"] as const;
const storyFields = {
  summary: string,
  description: optional(string),
  points: optional(nullable(number)),
} satisfies Record<(typeof storyKeys)[number], Validator<unknown>>;
const storyTypes: Record<(typeof storyKeys)[number], string> = {
  summary: "string",
  description: "string",
  points: "number | null",
};
const epicField = optional(nullable(string));

const field = (key: string, check: Validator<unknown>, type: string) =>
  `${key}${check(undefined).ok ? "?" : ""}: ${type}`;

function storyType(withEpic: boolean): string {
  const fields = storyKeys.map((key) => field(key, storyFields[key], storyTypes[key]));
  if (withEpic) fields.push(field("epic", epicField, "EpicId | null"));
  return `{ ${fields.join("; ")} }`;
}

// In a region opened on an epic, a new story goes in that epic. Elsewhere it
// may go in one of the region's epics, by issue type at bind time, or in
// none; a region without epics doesn't offer the choice.
function createStory(scope: Scope): WriteFn {
  const doc = "Returns its ref, which later writes in this run can target.";
  const { anchor, epics } = scope;
  if (anchor)
    return write({
      space: "jira",
      name: "createStory",
      doc: `Create a story in this region's epic. ${doc}`,
      op: "createStory",
      creates: true,
      params: [param("story", storyType(false), object(storyFields))],
      // The epic is bound, whatever the guest sent.
      build: ([story]) => ({ target: null, args: { ...story, epic: anchor } }),
    });
  return write({
    space: "jira",
    name: "createStory",
    doc: epics.length
      ? `Create a story in one of this region's epics, or in none. ${doc}`
      : `Create a story. This region holds no epic, so it goes in none. ${doc}`,
    op: "createStory",
    creates: true,
    params: [
      param("story", storyType(epics.length > 0), object({ ...storyFields, epic: epicField })),
    ],
    build: ([story]) => {
      const parent = story.epic ?? null;
      if (parent !== null && !epics.some((epic) => epic === parent))
        throw new RangeError(`${JSON.stringify(parent)} isn't an epic in this region`);
      return { target: null, args: { ...story, epic: parent } };
    },
  });
}

const target = param("id", "Target", string);

const setSummary = write({
  space: "jira",
  name: "setSummary",
  doc: "Set an item's summary.",
  op: "setSummary",
  creates: false,
  params: [target, param("summary", "string", string)],
  build: ([id, summary], host) => ({ target: writable(id, host), args: { summary } }),
});

const setDescription = write({
  space: "jira",
  name: "setDescription",
  doc: "Replace an item's description, as plain text.",
  op: "setDescription",
  creates: false,
  params: [target, param("description", "string", string)],
  build: ([id, description], host) => ({ target: writable(id, host), args: { description } }),
});

const setEstimate = write({
  space: "jira",
  name: "setEstimate",
  doc: "Set an item's estimate in story points; null clears it.",
  op: "setEstimate",
  creates: false,
  params: [target, param("points", "number | null", nullable(number))],
  build: ([id, points], host) => ({ target: writable(id, host), args: { points } }),
});

const setAssignee = write({
  space: "jira",
  name: "setAssignee",
  doc: "Assign an item to a person by account ID, as an item's assignee shows it; null unassigns.",
  op: "setAssignee",
  creates: false,
  params: [target, param("accountId", "string | null", nullable(string))],
  build: ([id, accountId], host) => ({ target: writable(id, host), args: { accountId } }),
});

const addLink = write({
  space: "jira",
  name: "addLink",
  doc: "Attach a web link to an item.",
  op: "addLink",
  creates: false,
  params: [target, param("url", "string", string), param("title", "string", string)],
  build: ([id, url, title], host) => ({ target: writable(id, host), args: { url, title } }),
});

// Region reads, then writes, then the escape hatch. The order is the order of
// the declarations, so it is part of the byte-stable output. `removeLink` and
// `deleteItem` exist only as reverts and are never offered.
export function describe(scope: Scope): Fn[] {
  const epic = scope.anchor;
  return [
    ...(epic ? [getEpic(epic), listStories(epic)] : []),
    getItem,
    listItems,
    createStory(scope),
    setSummary,
    setDescription,
    setEstimate,
    setAssignee,
    addLink,
    searchFn,
  ];
}
