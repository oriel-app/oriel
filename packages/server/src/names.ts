// What Oriel names a workstream, and when it names one again. A name the user gave
// a workstream is never changed (the workstream store's `rename` keeps it).
import {
  type IndexRecord,
  maxNameChars,
  parseItemId,
  type SourceKind,
  type Ulid,
} from "@oriel/core";
import type { WorkstreamStore } from "@oriel/db";

// A title as a workstream's name: trimmed, and cut to the longest name allowed.
export const nameOf = (title: string): string => [...title.trim()].slice(0, maxNameChars).join("");

// A workstream copied from a cluster takes its anchor's title as the index has it,
// so a workstream copied from an epic's cluster follows the epic when it's renamed
// in its source. Only while the workstream still holds the anchor, and only until
// the user names the workstream. Renaming takes no version, so what the workstream
// holds stays as it was. `rename` is the anchor's source's sync renaming it,
// through the dispatcher, so only a name that changes is renamed.
export async function followAnchors(
  workstreams: WorkstreamStore,
  workspaceId: Ulid,
  records: readonly IndexRecord[],
  rename: (workstream: Ulid, name: string, source: SourceKind) => Promise<unknown>,
): Promise<void> {
  const key = (id: string, stableId: string) => `${parseItemId(id)?.source}\u0000${stableId}`;
  const titles = new Map(records.map((record) => [key(record.id, record.stableId), record.title]));
  for (const workstream of workstreams.list(workspaceId)) {
    if (workstream.namedBy === "user" || workstream.origin.kind !== "cluster") continue;
    const region = workstreams.region(workstream.id, workstream.version);
    const anchor = region?.origin.kind === "cluster" ? region.origin.anchor : null;
    const source = anchor && parseItemId(anchor.id)?.source;
    const title = anchor && titles.get(key(anchor.id, anchor.stableId));
    const name = title ? nameOf(title) : "";
    if (source && name !== "" && name !== workstream.name)
      await rename(workstream.id, name, source);
  }
}
