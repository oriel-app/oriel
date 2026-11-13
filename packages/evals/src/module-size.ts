import { bindingsFor, type ItemDocs, type Namespaces } from "@oriel/bindings";
import { type ItemId, parseItemId, type Reader, type Region } from "@oriel/core";
import type { Fixture } from "./fixtures.ts";
import { fixedId } from "./world.ts";

const reader: Reader = { read: async () => [], search: async () => [] };

export const regionOf = (ids: readonly ItemId[]): Region => ({
  workstreamId: fixedId,
  version: 1,
  workspaceId: fixedId,
  items: ids.map((id) => ({ id, stableId: parseItemId(id)?.key ?? "" })),
  origin: { kind: "picked" },
});

export const moduleOf = (ids: readonly ItemId[], namespaces: Namespaces, items: ItemDocs) =>
  bindingsFor(regionOf(ids), { reader, namespaces, items }).dts;

export const shape = (text: string) => text.replace(/^ {2}\| ".*$\n?/gm, "").length;

export type ModuleSize = {
  item: ItemId;
  base: number;
  added: number;
  namespaces: Namespaces;
  items: ItemDocs;
};

export async function moduleSize(
  kind: string,
  { declaration, loaded }: Fixture,
): Promise<ModuleSize> {
  const first = await loaded.connect(0);
  const connection =
    first.records.length > 0 || loaded.edits === 0
      ? first
      : (first.close(), await loaded.connect(loaded.edits));
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
