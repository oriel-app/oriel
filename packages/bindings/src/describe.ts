// The declarations, the guest stubs and the host side are all generated from this list, so they can't disagree.
import {
  type ItemId,
  itemOrder,
  type NamespaceScope,
  type NamespaceSpec,
  parseItemId,
  type Region,
  type SourceKind,
} from "@oriel/core";
import { intentFns, windowIntentFns } from "./actions.ts";
import { checkedId, type Fn, orielSpaces } from "./fn.ts";
import { challengeItemFns, itemFns, lookedItemFns, searchFn } from "./items.ts";
import { orielFns } from "./oriel.ts";
import { showFn } from "./block.ts";
import { historyFn } from "./history.ts";
import { sketchFn } from "./sketch.ts";
import { windowFns } from "./window.ts";
import { draftFns, previewFn, type Waiting } from "./drafts.ts";
import { challengeFns } from "./challenge.ts";

export type { Fn } from "./fn.ts";
export { pathOf } from "./fn.ts";

export type Namespaces = Partial<Record<SourceKind, NamespaceSpec>>;

// Shape only, never source text; declared only where the region holds the source's items.
export type ItemDocs = Partial<Record<SourceKind, string>>;

// Parameters of the script's function, which it can't redeclare.
export const parameters: readonly string[] = ["search", "history", "show", "sketch"];

// Oriel's own names in every module, which no source's kind may take.
export const orielNames: readonly string[] = [
  "items",
  ...orielSpaces,
  "window",
  "source",
  "challenge",
  ...parameters,
];

// Fixed, whatever the region holds: the guest compiles the script before it knows the region.
// Namespaces are read-only globals a script may shadow.
export const spacesOf = (kinds: readonly SourceKind[]): string[] => [
  "items",
  ...kinds,
  ...orielSpaces,
  "window",
  "source",
  "challenge",
];
export const globalsOf = (spaces: readonly string[]): string[] => [...spaces, ...parameters];

export type Scope = {
  spaces: readonly string[];
  ids: readonly ItemId[];
  looked: readonly ItemId[];
  docs: readonly string[];
  sources: { kind: SourceKind; spec: NamespaceSpec; scope: NamespaceScope }[];
};

// A doc goes inside a doc comment, on one line.
function checkedDoc(kind: SourceKind, doc: string): void {
  if (!doc.trim() || /[\r\n\u2028\u2029]|\*\//.test(doc))
    throw new Error(`${kind}: an item doc is one line of plain text, with no */`);
}

// IDs reach generated code, so each must have the shape core checks.
export function scopeOf(
  region: Region,
  namespaces: Namespaces,
  items: ItemDocs = {},
  looking: readonly string[] = [],
): Scope {
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
  const looked: ItemId[] = [];
  for (const id of looking) {
    const checked = checkedId(id, names);
    if (!ids.includes(checked) && !looked.includes(checked)) looked.push(checked);
  }
  looked.sort(itemOrder(kinds));
  const named = region.origin.kind === "cluster" ? region.origin.anchor : null;
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
  const sources = kinds.flatMap((kind) => {
    const spec = namespaces[kind];
    const members = ids.filter((id) => parseItemId(id)?.kind === kind);
    if (!spec || (!members.length && (ids.length || !spec.blank))) return [];
    const own = anchor !== null && members.includes(anchor) ? anchor : null;
    return [{ kind, spec, scope: { ids: members, anchor: own } }];
  });
  return { spaces: spacesOf(kinds), ids, looked, docs, sources };
}

// The order is the declarations' order, part of the byte-stable output. Revert-only ops are never offered.
// A second look's module has none of Oriel's namespaces, blocks or sketches: it may not act on Oriel's data.
export function describe(
  scope: Scope,
  options: { window?: boolean; waiting?: Waiting; challenge?: boolean } = {},
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
  if (options.challenge) return [...challengeItemFns, ...namespaced, ...challengeFns, searchFn];
  const window = options.window ? [...windowFns, ...draftFns(["window"]), ...windowIntentFns] : [];
  const waiting = options.waiting ? [previewFn, ...draftFns(["source"], options.waiting)] : [];
  return [
    ...(scope.looked.length ? lookedItemFns : itemFns),
    ...namespaced,
    ...orielFns,
    ...intentFns,
    ...window,
    ...waiting,
    searchFn,
    historyFn,
    showFn,
    sketchFn,
  ];
}
