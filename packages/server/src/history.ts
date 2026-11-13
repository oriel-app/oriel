// The index and its change log only, never a source or a model, so a pin of it can be rerun on every look.
// `of` is the agent's free text, so an item's ID must be a declared kind's.
import {
  type ChangeLogEntry,
  type History,
  historyOf,
  type IndexRecord,
  type Instant,
  isUlid,
  parseItemId,
  type Region,
  type Ulid,
  type Workstream,
} from "@oriel/core";
import { parseDeclared } from "@oriel/sources";

export type HistoryDeps = {
  records(): IndexRecord[];
  changes(): readonly ChangeLogEntry[];
  workstream(id: Ulid): { workstream: Workstream; region: Region | null } | null;
  asOf(): Instant;
};

export function historyRead(deps: HistoryDeps) {
  return async (of: string | null): Promise<History> => {
    const all = deps.records();
    const pick = (): IndexRecord[] => {
      if (of === null) return all;
      if (isUlid(of)) {
        const found = deps.workstream(of);
        if (!found?.region) throw new RangeError(`no workstream is ${JSON.stringify(of)}`);
        const members = new Set(
          found.region.items.map((m) => `${parseItemId(m.id)?.prefix}\u0000${m.stableId}`),
        );
        return all.filter((r) => members.has(`${parseItemId(r.id)?.prefix}\u0000${r.stableId}`));
      }
      if (!parseDeclared(of))
        throw new RangeError(`not an item's or a workstream's ID: ${JSON.stringify(of)}`);
      const children = all.filter((r) => r.facets.container?.id === of);
      if (children.length) return children;
      if (all.some((r) => r.id === of)) throw new RangeError(`${of} holds no items`);
      throw new RangeError(`the index has no ${of}`);
    };
    return historyOf(pick(), deps.changes(), deps.asOf());
  };
}
