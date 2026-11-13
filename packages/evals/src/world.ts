// Everything the agent sees must be the same on every run and disk, or cassettes won't replay.
// A fixture not on in every case connects only where one needs it, so older cases still replay.
import {
  type ItemDocs,
  type Namespaces,
  type Waiting,
  type WaitingOne,
  waitingOf,
} from "@oriel/bindings";
import {
  type ChangeLogEntry,
  type Cluster,
  type FixtureConnection,
  type FixtureRegion,
  type IndexRecord,
  type Instant,
  instant,
  type ItemId,
  parseItemId,
  type Reader,
  type ReadResult,
  type Region,
  type SearchHit,
  searchedOf,
  findThreads,
  noThreads,
  noOptionsYet,
  type OpenVia,
  OptionsUnfit,
  type OrielReads,
  readsNow,
  type SourceDeclaration,
  type ToOpen,
  type Ulid,
  ulid,
  type WorkstreamMember,
} from "@oriel/core";
import { searchOnly } from "@oriel/db";
import { historyRead } from "@oriel/server/history";
import { pastOf, pastWeeks } from "./past-weeks.ts";
import { overviewItems, overviewView } from "@oriel/server/overview";
import { groupings } from "@oriel/server/window";
import { byItemId } from "@oriel/sources";
import type { EvalCase, OrielWorkspace } from "./case.ts";
import { fixtureOf, type Fixtures, regionNamed } from "./fixtures.ts";
import { throughPreviews, throughServers } from "./through.ts";

export const fixedId: Ulid = ulid(0, new Uint8Array(10));

export type WorldInput = {
  fixtures: Fixtures;
  region: FixtureRegion | null;
  items: readonly ItemId[];
  edited: Readonly<Partial<Record<string, number>>>;
  oriel?: OrielWorkspace;
  window?: { workstreams: readonly { name: string; region: string }[]; now: Instant };
  unfit?: Readonly<Record<string, Record<string, unknown>>>;
  now?: Instant;
  past?: true;
  off?: readonly string[];
  servers?: readonly string[];
};

export function caseWorld(
  loaded: { case: EvalCase; region: FixtureRegion | null; items: readonly ItemId[] },
  fixtures: Fixtures,
  now: Instant,
): WorldInput {
  const { case: evalCase } = loaded;
  return {
    fixtures,
    region: loaded.region,
    items: loaded.items,
    edited: evalCase.edited ?? {},
    now,
    ...(evalCase.past ? { past: true as const } : {}),
    ...(evalCase.oriel ? { oriel: evalCase.oriel } : {}),
    ...(evalCase.window
      ? { window: { workstreams: evalCase.window.workstreams, now: evalCase.window.at ?? now } }
      : {}),
    ...(evalCase.unfit ? { unfit: evalCase.unfit } : {}),
    ...(evalCase.servers ? { servers: evalCase.servers } : {}),
    ...(evalCase.off ? { off: evalCase.off } : {}),
  };
}

export const waitingConnectionId = (kind: string): Ulid =>
  ulid(0, new Uint8Array(10).fill(kind.charCodeAt(0)));

export type World = {
  region: Region;
  reader: Reader;
  namespaces: Namespaces;
  items: ItemDocs;
  oriel: OrielReads;
  overview?: () => Promise<{ view: unknown; items: SearchHit[] }>;
  waiting?: Waiting;
  history: (of: string | null) => Promise<unknown>;
  evidence(): Promise<unknown[]>;
  close(): void;
};

export const member = (fixtures: Fixtures, id: ItemId): WorkstreamMember => ({
  id,
  stableId: fixtureOf(fixtures, id)?.stableId?.(id) ?? parseItemId(id)?.key ?? "",
});

export async function buildWorld(input: WorldInput): Promise<World> {
  const { fixtures } = input;
  const members = [...(input.region?.items ?? []), ...input.items].map((id) =>
    member(fixtures, id),
  );
  const region: Region = {
    workstreamId: fixedId,
    version: 1,
    workspaceId: fixedId,
    items: members,
    origin: input.window ? { kind: "window" } : (input.region?.origin ?? { kind: "picked" }),
  };
  const held = new Set(members.map((m) => parseItemId(m.id)?.kind));
  for (const kind of held)
    if (kind === undefined || !fixtures.has(kind))
      throw new Error(`the region holds ${kind ?? "unknown"} items, but no ${kind} fixture`);
  const off = new Set(input.off ?? []);
  const ownConnection = (declaration: SourceDeclaration) =>
    declaration.connect !== undefined || declaration.fixture.windowCase === true;
  const plain = (kind: string, declaration: SourceDeclaration) =>
    !off.has(kind) &&
    !declaration.standIn &&
    (declaration.fixture.everyCase === true ||
      held.has(kind) ||
      (input.window !== undefined &&
        (ownConnection(declaration) || (input.servers ?? []).includes(kind))));
  const connects = (kind: string, declaration: SourceDeclaration) =>
    declaration.standIn
      ? !off.has(kind) &&
        !declaration.standIn.for.some((other) => {
          const found = fixtures.get(other);
          return found !== undefined && plain(other, found.declaration);
        })
      : plain(kind, declaration);
  for (const kind of held) {
    const found = kind === undefined ? undefined : fixtures.get(kind);
    if (kind !== undefined && found && !connects(kind, found.declaration))
      throw new Error(`the region holds ${kind} items, but the case doesn't connect ${kind}`);
  }
  const connections = new Map<string, FixtureConnection>();
  try {
    for (const [kind, { loaded, declaration }] of fixtures)
      if (connects(kind, declaration)) {
        const plain = await loaded.connect(input.edited[kind] ?? 0);
        const through = input.servers?.includes(kind) ? throughServers[kind] : undefined;
        connections.set(kind, through ? await through(input.edited[kind] ?? 0, plain) : plain);
      }
  } catch (error) {
    for (const connection of connections.values()) connection.close();
    throw error;
  }
  const records = [...connections.values()].flatMap((c) => c.records);
  const namespaces: Namespaces = Object.fromEntries(
    [...connections].flatMap(([kind, connection]) => {
      const namespace = fixtures.get(kind)?.declaration.namespace;
      return namespace ? [[kind, namespace(records, connection.context as never)]] : [];
    }),
  );
  const items: ItemDocs = Object.fromEntries(
    [...fixtures].map(([kind, { declaration }]) => [kind, declaration.itemDoc]),
  );
  const texts = new Map([...connections.values()].flatMap((c) => [...c.texts]));
  let index: ReturnType<typeof searchOnly> | undefined;

  const reader: Reader = {
    async read(ids) {
      const read: ReadResult[] = [];
      for (const [kind, connection] of connections) {
        const own = ids.filter((id) => parseItemId(id)?.prefix === kind);
        if (own.length) read.push(...(await connection.read(own)));
      }
      const byId = new Map<string, ReadResult>(read.map((r) => [r.id, r]));
      return ids.map((id): ReadResult => byId.get(id) ?? { id, status: "gone", reason: "deleted" });
    },
    async search(query, limit) {
      index ??= searchOnly(records, texts);
      return index.search(query, limit).map(searchedOf);
    },
  };

  const window = input.window;
  const waiting = window
    ? await waitingIn(
        fixtures,
        input.unfit ?? {},
        window.now,
        [...connections.keys()],
        input.servers ?? [],
      )
    : null;
  return {
    region,
    reader,
    namespaces,
    items,
    oriel: orielOf(input.oriel),
    history: (of) => {
      const now = input.window?.now ?? input.now ?? instant(new Date(0));
      return historyRead({
        records: () => records,
        changes: () =>
          [
            ...(input.past ? pastChanges(records, now) : []),
            ...[...connections.values()].flatMap((connection) => connection.changes(now)),
          ].map((entry, i) => ({ ...entry, seq: i + 1 })),
        workstream: () => null,
        asOf: () => now,
      })(of);
    },
    ...(window
      ? { overview: async () => windowOverview(fixtures, connections, window, records) }
      : {}),
    ...(waiting ? { waiting } : {}),
    async evidence() {
      const results = await reader.read(members.map((m) => m.id));
      return results.map((result) => {
        const about = fixtureOf(fixtures, result.id)?.about?.(result.id) ?? {};
        if (result.status === "ok") return { id: result.id, ...about, ...result.content };
        if (result.status === "gone" && result.reason === "deleted")
          return { id: result.id, ...about, deleted: true };
        return {
          id: result.id,
          ...about,
          gone: result.status === "moved" ? "moved" : result.reason,
        };
      });
    },
    close: () => {
      for (const connection of connections.values()) connection.close();
      index?.close();
    },
  };
}

export function orielOf(workspace: OrielWorkspace | undefined): OrielReads {
  if (!workspace) return noThreads;
  const threads = workspace.threads
    .map(({ said: _said, ...thread }) => thread)
    .toSorted((a, b) => b.activityAt.localeCompare(a.activityAt));
  const said = new Map(workspace.threads.map((thread) => [thread.id, thread.said.join("\n")]));
  const sets = workspace.changeSets.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const workstreams = [...new Map(threads.map((t) => [t.workstream.id, t.workstream])).values()];
  return {
    workstreams: async () =>
      workstreams.map((workstream) => ({
        ...workstream,
        items: [],
        threads: threads.filter((t) => t.workstream.id === workstream.id).length,
        done: false,
      })),
    threads: async () => threads,
    changeSets: async (thread) => sets.filter((set) => thread === null || set.thread === thread),
    find: async (query, limit) =>
      findThreads(threads, (thread) => said.get(thread.id) ?? "", sets, query, limit),
  };
}

async function waitingIn(
  fixtures: Fixtures,
  unfit: Readonly<Record<string, Record<string, unknown>>>,
  now: Instant,
  connected: readonly string[],
  servers: readonly string[],
): Promise<Waiting | null> {
  const plainVia = { log: () => {}, now: () => now };
  const viaOf = (kind: string): OpenVia => {
    const through = servers.includes(kind) ? throughPreviews[kind] : undefined;
    return through ? { ...plainVia, server: through() } : plainVia;
  };
  const waiting = await Promise.all(
    Object.entries(unfit).map(async ([kind, options]) => {
      const declaration = fixtures.get(kind)?.declaration;
      if (!declaration) throw new Error(`no ${kind} fixture waits for its options`);
      const id = waitingConnectionId(kind);
      const connection = {
        ...declaration.fixture.connection(),
        id,
        number: 1,
        prefix: kind,
        options,
      };
      const why =
        !declaration.options(options).ok || declaration.review?.waits(options)
          ? noOptionsYet
          : await declaration.fixture.open(connection, plainVia).then(
              (opened) => {
                opened.close?.();
                throw new Error(`the ${kind} fixture opens with the case's options: they fit it`);
              },
              (error: unknown) =>
                error instanceof OptionsUnfit ? error.message : Promise.reject(error),
            );
      return waitingOne(declaration, connection, why, viaOf(kind));
    }),
  );
  const reading = connected.flatMap((kind) => {
    const declaration = fixtures.get(kind)?.declaration;
    if (!declaration?.review || !declaration.fixture.preview || kind in unfit) return [];
    const connection = {
      ...declaration.fixture.connection(),
      id: waitingConnectionId(kind),
      number: 1,
      prefix: kind,
    };
    return [waitingOne(declaration, connection, readsNow, viaOf(kind))];
  });
  return waitingOf([...waiting, ...reading]);
}

function waitingOne(
  declaration: SourceDeclaration,
  connection: ToOpen,
  why: string,
  via: OpenVia,
): WaitingOne {
  const { review } = declaration;
  return {
    id: connection.id,
    kind: declaration.kind,
    source: declaration.name,
    why,
    options: connection.options,
    validator: declaration.options,
    ...(review
      ? { draft: { validator: review.draft, doc: review.doc, current: review.current } }
      : {}),
    preview: async () =>
      (await (via.server
        ? declaration.preview?.(connection, via)
        : declaration.fixture.preview?.(connection, via))) ?? [],
  };
}

export const windowWorkstreamId = (now: Instant, i: number): Ulid =>
  ulid(Date.parse(now), new Uint8Array(10).fill(i + 1));

function windowOverview(
  fixtures: Fixtures,
  connections: ReadonlyMap<string, FixtureConnection>,
  window: NonNullable<WorldInput["window"]>,
  records: readonly IndexRecord[],
): { view: unknown; items: SearchHit[] } {
  const { now } = window;
  const changes: ChangeLogEntry[] = [...connections.values()]
    .flatMap((connection) => connection.changes(now))
    .map((entry, i) => ({ seq: i + 1, ...entry }));
  const workstreams = window.workstreams.map((workstream, i) => {
    const region = regionNamed(fixtures, workstream.region);
    if (!region) throw new Error(`no fixture region named ${workstream.region}`);
    return {
      id: windowWorkstreamId(now, i),
      name: workstream.name,
      createdAt: now,
      members: region.items.map((id) => member(fixtures, id)),
    };
  });
  const clustered = new Map<string, Cluster[]>();
  const view = overviewView({
    records,
    changes,
    seen: { at: lastLooked(fixtures) ?? now, seq: 0 },
    workstreams,
    threads: [],
    unopened: [],
    clusters: (grouping) => {
      const found = clustered.get(grouping) ?? groupings[grouping].group(records, now, byItemId);
      clustered.set(grouping, found);
      return found;
    },
    now,
  });
  const byId = new Map(records.map((record) => [record.id as string, record]));
  const items = overviewItems(view).flatMap((id) => {
    const record = byId.get(id);
    return record
      ? [
          {
            id: record.id,
            title: record.title,
            location: record.location,
            updatedAt: record.updatedAt,
          },
        ]
      : [];
  });
  return { view, items };
}

function lastLooked(fixtures: Fixtures): Instant | null {
  const first = [...fixtures.values()]
    .flatMap(({ loaded }) => (loaded.firstEdit ? [loaded.firstEdit] : []))
    .toSorted()[0];
  return first ? (new Date(Date.parse(first) - 1).toISOString() as Instant) : null;
}

function pastChanges(records: readonly IndexRecord[], now: Instant): Omit<ChangeLogEntry, "seq">[] {
  const byKey = new Map(
    records.flatMap((r) => (r.facets.state ? [[parseItemId(r.id)?.key ?? "", r]] : [])),
  );
  const { start, moves } = pastOf(
    [...byKey].map(([key, r]) => ({
      key,
      kind: r.facets.kind ?? null,
      state: r.facets.state ?? "todo",
      epic: r.facets.container ? (parseItemId(r.facets.container.id)?.key ?? null) : null,
    })),
  );
  const state = new Map(start);
  const week = 7 * 86_400_000;
  return [...moves]
    .toSorted(([a], [b]) => a - b)
    .flatMap(([k, list]) =>
      list.flatMap(([key, after]) => {
        const record = byKey.get(key);
        const before = state.get(key);
        state.set(key, after);
        if (!record || before === undefined || before === after) return [];
        return [
          {
            source: parseItemId(record.id)?.prefix ?? "",
            stableId: record.stableId,
            version: k + 1,
            at: instant(new Date(Date.parse(now) - (pastWeeks - k) * week - 86_400_000)),
            facets: { state: { before, after } },
            gone: false,
          },
        ];
      }),
    );
}
