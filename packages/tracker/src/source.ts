import {
  type IndexRecord,
  type OwnItems,
  parseItemId,
  type ReadResult,
  type Source,
} from "@oriel/core";
import {
  contentOf,
  issuesIn,
  stableIdOf,
  type TrackerContent,
  recordOf,
  textOf,
} from "./issues.ts";

export function trackerSource(own: OwnItems): Source<"tracker", unknown, TrackerContent> {
  const issues = issuesIn(own);
  return {
    kind: "tracker",
    async *sync() {
      const all = issues.all();
      yield {
        records: all.map(recordOf) as IndexRecord<"tracker">[],
        gone: [],
        cursor: null,
        texts: Object.fromEntries(all.map((issue) => [stableIdOf(issue.key), textOf(issue)])),
      };
    },
    async read(ids) {
      return ids.map((id): ReadResult<"tracker", TrackerContent> => {
        const key = parseItemId(id)?.key;
        const issue = key === undefined ? null : issues.byKey(key);
        if (!issue) return { id, status: "gone", reason: "deleted" };
        return {
          id,
          status: "ok",
          content: { title: issue.summary, text: textOf(issue), ...contentOf(issue) },
        };
      });
    },
  };
}
