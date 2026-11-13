import type { IndexRecord, OwnItems, OwnWrite } from "@oriel/core";

export function memoryItems(): OwnItems & { written: OwnWrite[]; texts: Map<string, string> } {
  const records = new Map<string, IndexRecord>();
  const contents = new Map<string, unknown>();
  const texts = new Map<string, string>();
  const keys = new Set<string>();
  const written: OwnWrite[] = [];
  return {
    written,
    texts,
    records: () => [...records.values()].toSorted((a, b) => (a.id < b.id ? -1 : 1)),
    content: (stableId) => contents.get(stableId) ?? null,
    keys: () => [...keys],
    async write(change) {
      for (const record of change.records) {
        records.set(record.stableId, record);
        keys.add(record.id.slice(record.id.indexOf(":") + 1));
        const content = change.contents[record.stableId];
        if (content !== undefined) contents.set(record.stableId, structuredClone(content));
        const text = change.texts[record.stableId];
        if (text !== undefined) texts.set(record.id, text);
      }
      for (const stableId of change.gone) {
        const record = records.get(stableId);
        if (record) texts.delete(record.id);
        records.delete(stableId);
        contents.delete(stableId);
      }
      written.push(change.what);
    },
  };
}
