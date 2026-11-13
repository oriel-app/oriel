// A browser hands over links, text, and files by name and modification time only: never a file's path.
import {
  type IndexRecord,
  type ItemId,
  parseItemId,
  type Presentations,
  type SourceKind,
} from "@oriel/core";

export type DroppedFile = { name: string; modified: number };
export type Dropped = { links: readonly string[]; files: readonly DroppedFile[] };
export type Refusal = { what: string; why: string; syncMightHelp: boolean };
export type Resolved = { ids: ItemId[]; refused: Refusal[] };

// A file's time on disk and in the index can differ by rounding, and by up to
// two seconds on some filesystems.
const sameTime = 2_000;

const webOrFile = (url: URL) =>
  url.protocol === "https:" || url.protocol === "http:" || url.protocol === "file:";

const place = (url: URL) =>
  `${url.protocol === "file:" ? "file://" : url.origin}${url.pathname.replace(/\/+$/, "")}`;

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

const sourceNames = new Intl.ListFormat("en-GB");
const elsewhere = (sources: Presentations, kinds: ReadonlySet<SourceKind>) => {
  const names = Object.entries(sources).flatMap(([kind, source]) =>
    source && kinds.has(kind) ? [source.name] : [],
  );
  return names.length > 0
    ? `Only ${sourceNames.format(names)} items can be added, not other pages.`
    : "Oriel has no items yet, so nothing can be added.";
};

const fileName = (location: string): string | null => {
  const url = URL.parse(location);
  if (!url || url.protocol !== "file:") return null;
  return decoded(url.pathname.split("/").at(-1) ?? "").normalize("NFC");
};

export function resolveDropped(
  records: readonly IndexRecord[],
  dropped: Dropped,
  sources: Presentations,
): Resolved {
  const kinds = new Set<SourceKind>();
  const byPlace = new Map<string, ItemId>();
  const byHandle = new Map<string, ItemId>();
  const byName = new Map<string, IndexRecord[]>();
  const origins = new Set<string>();
  for (const record of records) {
    const url = URL.parse(record.location);
    if (url && webOrFile(url)) {
      byPlace.set(place(url), record.id);
      if (url.protocol !== "file:") origins.add(url.origin);
    }
    const parsed = parseItemId(record.id);
    if (parsed) {
      kinds.add(parsed.kind);
      byHandle.set(parsed.key, record.id);
    }
    const name = fileName(record.location);
    if (name) byName.set(name, [...(byName.get(name) ?? []), record]);
  }
  const named = (words: Iterable<string>) => [...words].flatMap((w) => byHandle.get(w) ?? []);
  const indexed = new Set(records.map((record) => record.id));
  const linkedTo = (url: URL) =>
    Object.entries(sources).flatMap(([kind, presentation]) => {
      const key = presentation?.linked?.(url);
      const id = key ? (`${kind}:${key}` as ItemId) : null;
      return id && indexed.has(id) ? [id] : [];
    });

  const ids = new Set<ItemId>();
  const refused: Refusal[] = [];
  for (const link of dropped.links) {
    const url = URL.parse(link.trim());
    if (url && webOrFile(url)) {
      const at = byPlace.get(place(url));
      const known = origins.has(url.origin);
      const linked = known ? linkedTo(url) : [];
      const found = at
        ? [at]
        : linked.length > 0
          ? linked
          : known
            ? named([...url.pathname.split("/").map(decoded), ...url.searchParams.values()])
            : [];
      for (const id of found) ids.add(id);
      if (found.length === 0)
        refused.push({
          what: link,
          why: known ? "Oriel doesn't have this item." : elsewhere(sources, kinds),
          syncMightHelp: known,
        });
      continue;
    }
    const words = link.split(/[^\p{L}\p{N}_-]+/u).filter((word) => word !== "");
    const found = named(words);
    for (const id of found) ids.add(id);
    if (found.length === 0)
      refused.push({
        what: link,
        why: "This doesn't name anything Oriel has.",
        syncMightHelp: words.some((word) => /[0-9]/.test(word)),
      });
  }
  for (const file of dropped.files) {
    const sameName = byName.get(file.name.normalize("NFC")) ?? [];
    const same = sameName.filter(
      (record) => Math.abs(Date.parse(record.updatedAt) - file.modified) <= sameTime,
    );
    const [only] = same;
    if (same.length === 1 && only) {
      ids.add(only.id);
      continue;
    }
    if (!kinds.has("folder")) {
      refused.push({
        what: file.name,
        why: "No folder of markdown files is connected, so no file can be added. Add one at the foot of the sidebar.",
        syncMightHelp: false,
      });
      continue;
    }
    refused.push({
      what: file.name,
      why:
        same.length > 1
          ? "The connected folder has more than one file like this one. Add it from the window."
          : sameName.length > 0
            ? "This isn't the connected folder's file by this name; the two were changed at different times."
            : "Only files in the connected folder can be added, and it has no file by this name.",
      syncMightHelp: same.length === 0,
    });
  }
  return { ids: [...ids], refused };
}
