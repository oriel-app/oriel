// The one description of a region's module. The declarations (`dts.ts`), the
// guest stubs (`shim.ts`) and the host side (`bindings.ts`) are all generated
// from the list `describe` returns, so they can't disagree about what exists.
//
// The module has `items.*` for every item in the region, whatever its source;
// a namespace for each source whose adapter declares one (a writable source:
// its read helpers and a write per op it lets a run capture) and that the
// region holds items from; and `search()`. A source without a namespace still
// gets `items.*` (decision 0019). The composition root passes the
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
import { checkedId, type Fn } from "./fn.ts";
import { itemFns, searchFn } from "./items.ts";

export type { Fn } from "./fn.ts";
export { pathOf } from "./fn.ts";

// Each source's namespace, as its adapter declares it.
export type Namespaces = Partial<Record<SourceKind, NamespaceSpec>>;

// The names the script sees. The list is fixed, whatever the region holds,
// because the guest compiles the script before it knows the region: a
// namespace the region has no functions in is empty, and the declarations
// don't name it. Namespaces are read-only globals a script may shadow, so a
// script can still name its own `items` or `folder`; the global functions
// are parameters of the script's function, which it can't redeclare.
export const spaceNames = ["items", ...sourceKinds] as const;
export const globals = [...spaceNames, "search"] as const;
export const parameters: readonly string[] = ["search"];

// A region as the module sees it: its IDs, sorted, and each source namespace
// it gets, with the items that namespace binds.
export type Scope = {
  ids: readonly ItemId[];
  sources: { kind: SourceKind; spec: NamespaceSpec; scope: NamespaceScope }[];
};

// IDs reach generated code, so each must have its source's strict key shape.
export function scopeOf(region: Region, namespaces: Namespaces): Scope {
  const names: Partial<Record<SourceKind, string>> = {};
  for (const kind of sourceKinds) names[kind] = namespaces[kind]?.name;
  const ids: ItemId[] = [];
  for (const { id } of region.items) {
    const checked = checkedId(id, names);
    if (!ids.includes(checked)) ids.push(checked);
  }
  ids.sort(byItemId);
  const anchor = region.origin.kind === "cluster" ? region.origin.anchor : null;
  if (anchor !== null && !ids.includes(anchor))
    throw new RangeError(`the region's anchor ${anchor} isn't one of its items`);
  const sources = sourceKinds.flatMap((kind) => {
    const spec = namespaces[kind];
    const members = ids.filter((id) => parseItemId(id)?.source === kind);
    if (!spec || !members.length) return [];
    const own = anchor !== null && members.includes(anchor) ? anchor : null;
    return [{ kind, spec, scope: { ids: members, anchor: own } }];
  });
  return { ids, sources };
}

// `items`, then each namespace in source order, then the escape hatch. The
// order is the order of the declarations, so it is part of the byte-stable
// output. A namespace's write must name an op in its catalogue that a run may
// capture; revert-only ops are never offered.
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
  return [...itemFns, ...namespaced, searchFn];
}
