// What Oriel names a group, and when it names one again. A name the user gave
// a group is never changed (the group store's `rename` keeps it).
import { type IndexRecord, maxNameChars, parseItemId, type Ulid } from "@oriel/core";
import type { GroupStore } from "@oriel/db";

// A title as a group's name: trimmed, and cut to the longest name allowed.
export const nameOf = (title: string): string => [...title.trim()].slice(0, maxNameChars).join("");

// A group copied from a cluster takes its anchor's title as the index has it,
// so a group copied from an epic's cluster follows the epic when it's renamed
// in its source. Only while the group still holds the anchor, and only until
// the user names the group. Renaming takes no version, so what the group
// holds stays as it was.
export function followAnchors(
  groups: GroupStore,
  workspaceId: Ulid,
  records: readonly IndexRecord[],
): void {
  const key = (id: string, stableId: string) => `${parseItemId(id)?.source}\u0000${stableId}`;
  const titles = new Map(records.map((record) => [key(record.id, record.stableId), record.title]));
  for (const group of groups.list(workspaceId)) {
    if (group.namedBy === "user" || group.origin.kind !== "cluster") continue;
    const region = groups.region(group.id, group.version);
    const anchor = region?.origin.kind === "cluster" ? region.origin.anchor : null;
    const title = anchor && titles.get(key(anchor.id, anchor.stableId));
    const name = title ? nameOf(title) : "";
    if (name !== "") groups.rename(group.id, name, "oriel");
  }
}
