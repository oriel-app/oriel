// The Jira source over Cloud REST v3: `sync` pages the search endpoint from an
// `updated` cursor, `read` fetches full content live. It never writes; the
// writer lives behind this package's `./writer` subpath.
import {
  array,
  boolean,
  type IndexRecord,
  type Infer,
  type Instant,
  isInstant,
  type ItemId,
  itemId,
  type JiraAttrs,
  type JiraContent,
  type Log,
  nullable,
  number,
  object,
  optional,
  parseItemId,
  type ReadResult,
  type Result,
  type Source,
  type SyncPage,
  string,
  unknown,
} from "@oriel/core";
import { adfToText } from "./adf.ts";
import {
  api,
  attrsOf,
  call,
  discoverPoints,
  indexFieldNames,
  indexFieldShape,
  indexFields,
  issue,
  projectKey,
  projectOf,
  rawField,
  time,
} from "./rest.ts";
import type { Transport } from "./transport.ts";

export type JiraSource = Source<"jira", JiraAttrs, JiraContent>;

export type JiraSourceOptions = {
  transport: Transport;
  // Where item URLs point, such as "https://oriel.atlassian.net".
  site: string;
  // The project keys to index.
  projects: readonly string[];
  log: Log;
  pageSize?: number;
};

// Jira's search caps a page that returns fields at 100 issues.
const maxPage = 100;
// JQL compares `updated` to the minute, in the searching user's time zone,
// where an hour repeats when clocks go back. Each incremental sync reaches
// back this far; records it reads again change nothing in the index.
const overlapMs = 60 * 60 * 1000;
const readConcurrency = 4;

const searchPage = object({
  issues: array(unknown),
  nextPageToken: optional(nullable(string)),
  isLast: optional(nullable(boolean)),
});
const myself = object({ timeZone: optional(string) });
const readIssue = issue(object({ ...indexFieldShape, description: optional(unknown) }));
const commentPage = object({
  startAt: number,
  total: number,
  comments: array(
    object({ author: optional(object({ displayName: string })), body: unknown, created: time }),
  ),
});
const remoteLinks = array(
  object({ id: number, object: object({ url: string, title: optional(string) }) }),
);

export function jiraSource(options: JiraSourceOptions): JiraSource {
  const { transport, log } = options;
  const site = options.site.replace(/\/$/, "");
  const projects = [...new Set(options.projects)];
  if (!projects.length || projects.some((key) => !projectKey.test(key)))
    throw new RangeError("expected one or more project keys, like SYN");
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? maxPage), 1), maxPage);

  // Rediscovered at the start of each sync, so a board's new estimate field
  // takes effect on the next one. A failed discovery isn't kept.
  let discovered: Promise<Map<string, string>> | null = null;
  const pointsFields = (fresh: boolean) => {
    if (fresh || !discovered)
      discovered = discoverPoints(transport, projects, log).catch((error: unknown) => {
        discovered = null;
        throw error;
      });
    return discovered;
  };
  const fieldList = (points: Map<string, string>) => [
    ...new Set([...indexFieldNames, ...points.values()]),
  ];

  const toRecord = (
    raw: unknown,
    points: Map<string, string>,
  ): Result<IndexRecord<"jira", JiraAttrs>> => {
    const parsed = issue(indexFields)(raw);
    if (!parsed.ok) return parsed;
    const { id, key, fields } = parsed.value;
    return {
      ok: true,
      value: {
        id: itemId("jira", key),
        stableId: id,
        title: fields.summary,
        url: `${site}/browse/${key}`,
        updatedAt: fields.updated,
        attrs: attrsOf(fields, rawField(raw, points.get(projectOf(key)))),
      },
    };
  };

  const timeZone = async () => {
    const { timeZone } = await call(transport, { method: "GET", path: `${api}/myself` }, myself);
    if (timeZone && validZone(timeZone)) return timeZone;
    log("jira: no usable time zone on the account, so JQL dates are read as UTC");
    return "UTC";
  };

  const readOne = async (
    id: ItemId<"jira">,
    points: Map<string, string>,
  ): Promise<ReadResult<"jira", JiraContent>> => {
    const parsed = parseItemId(id);
    if (parsed?.source !== "jira") return { id, status: "gone", reason: "deleted" };
    const request = {
      method: "GET" as const,
      path: `${api}/issue/${parsed.key}?fields=${[...fieldList(points), "description"].join(",")}`,
    };
    const response = await transport(request);
    // Jira answers 404 both for a deleted issue and for one this account can't see.
    if (response.status === 404) return { id, status: "gone", reason: "deleted" };
    if (response.status === 403) return { id, status: "gone", reason: "forbidden" };
    const found = await call(async () => response, request, readIssue);
    // Jira resolves an old key to the issue's new one.
    if (found.key !== parsed.key) return { id, status: "moved", to: itemId("jira", found.key) };
    const [comments, links] = await Promise.all([
      readComments(found.key),
      call(transport, { method: "GET", path: `${api}/issue/${found.key}/remotelink` }, remoteLinks),
    ]);
    return {
      id,
      status: "ok",
      content: {
        ...attrsOf(found.fields, rawField(response.body, points.get(projectOf(found.key)))),
        summary: found.fields.summary,
        description: adfToText(found.fields.description),
        comments,
        links: links.map((link) => ({
          linkId: String(link.id),
          url: link.object.url,
          title: link.object.title ?? link.object.url,
        })),
      },
    };
  };

  const readComments = async (key: string) => {
    const comments: JiraContent["comments"] = [];
    for (;;) {
      const page = await call(
        transport,
        {
          method: "GET",
          path: `${api}/issue/${key}/comment?startAt=${comments.length}&maxResults=${maxPage}&orderBy=created`,
        },
        commentPage,
      );
      for (const comment of page.comments)
        comments.push({
          author: comment.author?.displayName ?? "Unknown",
          body: adfToText(comment.body),
          at: comment.created,
        });
      if (!page.comments.length || comments.length >= page.total) return comments;
    }
  };

  return {
    kind: "jira",

    // A null cursor lists everything. Otherwise the cursor is the latest
    // `updated` seen so far, and only issues updated since (less the overlap)
    // are listed. Jira's search can't list deleted issues, so pages report no
    // gone IDs: the sync worker's full sweep finds those.
    async *sync(cursor) {
      const since = cursor !== null && isInstant(cursor) ? cursor : null;
      const points = await pointsFields(true);
      const scope = `project in (${projects.map((key) => `"${key}"`).join(", ")})`;
      const window = since
        ? ` AND updated >= "${jqlDate(new Date(Date.parse(since) - overlapMs), await timeZone())}"`
        : "";
      const jql = `${scope}${window} ORDER BY updated ASC, key ASC`;
      const fields = fieldList(points);
      let latest: Instant | null = since;
      let token: string | null = null;
      const tokens = new Set<string>();
      for (;;) {
        const page: Infer<typeof searchPage> = await call(
          transport,
          {
            method: "POST",
            path: `${api}/search/jql`,
            body: { jql, fields, maxResults: pageSize, ...(token ? { nextPageToken: token } : {}) },
          },
          searchPage,
        );
        const records: IndexRecord<"jira", JiraAttrs>[] = [];
        for (const raw of page.issues) {
          const record = toRecord(raw, points);
          if (!record.ok) {
            log("jira: skipped an issue in a shape Oriel can't read", {
              issues: record.issues.slice(0, 5),
            });
            continue;
          }
          records.push(record.value);
          if (latest === null || record.value.updatedAt > latest) latest = record.value.updatedAt;
        }
        // With nothing seen yet there is no cursor to report.
        if (latest !== null)
          yield { records, gone: [], cursor: latest } satisfies SyncPage<"jira", JiraAttrs>;
        token = page.nextPageToken ?? null;
        if (!token || page.isLast === true) return;
        if (tokens.has(token)) throw new Error("jira: the search repeated a page token");
        tokens.add(token);
      }
    },

    async read(ids) {
      const points = await pointsFields(false);
      return mapLimit(ids, readConcurrency, (id) => readOne(id, points));
    },
  };
}

function validZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// A JQL date, "yyyy-MM-dd HH:mm" in the given zone, rounded down to the minute.
export function jqlDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

// Like Promise.all over `items`, with at most `limit` running at once. Order is kept.
async function mapLimit<T, U>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  const queue = [...items.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift())
      results[next[0]] = await work(next[1]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
