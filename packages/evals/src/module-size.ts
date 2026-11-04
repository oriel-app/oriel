// What a connector adds to a region's module: its item doc, and its
// namespace as its fixture connects it, in a region holding one of its
// items, beside the base every region has. Its declaration's budget caps it
// (OA-26), and a test checks each declared connector's.
import { bindingsFor, type ItemDocs, type Namespaces } from "@oriel/bindings";
import { type ItemId, parseItemId, type Reader, type Region } from "@oriel/core";
import type { Fixture } from "./fixtures.ts";
import { fixedId } from "./world.ts";

// The module never reads.
const reader: Reader = { read: async () => [], search: async () => [] };

// A region holding these items.
export const regionOf = (ids: readonly ItemId[]): Region => ({
  workstreamId: fixedId,
  version: 1,
  workspaceId: fixedId,
  items: ids.map((id) => ({ id, stableId: parseItemId(id)?.key ?? "" })),
  origin: { kind: "picked" },
});

export const moduleOf = (ids: readonly ItemId[], namespaces: Namespaces, items: ItemDocs) =>
  bindingsFor(regionOf(ids), { reader, namespaces, items }).dts;

// Bytes without the ID lines, which grow with the region, not the source.
export const shape = (text: string) => text.replace(/^ {2}\| ".*$\n?/gm, "").length;

export type ModuleSize = {
  // The one of its fixture's items whose region it adds most to, as a
  // region of rows Oriel may change gets a namespace a spreadsheet's
  // doesn't.
  item: ItemId;
  // The module of a region holding it, with no namespace or item doc.
  base: number;
  // What its item doc and namespace add.
  added: number;
  namespaces: Namespaces;
  items: ItemDocs;
};

export async function moduleSize(
  kind: string,
  { declaration, loaded }: Fixture,
): Promise<ModuleSize> {
  const connection = await loaded.connect(0);
  try {
    const namespace = declaration.namespace?.(connection.records, connection.context as never);
    const namespaces: Namespaces = namespace ? { [kind]: namespace } : {};
    const items: ItemDocs = { [kind]: declaration.itemDoc };
    const sizes = connection.records.map(({ id }) => {
      const base = shape(moduleOf([id], {}, {}));
      return { item: id, base, added: shape(moduleOf([id], namespaces, items)) - base };
    });
    const most = sizes.reduce<(typeof sizes)[number] | undefined>(
      (best, size) => (best === undefined || size.added > best.added ? size : best),
      undefined,
    );
    if (most === undefined) throw new Error(`the ${kind} fixture has no items`);
    return { ...most, namespaces, items };
  } finally {
    connection.close();
  }
}
