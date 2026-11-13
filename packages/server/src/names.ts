import {
  type IndexRecord,
  maxNameChars,
  parseItemId,
  type SourceKind,
  type Ulid,
} from "@oriel/core";
import type { WorkstreamStore } from "@oriel/db";

export const nameOf = (title: string): string => [...title.trim()].slice(0, maxNameChars).join("");

// Only while the workstream still holds the anchor, and only until the user names the workstream.
export async function followAnchors(
  workstreams: WorkstreamStore,
  workspaceId: Ulid,
  records: readonly IndexRecord[],
  rename: (workstream: Ulid, name: string, source: SourceKind) => Promise<unknown>,
): Promise<void> {
  const key = (id: string, stableId: string) => `${parseItemId(id)?.prefix}\u0000${stableId}`;
  const titles = new Map(records.map((record) => [key(record.id, record.stableId), record.title]));
  for (const workstream of workstreams.list(workspaceId)) {
    if (workstream.namedBy === "user" || workstream.origin.kind !== "cluster") continue;
    const region = workstreams.region(workstream.id, workstream.version);
    const anchor = region?.origin.kind === "cluster" ? region.origin.anchor : null;
    const source = anchor && parseItemId(anchor.id)?.prefix;
    const title = anchor && titles.get(key(anchor.id, anchor.stableId));
    const name = title ? nameOf(title) : "";
    if (source && name !== "" && name !== workstream.name)
      await rename(workstream.id, name, source);
  }
}
