// The one description of a region's module. The declarations (`dts.ts`), the
// guest stubs (`shim.ts`) and the host side (`bindings.ts`) are all generated
// from the list `describe` returns, so they can't disagree about what exists.
//
// The module has `items.*` for every item in the region, whatever its source;
// a namespace for each source whose adapter declares one (a writable source:
// its read helpers and a write per op it lets a run capture) and that the
// region holds items from; Oriel's own namespaces, `workstream` and
// `thread`, the same in every region (decision 0024); and `search()`. A
// source without a namespace still gets `items.*` (decision 0019). The composition root passes the
// namespaces in; bindings know no source.
import {
  byItemId,
  type ItemId,
  type NamespaceScope,
  type NamespaceSpec,
  parseItemId,
  type Region,
  type SourceKind,
  sourceKinds,
} from "@oriel/core";
import { checkedId, type Fn, orielSpaces } from "./fn.ts";
import { itemFns, searchFn } from "./items.ts";
import { orielFns } from "./oriel.ts";

export type { Fn } from "./fn.ts";
export { pathOf } from "./fn.ts";

// Each source's namespace, as its adapter declares it.
export type Namespaces = Partial<Record<SourceKind, NamespaceSpec>>;

// What each source's items are, as `items.*` reads them, as its adapter
// declares it: one line on what kind of item it is, what its title and text
// hold, and how to name it to the user. Shape only, never source text. The
// declarations hold a source's line only when the region holds its items, so
// a source costs a region without them nothing.
export type ItemDocs = Partial<Record<SourceKind, string>>;

// The names the script sees. The list is fixed, whatever the region holds,
// because the guest compiles the script before it knows the region: a
// namespace the region has no functions in is empty, and the declarations
// don't name it. Namespaces are read-only globals a script may shadow, so a
// script can still name its own `items` or `folder`; the global functions
// are parameters of the script's function, which it can't redeclare.
export const spaceNames = ["items", ...sourceKinds, ...orielSpaces] as const;
export const globals = [...spaceNames, "search"] as const;
export const parameters: readonly string[] = ["search"];

// A region as the module sees it: its IDs, sorted, the item docs of the
// sources it holds items from, and each source namespace it gets, with the
// items that namespace binds.
export type Scope = {
  ids: readonly ItemId[];
  docs: readonly string[];
  sources: { kind: SourceKind; spec: NamespaceSpec; scope: NamespaceScope }[];
};

// A doc goes inside a doc comment, on one line.
function checkedDoc(kind: SourceKind, doc: string): void {
  if (!doc.trim() || /[\r\n\u2028\u2029]|\*\//.test(doc))
    throw new Error(`${kind}: an item doc is one line of plain text, with no */`);
}

// IDs reach generated code, so each must have its source's strict key shape.
export function scopeOf(region: Region, namespaces: Namespaces, items: ItemDocs = {}): Scope {
  const names: Partial<Record<SourceKind, string>> = {};
  for (const kind of sourceKinds) names[kind] = namespaces[kind]?.name;
  const ids: ItemId[] = [];
  for (const { id } of region.items) {
    const checked = checkedId(id, names);
    if (!ids.includes(checked)) ids.push(checked);
  }
  ids.sort(byItemId);
  // A region whose anchor has left it is a region without one.
  const named = region.origin.kind === "cluster" ? region.origin.anchor : null;
  // By source and stable ID, under the handle the region has for it.
  const held =
    named &&
    region.items.find(
      (item) =>
        item.stableId === named.stableId &&
        parseItemId(item.id)?.source === parseItemId(named.id)?.source,
    );
  const anchor = held && ids.includes(held.id) ? held.id : null;
  const docs = sourceKinds.flatMap((kind) => {
    const doc = items[kind];
    if (doc === undefined) return [];
    checkedDoc(kind, doc);
    return ids.some((id) => parseItemId(id)?.source === kind) ? [doc] : [];
  });
  const sources = sourceKinds.flatMap((kind) => {
    const spec = namespaces[kind];
    const members = ids.filter((id) => parseItemId(id)?.source === kind);
    // A region with no items yet gets the namespaces that can start one.
    if (!spec || (!members.length && (ids.length || !spec.blank))) return [];
    const own = anchor !== null && members.includes(anchor) ? anchor : null;
    return [{ kind, spec, scope: { ids: members, anchor: own } }];
  });
  return { ids, docs, sources };
}

// `items`, then each namespace in source order, then Oriel's own, then the
// escape hatch. The order is the order of the declarations, so it is part of
// the byte-stable output. A namespace's write must name an op in its
// catalogue that a run may capture; revert-only ops are never offered.
export function describe(scope: Scope): Fn[] {
  const namespaced = scope.sources.flatMap(({ kind, spec, scope: own }) =>
    spec.fns(own).map((fn): Fn => {
      if (fn.kind === "read") return { ...fn, space: kind, outsideRegion: false };
      const entry = Object.hasOwn(spec.ops, fn.op) ? spec.ops[fn.op] : undefined;
      if (!entry || entry.revertOnly)
        throw new Error(`${kind}.${fn.name}: ${fn.op} isn't an op a run may capture`);
      return { ...fn, space: kind, spec: entry };
    }),
  );
  return [...itemFns, ...namespaced, ...orielFns, searchFn];
}
