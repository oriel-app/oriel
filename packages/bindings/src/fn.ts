// What a region's module is described with: functions in namespaces, and the
// host state a run gives them. Core's `NamespaceSpec` describes a source's
// namespace; this adds where each function lives and what the host knows.
import {
  type ItemId,
  type NamespaceHost,
  type NamespaceRead,
  type NamespaceWrite,
  parseItemId,
  type Reader,
  type ReadResult,
  type SearchHit,
  type SourceKind,
  sourceKinds,
  type Tombstone,
  type Validator,
} from "@oriel/core";

// Per-run host state: what a namespace's functions get, plus every item in
// the region and the index, for `items` and `search()`.
export type Host = NamespaceHost & {
  ids: readonly ItemId[];
  search(query: string, limit: number): Promise<SearchHit[]>;
};

// The namespace a function lives in: `items` for any item, one per source
// that declares one, or null for a global.
export type Space = "items" | SourceKind | null;

export type ReadFn = Omit<NamespaceRead, "run"> & {
  space: Space;
  outsideRegion: boolean;
  run(args: readonly unknown[], host: Host): Promise<unknown>;
};

export type WriteFn = NamespaceWrite & {
  space: Space;
  // The op's entry in its source's catalogue, which checks its arguments.
  spec: { args: Validator<unknown>; revertOnly: boolean };
};

export type Fn = ReadFn | WriteFn;

export const pathOf = (fn: Fn): string => (fn.space ? `${fn.space}.${fn.name}` : fn.name);

// IDs reach generated code, so each must have its source's strict key shape.
// `names` are the sources' names as a person knows them, where declared.
export function checkedId(id: string, names: Partial<Record<SourceKind, string>>): ItemId {
  const parsed = parseItemId(id);
  if (parsed) return id as ItemId;
  const source = sourceKinds.find((kind) => id.startsWith(`${kind}:`));
  const name = source ? (names[source] ?? source) : "known";
  throw new RangeError(`not a ${name} item ID: ${JSON.stringify(id)}`);
}

export const outside = (id: string) =>
  new RangeError(`${JSON.stringify(id)} isn't in this region; use search() to look outside it`);

const gone = (id: ItemId, reason: Tombstone["reason"]): Tombstone => ({ id, gone: true, reason });

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
): Promise<(V | Tombstone)[]> {
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
