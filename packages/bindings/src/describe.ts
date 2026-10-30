// The one description of a region's module. The declarations (`dts.ts`), the
// guest stubs (`shim.ts`) and the host side (`bindings.ts`) are all generated
// from the list `describe` returns, so they can't disagree about what exists.
// Each parameter carries its TypeScript type, as the agent sees it, beside the
// validator the host checks the guest's value with.
//
// The module has `items.*` for every item in the region, whatever its source,
// a namespace for each writable source the region holds items from, built
// from that source's op catalogue and read helpers, and `search()`. A
// read-only source gets no namespace (decision 0019).
import type { ItemId, Region } from "@oriel/core";
import { byKey, checkedId, type Fn } from "./fn.ts";
import { itemFns, searchFn } from "./items.ts";
import { type IssueTypes, jiraFns, type JiraScope, jiraScope } from "./jira.ts";

export type { Fn } from "./fn.ts";
export { pathOf } from "./fn.ts";
export type { IssueTypes } from "./jira.ts";

// The names the script sees, in the order the guest passes them to it. Each
// function lives in one: a namespace, or a global function of that name. The
// list is fixed, whatever the region holds, because the guest compiles the
// script before it knows: a namespace the region has no items for is empty,
// and the declarations don't name it.
export const namespaces = ["items", "jira"] as const;
export const globals = [...namespaces, "search"] as const;

// The names the guest makes read-only globals rather than parameters of the
// script's function, so a script may shadow them: `items` is a likely name
// for a script's own variable. The rest are parameters, which a script can't
// redeclare.
export const shadowable: readonly string[] = ["items"];
export const parameters = globals.filter((name) => !shadowable.includes(name));

// A region as the module sees it: its IDs, sorted; and, when it holds Jira
// items, what the `jira` namespace binds.
export type Scope = {
  ids: readonly ItemId[];
  jira: JiraScope | null;
};

// IDs reach generated code, so each must have its source's strict key shape.
export function scopeOf(region: Region, issueTypes: IssueTypes): Scope {
  const ids: ItemId[] = [];
  for (const { id } of region.items) {
    const checked = checkedId(id);
    if (!ids.includes(checked)) ids.push(checked);
  }
  ids.sort(byKey);
  const anchor = region.origin.kind === "cluster" ? region.origin.anchor : null;
  if (anchor !== null && !ids.includes(anchor))
    throw new RangeError(`the region's anchor ${anchor} isn't one of its items`);
  return { ids, jira: jiraScope(ids, anchor, issueTypes) };
}

// `items`, then each namespace, then the escape hatch. The order is the order
// of the declarations, so it is part of the byte-stable output. `removeLink`
// and `deleteItem` exist only as reverts and are never offered.
export function describe(scope: Scope): Fn[] {
  return [...itemFns, ...(scope.jira ? jiraFns(scope.jira) : []), searchFn];
}
