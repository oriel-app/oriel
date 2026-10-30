// What a region's module is described with: functions, their parameters, and
// the host state a run gives them. `describe.ts` assembles the list; `items.ts`
// and each source's namespace fill it.
import {
  type ItemId,
  type NewRef,
  optional,
  parseItemId,
  type Reader,
  type ReadResult,
  type SourceKind,
  sourceKinds,
  type Validator,
} from "@oriel/core";

// Per-run host state.
export type Host = {
  reader: Reader;
  ids: readonly ItemId[];
  has(id: string): id is ItemId;
  // Refs from creates this run has captured.
  created: ReadonlySet<NewRef>;
};

export type Param<T> = { name: string; type: string; check: Validator<T>; optional: boolean };

type Values<P extends readonly Param<unknown>[]> = {
  -readonly [K in keyof P]: P[K] extends Param<infer T> ? T : never;
};

// The namespace a function lives in: `items` for any item, one per writable
// source, or null for a global.
export type Space = "items" | SourceKind | null;

type Base = { space: Space; name: string; doc: string; params: readonly Param<unknown>[] };

export type ReadFn = Base & {
  kind: "read";
  // The TypeScript type the read resolves to.
  returns: string;
  outsideRegion: boolean;
  run(args: readonly unknown[], host: Host): Promise<unknown>;
};

export type WriteFn = Base & {
  kind: "write";
  op: string;
  // The op's entry in its source's catalogue, which checks its arguments.
  spec: { args: Validator<unknown>; revertOnly: boolean };
  // A create returns the new item's ref; other writes return nothing.
  creates: boolean;
  // The target and the op's arguments, before the op catalogue checks them.
  build(
    args: readonly unknown[],
    host: Host,
  ): { target: ItemId | NewRef | null; args: Record<string, unknown> };
};

export type Fn = ReadFn | WriteFn;

export const pathOf = (fn: Fn): string => (fn.space ? `${fn.space}.${fn.name}` : fn.name);

export const param = <T>(name: string, type: string, check: Validator<T>): Param<T> => ({
  name,
  type,
  check,
  optional: false,
});

export const optionalParam = <T>(name: string, type: string, check: Validator<T>) => ({
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

export function read<const P extends readonly Param<unknown>[]>(
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

export function write<const P extends readonly Param<unknown>[]>(
  spec: Omit<WriteFn, "kind" | "params" | "build"> & {
    params: P;
    build(values: Values<P>, host: Host): ReturnType<WriteFn["build"]>;
  },
): WriteFn {
  if (spec.spec.revertOnly) throw new Error(`${spec.op} exists only as a revert`);
  return {
    ...spec,
    kind: "write",
    build: (args, host) => spec.build(checkArgs(spec.params, args), host),
  };
}

const sourceNames: Record<SourceKind, string> = { jira: "Jira", folder: "folder" };

// IDs reach generated code, so each must have its source's strict key shape.
export function checkedId(id: string): ItemId {
  const parsed = parseItemId(id);
  if (parsed) return id as ItemId;
  const source = sourceKinds.find((kind) => id.startsWith(`${kind}:`));
  throw new RangeError(
    `not a ${source ? sourceNames[source] : "known"} item ID: ${JSON.stringify(id)}`,
  );
}

// Source, then for Jira project key and issue number, and otherwise the key:
// a total order, since Jira keys have no leading zeros, and the same in every
// locale.
export function byKey(a: ItemId, b: ItemId): number {
  const [sourceA, groupA, numberA] = sortKey(a);
  const [sourceB, groupB, numberB] = sortKey(b);
  if (sourceA !== sourceB) return sourceA - sourceB;
  if (groupA !== groupB) return groupA < groupB ? -1 : 1;
  return numberA - numberB;
}

function sortKey(id: ItemId): [number, string, number] {
  const parsed = parseItemId(id);
  const source = parsed ? sourceKinds.indexOf(parsed.source) : sourceKinds.length;
  const key = parsed?.key ?? id;
  if (parsed?.source !== "jira") return [source, key, 0];
  const dash = key.lastIndexOf("-");
  return [source, key.slice(0, dash), Number(key.slice(dash + 1))];
}

// `type Name =` then one `| "id"` line per ID.
export function idUnion(name: string, ids: readonly string[]): string[] {
  if (!ids.length) return [`type ${name} = never;`];
  return [
    `type ${name} =`,
    ...ids.map((id, i) => `  | ${JSON.stringify(id)}${i === ids.length - 1 ? ";" : ""}`),
  ];
}

export const outside = (id: string) =>
  new RangeError(`${JSON.stringify(id)} isn't in this region; use search() to look outside it`);

// An item that can't be read any more.
export type GoneView = { id: ItemId; gone: true; reason: "deleted" | "forbidden" | "moved" };

const gone = (id: ItemId, reason: GoneView["reason"]): GoneView => ({ id, gone: true, reason });

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

// Reads region items live under their region handles, each shaped by `view`.
// A missing item is a tombstone, never a throw. A moved item is followed once:
// its identity is the source's stable ID, so it is still the region's item.
export async function live<V>(
  reader: Reader,
  ids: readonly ItemId[],
  view: (id: ItemId, content: unknown) => V,
): Promise<(V | GoneView)[]> {
  if (!ids.length) return [];
  const first = await answers(reader, ids);
  const moves = ids.flatMap((id) => {
    const result = first(id);
    return result.status === "moved" ? [result.to] : [];
  });
  const second = moves.length ? await answers(reader, moves) : null;
  return ids.map((id) => {
    const result = first(id);
    if (result.status === "ok") return view(id, result.content);
    if (result.status === "gone") return gone(id, result.reason);
    const next = second?.(result.to);
    if (next?.status === "ok") return view(id, next.content);
    return gone(id, next?.status === "gone" ? next.reason : "moved");
  });
}
