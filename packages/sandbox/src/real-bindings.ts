// Real bindings from @oriel/bindings over a two-story region whose reader has
// nothing: a fixture, so the escape tests run the production shim and
// typecheck rather than a stand-in.
import { bindingsFor } from "@oriel/bindings";
import { type Bindings, type ItemId, type Region, ulid } from "@oriel/core";

const ids: ItemId<"jira">[] = ["jira:SYN-1", "jira:SYN-2"];
const fixedId = ulid(0, new Uint8Array(10));

export function regionBindings(): Bindings {
  const region: Region = {
    groupId: fixedId,
    version: 1,
    workspaceId: fixedId,
    items: ids.map((id, i) => ({ id, stableId: String(10001 + i) })),
    origin: { kind: "picked" },
  };
  return bindingsFor(region, {
    reader: {
      read: async (wanted) => wanted.map((id) => ({ id, status: "gone", reason: "deleted" })),
      search: async () => [],
    },
    // No source namespace: the escape tests need the shim and the typecheck,
    // not a source's functions, and only test support may name an adapter.
    namespaces: {},
  });
}
