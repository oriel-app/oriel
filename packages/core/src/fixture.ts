// A connector's synthetic data, as its declaration offers it (decision 0049):
// loaded once, then connected as often as a test or an eval case asks, with
// no network. Everything a connection gives is the same on every run and
// every disk, so evals that read it replay.
import type { PreviewTable } from "./block.ts";
import type { PreviewAsk } from "./connect.ts";
import type { ChangeLogEntry } from "./change-log.ts";
import type { Instant, ItemId } from "./ids.ts";
import type { Opened, OpenVia, ToOpen } from "./open.ts";
import { maxSearchText } from "./search.ts";
import type { IndexRecord, ReadResult, SyncPage } from "./source.ts";
import type { WorkstreamOrigin } from "./workstream.ts";

export type SourceFixture<C = unknown, R = unknown, W = unknown> = {
  // Reads its data, such as `fixtures/jira/`, and checks it.
  load: () => LoadedFixture<C>;
  // The connection the server makes for its fixture mode: what it
  // identifies and its options. It keeps no secret.
  connection: () => { identity: string; options: Record<string, unknown> };
  // Opens that connection over the fixture's stand-in for the source, as
  // `open` would the source itself. `via.fetch`, when a test gives one, is
  // a stand-in it made, so it can act in the source as others do.
  open: (connection: ToOpen, via: OpenVia) => Promise<Opened<C, R, W>>;
  // Opens a connection over an in-memory site of the source that a test, a
  // shot or a timing made, by its own `fetch`, read and written through
  // the source's own shapes as Oriel once read the source itself, with no
  // credential and no network (decision 0059). Absent where none is made.
  memory?: (connection: ToOpen, via: OpenVia & { fetch: typeof fetch }) => Promise<Opened<C, R, W>>;
  // Its declaration's preview over the same stand-in, for a connector that
  // declares one (decision 0051).
  preview?: (connection: ToOpen, via: OpenVia, ask?: PreviewAsk) => Promise<PreviewTable[]>;
  // Whether every eval case connects it, as every case recorded before
  // decision 0049 did Jira and the folder. Otherwise a case connects it when
  // its region holds its items, or when it asks in the window chat, so a new
  // connector changes no other case's recording.
  everyCase?: true;
  // Whether a window chat's case connects it unless the case turns it off,
  // as cases recorded while it had a connection of its own did (decision
  // 0059). Otherwise a window case connects it only where it says it's on
  // through its source server, as a person turns it on.
  windowCase?: true;
};

// A named set of a fixture's items, which an eval case's region or a window
// chat's workstream may hold, such as one of Jira's epics.
export type FixtureRegion = { name: string; origin: WorkstreamOrigin; items: ItemId[] };

export type LoadedFixture<C = unknown> = {
  // How many source edits it has: changes made in the source after the user
  // first looked, such as a renamed file, applied in order.
  edits: number;
  // When its first edit was made, if its edits are timed. The window chat's
  // user last looked just before.
  firstEdit: Instant | null;
  // Its named sets of items; none is `[]`.
  regions: readonly FixtureRegion[];
  // The item an eval case names `name`, such as a Jira key or a file's path,
  // or why a case can't hold it.
  item: (name: string) => { id: ItemId } | { problem: string };
  // An item's stable ID, as a workstream member keeps it. Absent: its key.
  stableId?: (id: ItemId) => string;
  // What a reply calls an item, such as a file's title or a message's
  // author, when not by its key; null when by its key.
  called?: (id: ItemId) => string | null;
  // Each item's chip as the window draws it, after the first `edited` edits:
  // its key or what it reads as, and its title.
  chips: (edited: number) => Iterable<readonly [ItemId, string]>;
  // What a judge is told of an item beyond what a read of it gives, such as
  // a file's path, which a deleted file's read can't give.
  about?: (id: ItemId) => Record<string, string>;
  // Connected, after the first `edited` edits.
  connect: (edited: number) => Promise<FixtureConnection<C>>;
};

export type FixtureConnection<C = unknown> = {
  // The index, as its sync leaves it: the records, and each one's text as
  // search keeps it, by item ID.
  records: readonly IndexRecord[];
  texts: ReadonlyMap<string, string>;
  // Reads its own items; any it doesn't have is gone.
  read: (ids: readonly ItemId[]) => Promise<ReadResult[]>;
  // What its namespace takes, as the composition root would give it.
  context: C;
  // What its edits changed, as a sync logs it, in no order; one whose time
  // the fixture doesn't keep was made at `now`.
  changes: (now: Instant) => Omit<ChangeLogEntry, "seq">[];
  // Removes anything it made, such as a temporary directory.
  close: () => void;
};

// A fixture's sync, as the index would keep it: every page's records, and
// each one's text as search keeps it, by item ID.
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
