// What the user dropped on a group or a thread, as the items it names. A
// browser hands over links (a Jira card dragged out of its board is a link to
// the issue), text, and files by name only: it never gives a page a file's
// path. So a link matches an item's location, a handle in text matches an
// item's handle, and a file matches a folder item by name when exactly one
// has it. What matches nothing is refused with a plain reason (decision 0018:
// links and files outside a connected folder wait for their own sources).
import { type IndexRecord, type ItemId, parseItemId } from "@oriel/core";

export type Dropped = { links: readonly string[]; files: readonly string[] };
export type Resolved = { ids: ItemId[]; refused: { what: string; why: string }[] };

// A link without its query, fragment or trailing slash; null if it isn't one.
function place(link: string): string | null {
  const url = URL.parse(link.trim());
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "file:"))
    return null;
  return `${url.origin === "null" ? "file://" : url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

// A handle as it appears in text, like SYN-12: letters, a dash, a number.
const handles = /\b[A-Z][A-Z0-9]+-[1-9][0-9]*\b/g;

const fileName = (location: string): string | null => {
  const url = URL.parse(location);
  if (!url || url.protocol !== "file:") return null;
  return decodeURIComponent(url.pathname.split("/").at(-1) ?? "").normalize("NFC");
};

export function resolveDropped(records: readonly IndexRecord[], dropped: Dropped): Resolved {
  const byPlace = new Map<string, ItemId>();
  const byHandle = new Map<string, ItemId>();
  const byName = new Map<string, ItemId[]>();
  for (const record of records) {
    const at = place(record.location);
    if (at) byPlace.set(at, record.id);
    const key = parseItemId(record.id)?.key;
    if (key) byHandle.set(key, record.id);
    const name = fileName(record.location);
    if (name) byName.set(name, [...(byName.get(name) ?? []), record.id]);
  }
  const ids = new Set<ItemId>();
  const refused: Resolved["refused"] = [];
  for (const link of dropped.links) {
    const at = place(link);
    const found = at ? byPlace.get(at) : undefined;
    if (found) {
      ids.add(found);
      continue;
    }
    // Text, or a link to a page that names an item, like a board with an issue open.
    const named = [...link.matchAll(handles)].flatMap(([handle]) => byHandle.get(handle) ?? []);
    if (named.length > 0) {
      for (const id of named) ids.add(id);
      continue;
    }
    refused.push({
      what: link,
      why: at
        ? "Oriel doesn't have this page. Only Jira items and files in the connected folder can be added."
        : "This doesn't name anything Oriel has.",
    });
  }
  for (const file of dropped.files) {
    const matches = byName.get(file.normalize("NFC")) ?? [];
    const [only] = matches;
    if (matches.length === 1 && only) ids.add(only);
    else
      refused.push({
        what: file,
        why:
          matches.length === 0
            ? "Only files in the connected folder can be added, and it has no file by this name."
            : "The connected folder has more than one file by this name. Add it from the window.",
      });
  }
  return { ids: [...ids], refused };
}
