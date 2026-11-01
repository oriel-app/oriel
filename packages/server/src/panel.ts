// The panel beside the page: one item, read live through the reader the
// agent's `items.read` uses, so both see the same item, in its source's own
// view (each source's declaration says how). A thin read: it changes nothing.
import {
  type IndexRecord,
  type Instant,
  type ItemId,
  parseItemId,
  type Reader,
  type SourceDeclaration,
  type SourceKind,
} from "@oriel/core";
import type { ItemPanelView, ItemStampView } from "@oriel/web/view";
import { webUrl } from "./views.ts";

export type PanelDeps = {
  reader: Pick<Reader, "read">;
  // The index's live records, from every source.
  records: () => readonly IndexRecord[];
  sources: Readonly<Record<SourceKind, Pick<SourceDeclaration, "name" | "panel">>>;
  now: () => Instant;
};

export type ItemPanels = {
  // Throws when the source can't be reached; a missing item is a view.
  read(id: ItemId): Promise<ItemPanelView>;
  stamp(id: ItemId): ItemStampView;
};

export function itemPanels(deps: PanelDeps): ItemPanels {
  const recordOf = (id: string) => deps.records().find((record) => record.id === id);
  return {
    async read(id) {
      const parsed = parseItemId(id);
      if (!parsed) throw new Error(`not an item ID: ${id}`);
      const source = deps.sources[parsed.source];
      const [result] = await deps.reader.read([id]);
      const readAt = deps.now();
      const record = recordOf(id);
      const base = {
        id,
        key: parsed.key,
        source: source.name,
        title: record?.title ?? null,
        url: record ? webUrl(record.location) : null,
        readAt,
        updatedAt: record?.updatedAt ?? null,
      };
      if (!result || result.status === "gone")
        return { ...base, read: { status: "gone", reason: result?.reason ?? "forbidden" } };
      if (result.status === "moved") {
        const moved = recordOf(result.to);
        return {
          ...base,
          read: {
            status: "moved",
            to: {
              id: result.to,
              key: parseItemId(result.to)?.key ?? result.to,
              title: moved?.title ?? null,
              url: moved ? webUrl(moved.location) : null,
            },
          },
        };
      }
      const shown = source.panel(result.content);
      const title = shown?.title ?? result.content.title;
      return {
        ...base,
        title: title.trim() === "" ? base.title : title,
        read: shown === null ? { status: "unreadable" } : { status: "ok", blocks: shown.blocks },
      };
    },
    stamp(id) {
      return { id, updatedAt: recordOf(id)?.updatedAt ?? null };
    },
  };
}
