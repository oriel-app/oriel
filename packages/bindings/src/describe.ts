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
  type ItemId,
  itemOrder,
  type NamespaceScope,
  type NamespaceSpec,
  parseItemId,
  type Region,
  type SourceKind,
} from "@oriel/core";
import { intentFns } from "./actions.ts";
import { checkedId, type Fn, orielSpaces } from "./fn.ts";
import { itemFns, searchFn } from "./items.ts";
import { orielFns } from "./oriel.ts";
import { showFn } from "./block.ts";
import { sketchFn } from "./sketch.ts";
import { slicesFn } from "./slices.ts";
import { windowFns } from "./window.ts";
import { draftFns, previewFn, type Waiting } from "./drafts.ts";

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

// The global functions, parameters of the script's function, which it
// can't redeclare.
export const parameters: readonly string[] = ["search", "show", "sketch", "slices"];

// Oriel's own names in every module, which no source's kind may take
// (decision 0049).
export const orielNames: readonly string[] = [
  "items",
  ...orielSpaces,
  "window",
  "source",
  ...parameters,
];

// The names the script sees: `items`, a namespace per kind, Oriel's own,
// then the global functions. The list is fixed, whatever the region holds,
// because the guest compiles the script before it knows the region: a
// namespace the region has no functions in is empty, and the declarations
// don't name it. The kinds are every source the composition root declares,
// so it is fixed for the life of the server. Namespaces are read-only
// globals a script may shadow, so a script can still name its own `items`
// or `folder`.
export const spacesOf = (kinds: readonly SourceKind[]): string[] => [
  "items",
  ...kinds,
  ...orielSpaces,
  "window",
  "source",
];
export const globalsOf = (spaces: readonly string[]): string[] => [...spaces, ...parameters];

// A region as the module sees it: every name the script sees, its IDs,
// sorted, the item docs of the sources it holds items from, and each source
// namespace it gets, with the items that namespace binds.
export type Scope = {
  spaces: readonly string[];
  ids: readonly ItemId[];
  docs: readonly string[];
  sources: { kind: SourceKind; spec: NamespaceSpec; scope: NamespaceScope }[];
};

// A doc goes inside a doc comment, on one line.
function checkedDoc(kind: SourceKind, doc: string): void {
  if (!doc.trim() || /[\r\n\u2028\u2029]|\*\//.test(doc))
    throw new Error(`${kind}: an item doc is one line of plain text, with no */`);
}

// IDs reach generated code, so each must have the shape core checks. The
// kinds are those the item docs and namespaces are given under, in that
// order.
export function scopeOf(region: Region, namespaces: Namespaces, items: ItemDocs = {}): Scope {
  const kinds = [...new Set([...Object.keys(items), ...Object.keys(namespaces)])];
  const taken = kinds.find((kind) => orielNames.includes(kind));
  if (taken !== undefined)
    throw new Error(`${taken}: a source can't take one of Oriel's own names`);
  const names: Partial<Record<SourceKind, string>> = {};
  for (const kind of kinds) names[kind] = namespaces[kind]?.name;
  const ids: ItemId[] = [];
  for (const { id } of region.items) {
    const checked = checkedId(id, names);
    if (!ids.includes(checked)) ids.push(checked);
  }
  ids.sort(itemOrder(kinds));
  // A region whose anchor has left it is a region without one.
  const named = region.origin.kind === "cluster" ? region.origin.anchor : null;
  // By source and stable ID, under the handle the region has for it.
  const held =
    named &&
    region.items.find(
      (item) =>
        item.stableId === named.stableId &&
        parseItemId(item.id)?.prefix === parseItemId(named.id)?.prefix,
    );
  const anchor = held && ids.includes(held.id) ? held.id : null;
  const docs = kinds.flatMap((kind) => {
    const doc = items[kind];
    if (doc === undefined) return [];
    checkedDoc(kind, doc);
    return ids.some((id) => parseItemId(id)?.kind === kind) ? [doc] : [];
  });
  // A namespace is per kind: it binds the kind's items from every connection.
  const sources = kinds.flatMap((kind) => {
    const spec = namespaces[kind];
    const members = ids.filter((id) => parseItemId(id)?.kind === kind);
    // A region with no items yet gets the namespaces that can start one.
    if (!spec || (!members.length && (ids.length || !spec.blank))) return [];
    const own = anchor !== null && members.includes(anchor) ? anchor : null;
    return [{ kind, spec, scope: { ids: members, anchor: own } }];
  });
  return { spaces: spacesOf(kinds), ids, docs, sources };
}

// `items`, then each namespace in source order, then Oriel's own (its reads,
// then its actions, in registry order), the window chat's `window` if the
// thread is one, and `source` while a connection waits for its options
// (decision 0051), then the escape hatch, blocks and sketches. The order is
// the order of the declarations, so it is part of the byte-stable output. A
// namespace's write must name an op in its catalogue that a run may capture;
// revert-only ops are never offered.
export function describe(
  scope: Scope,
  options: { window?: boolean; waiting?: Waiting } = {},
): Fn[] {
  const namespaced = scope.sources.flatMap(({ kind, spec, scope: own }) =>
    spec.fns(own).map((fn): Fn => {
      if (fn.kind === "read") return { ...fn, space: kind, outsideRegion: false };
      const entry = Object.hasOwn(spec.ops, fn.op) ? spec.ops[fn.op] : undefined;
      if (!entry || entry.revertOnly)
        throw new Error(`${kind}.${fn.name}: ${fn.op} isn't an op a run may capture`);
      return { ...fn, space: kind, spec: entry };
    }),
  );
  const window = options.window ? windowFns : [];
  const waiting = options.waiting ? [previewFn, ...draftFns(options.waiting)] : [];
  return [
    ...itemFns,
    ...namespaced,
    ...orielFns,
    ...intentFns,
    ...window,
    ...waiting,
    searchFn,
    showFn,
    sketchFn,
    slicesFn,
  ];
}
