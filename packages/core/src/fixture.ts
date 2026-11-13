// The same on every run and every disk, so evals that read it replay.
import type { PreviewTable } from "./block.ts";
import type { PreviewAsk } from "./connect.ts";
import type { ChangeLogEntry } from "./change-log.ts";
import type { Instant, ItemId } from "./ids.ts";
import type { Opened, OpenVia, ToOpen } from "./open.ts";
import { maxSearchText } from "./search.ts";
import type { IndexRecord, ReadResult, SyncPage } from "./source.ts";
import type { WorkstreamOrigin } from "./workstream.ts";

export type SourceFixture<C = unknown, R = unknown, W = unknown> = {
  load: () => LoadedFixture<C>;
  connection: () => { identity: string; options: Record<string, unknown> };
  open: (connection: ToOpen, via: OpenVia) => Promise<Opened<C, R, W>>;
  memory?: (connection: ToOpen, via: OpenVia & { fetch: typeof fetch }) => Promise<Opened<C, R, W>>;
  preview?: (connection: ToOpen, via: OpenVia, ask?: PreviewAsk) => Promise<PreviewTable[]>;
  // Otherwise a case connects it only where it needs it, so a new connector changes no other case's recording.
  everyCase?: true;
  windowCase?: true;
};

export type FixtureRegion = { name: string; origin: WorkstreamOrigin; items: ItemId[] };

export type LoadedFixture<C = unknown> = {
  edits: number;
  firstEdit: Instant | null;
  regions: readonly FixtureRegion[];
  item: (name: string) => { id: ItemId } | { problem: string };
  stableId?: (id: ItemId) => string;
  called?: (id: ItemId) => string | null;
  chips: (edited: number) => Iterable<readonly [ItemId, string]>;
  about?: (id: ItemId) => Record<string, string>;
  connect: (edited: number) => Promise<FixtureConnection<C>>;
};

export type FixtureConnection<C = unknown> = {
  records: readonly IndexRecord[];
  texts: ReadonlyMap<string, string>;
  read: (ids: readonly ItemId[]) => Promise<ReadResult[]>;
  context: C;
  changes: (now: Instant) => Omit<ChangeLogEntry, "seq">[];
  close: () => void;
};

export async function listed<R extends IndexRecord>(
  pages: AsyncIterable<SyncPage & { records: R[] }>,
): Promise<{ records: R[]; texts: Map<string, string> }> {
  const records: R[] = [];
  const texts = new Map<string, string>();
  for await (const page of pages)
    for (const record of page.records) {
      records.push(record);
      const text = page.texts?.[record.stableId];
      if (text !== undefined) texts.set(record.id, text.slice(0, maxSearchText));
    }
  return { records, texts };
}
