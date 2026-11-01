// Test support: real bindings from @oriel/bindings over a two-story region
// whose reader has nothing, with Jira's production namespace, so the escape
// tests run the production shim, stubs and typecheck rather than a stand-in.
import { bindingsFor } from "@oriel/bindings";
import { type Bindings, type ItemId, type Region, ulid } from "@oriel/core";
import { jiraNamespace } from "@oriel/jira";

const ids: ItemId<"jira">[] = ["jira:SYN-1", "jira:SYN-2"];
const fixedId = ulid(0, new Uint8Array(10));

export function regionBindings(): Bindings {
  const region: Region = {
    workstreamId: fixedId,
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
    namespaces: { jira: jiraNamespace(new Map(ids.map((id) => [id, "story"]))) },
  });
}
