import {
  type IndexRecord,
  instant,
  parseItemId,
  type SourceKind,
  ulid,
  unknown,
} from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

// An index of `records` alone, in memory, that searches as the app's does:
// for an eval's world, whose items come from its fixtures rather than a
// sync (OA-264). `texts` is each one's text, by item ID. Close it when done.
export function searchOnly(
  records: readonly IndexRecord[],
  texts: ReadonlyMap<string, string>,
): {
  search(query: string, limit: number): (IndexRecord<SourceKind, unknown> & { excerpt?: string })[];
  close(): void;
} {
  const db = open(":memory:");
  try {
    const at = instant(new Date(0));
    migrate(db, loadMigrations(), at);
    const workspaceId = ulid(0, new Uint8Array(10));
    ensureWorkspace(db, { id: workspaceId, name: "search" }, at);
    const index = indexStore(db);
    for (const [source, of] of Map.groupBy(records, (r) => parseItemId(r.id)?.prefix ?? "")) {
      const run = index.beginSync(workspaceId, source, unknown, at);
      const given = of.flatMap((r) => {
        const text = texts.get(r.id);
        return text === undefined ? [] : [[r.stableId, text] as const];
      });
      run.apply({ records: of, gone: [], cursor: null, texts: Object.fromEntries(given) });
      run.finish(null, at);
    }
    return {
      search: (query, limit) => index.search(workspaceId, query, limit),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
