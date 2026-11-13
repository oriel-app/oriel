// Whoever signs in, the site answers as Amara Okafor's account, as the Slack fixture's workspace does: the comments Oriel adds are hers.
import type { Instant } from "@oriel/core";
import { instant } from "@oriel/core";
import { adfToText, textToAdf } from "./adf.ts";
import { applySourceEdits, type FixtureIssue, type JiraFixture } from "./fixture.ts";

export const memorySiteOrigin = "https://oriel.atlassian.net";
const pointsField = "customfield_10016";
const searchPath = "/rest/api/3/search/jql";
const self = "amara";

type Issue = {
  id: string;
  key: string;
  issueType: string;
  summary: string;
  description: string;
  document?: unknown;
  labels: string[];
  comments: (FixtureIssue["comments"][number] & { id: string; document?: unknown })[];
  epic: string | null;
  assignee: string | null;
  points: number | null;
  status: string;
  links: { linkId: string; url: string; title: string }[];
  updated: Instant;
};

export type MemorySite = ReturnType<typeof memorySite>;

export function memorySite(
  fixture: JiraFixture,
  clock: Instant,
  options: {
    account?: { email: string; token: string };
    estimates?: false;
    statuses?: { name: string; category: "todo" | "in-progress" | "done" }[];
    projects?: { key: string; name: string; issues: number; updated: Instant }[];
  } = {},
) {
  const { issues: start } = applySourceEdits(fixture, fixture.edits.length);
  let nextComment = 10001;
  const commentId = () => String(nextComment++);
  const issues = new Map<string, Issue>(
    start.map((issue) => [
      issue.key,
      {
        id: issue.id,
        key: issue.key,
        issueType: issue.issueType,
        summary: issue.summary,
        description: issue.description,
        labels: [...issue.labels],
        comments: issue.comments.map((comment) => ({ ...comment, id: commentId() })),
        epic: issue.epic,
        assignee: issue.assignee,
        points: issue.points,
        status: issue.status.name,
        links: issue.links.map((link) => ({ ...link })),
        updated: issue.updatedAt,
      },
    ]),
  );
  const people = new Map(fixture.people.map((person) => [person.id, person.displayName]));
  const keys = { todo: "new", "in-progress": "indeterminate", done: "done" } as const;
  const order = { todo: 0, "in-progress": 1, done: 2 };
  const statuses = new Map(
    [...fixture.issues.map((issue) => issue.status), ...(options.statuses ?? [])]
      .toSorted((a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name))
      .map((status) => [status.name, status]),
  );
  const final = new Set<string>();
  const statusView = (name: string) => ({
    name,
    statusCategory: { key: keys[statuses.get(name)?.category ?? "todo"] },
  });
  const transitions = (issue: Issue) =>
    final.has(issue.status)
      ? []
      : [...statuses.keys()]
          .map((name, i) => ({ id: String(11 + i), name, to: statusView(name) }))
          .filter((way) => way.name !== issue.status);
  const project = fixture.project.key;
  const signature = options.account
    ? `Basic ${Buffer.from(`${options.account.email}:${options.account.token}`).toString("base64")}`
    : null;
  let ticks = 0;
  let nextIssue = 900;
  let nextLink = 90001;
  const refused = new Set<string>();
  const unanswered = new Set<string>();
  const calls: { method: string; path: string }[] = [];
  let searchable: Map<string, Issue> | null = null;
  let outage: "offline" | "signed-out" | "unexpected" | null = null;
  let estimates = options.estimates !== false;

  const tick = (): Instant => {
    ticks += 1;
    return instant(new Date(Date.parse(clock) + ticks * 1000));
  };
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const missing = () =>
    json(404, { errorMessages: ["Issue does not exist or you do not have permission to see it."] });
  const type = (name: string) => ({
    id: name === "Epic" ? "10000" : "10001",
    name,
    subtask: false,
    hierarchyLevel: name === "Epic" ? 1 : 0,
  });
  const view = (issue: Issue, from = issues) => ({
    id: issue.id,
    key: issue.key,
    fields: {
      summary: issue.summary,
      description: issue.document ?? (issue.description ? textToAdf(issue.description) : null),
      issuetype: type(issue.issueType),
      labels: issue.labels,
      parent: issue.epic ? { id: from.get(issue.epic)?.id ?? "1", key: issue.epic } : undefined,
      assignee: issue.assignee
        ? { accountId: issue.assignee, displayName: people.get(issue.assignee) ?? issue.assignee }
        : null,
      status: statusView(issue.status),
      updated: issue.updated,
      [pointsField]: issue.points,
    },
    transitions: transitions(issue),
  });

  const answer = (method: string, url: URL, body: unknown): Response => {
    const path = url.pathname;
    if (method === "GET" && path === "/rest/agile/1.0/board")
      return json(200, { values: [{ id: 1, type: "scrum" }] });
    if (method === "GET" && path === "/rest/agile/1.0/board/1/configuration")
      return json(200, {
        estimation: estimates
          ? { type: "field", field: { fieldId: pointsField, displayName: "Story Points" } }
          : { type: "issueCount" },
      });
    if (method === "GET" && path === `/rest/api/3/issue/createmeta/${project}/issuetypes`)
      return json(200, { issueTypes: [type("Epic"), type("Story")] });
    if (method === "GET" && path === "/rest/api/3/myself")
      return json(200, { accountId: self, timeZone: "UTC" });
    const own = () => ({
      id: "10000",
      key: project,
      name: fixture.project.product,
      insight: {
        totalIssueCount: issues.size,
        lastIssueUpdateTime: [...issues.values()]
          .map((i) => i.updated)
          .toSorted()
          .at(-1),
      },
    });
    if (method === "GET" && path === "/rest/api/3/project/search") {
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      const values = [
        own(),
        ...(options.projects ?? []).map((other, i) => ({
          id: String(10001 + i),
          key: other.key,
          name: other.name,
          insight: { totalIssueCount: other.issues, lastIssueUpdateTime: other.updated },
        })),
      ].filter((p) => `${p.key} ${p.name}`.toLowerCase().includes(query));
      return json(200, { startAt: 0, maxResults: 100, total: values.length, isLast: true, values });
    }
    if (method === "GET" && path.startsWith("/rest/api/3/project/"))
      return path === `/rest/api/3/project/${project}`
        ? json(200, own())
        : json(404, { errorMessages: ["No project could be found with that key."] });
    // Every issue, oldest update first, whatever the JQL's window: listing
    // more than was asked for changes nothing in an index.
    if (method === "POST" && path === searchPath) {
      const { maxResults = 50, nextPageToken } = body as {
        maxResults?: number;
        nextPageToken?: string;
      };
      const at = Number(nextPageToken ?? 0);
      const from = searchable ?? issues;
      const listed = [...from.values()].toSorted(
        (a, b) => a.updated.localeCompare(b.updated) || a.key.localeCompare(b.key),
      );
      const more = at + maxResults < listed.length;
      return json(200, {
        issues: listed.slice(at, at + maxResults).map((issue) => view(issue, from)),
        ...(more ? { nextPageToken: String(at + maxResults) } : { isLast: true }),
      });
    }
    if (method === "POST" && path === "/rest/api/3/issue") {
      const fields = (body as { fields: Record<string, unknown> }).fields;
      const parent = fields.parent as { key: string } | undefined;
      const typeId = (fields.issuetype as { id?: string } | undefined)?.id;
      const issue: Issue = {
        id: String(20000 + nextIssue),
        key: `${project}-${nextIssue}`,
        issueType: typeId === type("Epic").id ? "Epic" : "Story",
        summary: String(fields.summary),
        description: fields.description ? adfToText(fields.description) : "",
        labels: [],
        comments: [],
        epic: parent?.key ?? null,
        assignee: null,
        points: typeof fields[pointsField] === "number" ? (fields[pointsField] as number) : null,
        status: "To Do",
        links: [],
        updated: tick(),
      };
      nextIssue += 1;
      issues.set(issue.key, issue);
      return json(201, { id: issue.id, key: issue.key });
    }
    const match =
      /^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-[0-9]+)(\/assignee|\/transitions|\/comment(?:\/([0-9]+))?|\/remotelink(?:\/([0-9]+))?)?$/.exec(
        path,
      );
    const issue = match?.[1] ? issues.get(match[1]) : undefined;
    if (!match || !issue) return missing();
    const [, key = "", sub, commentAt, linkId] = match;
    if (method !== "GET" && refused.has(key))
      return json(400, { errorMessages: [`${key} can't be changed right now`], errors: {} });
    if (sub === undefined) {
      if (method === "GET") return json(200, view(issue));
      if (method === "DELETE") {
        issues.delete(key);
        return json(204);
      }
      if (method === "PUT") {
        const fields = (body as { fields: Record<string, unknown> }).fields;
        if ("summary" in fields) issue.summary = String(fields.summary);
        if ("description" in fields) {
          issue.description = adfToText(fields.description);
          delete issue.document;
        }
        if (pointsField in fields)
          issue.points =
            typeof fields[pointsField] === "number" ? (fields[pointsField] as number) : null;
        issue.updated = tick();
        return json(204);
      }
    }
    if (sub === "/assignee" && method === "PUT") {
      issue.assignee = (body as { accountId: string | null }).accountId;
      issue.updated = tick();
      return json(204);
    }
    const commentView = (comment: Issue["comments"][number]) => ({
      id: comment.id,
      author: {
        accountId: comment.author,
        displayName: people.get(comment.author) ?? comment.author,
      },
      body: comment.document ?? textToAdf(comment.body),
      created: comment.at,
    });
    if (sub === "/comment" && method === "GET")
      return json(200, {
        startAt: 0,
        total: issue.comments.length,
        comments: issue.comments.map(commentView),
      });
    if (sub === "/comment" && method === "POST") {
      const document = (body as { body: unknown }).body;
      const at = tick();
      const made = { id: commentId(), author: self, body: adfToText(document), at };
      issue.comments.push(made);
      issue.updated = at;
      return json(201, commentView(made));
    }
    if (sub?.startsWith("/comment/")) {
      const comment = issue.comments.find((c) => c.id === commentAt);
      if (!comment)
        return json(404, { errorMessages: ["Can not find a comment for the id."], errors: {} });
      if (method === "GET") return json(200, commentView(comment));
      if (method === "DELETE") {
        issue.comments = issue.comments.filter((c) => c !== comment);
        issue.updated = tick();
        return json(204);
      }
    }
    if (sub === "/transitions" && method === "GET")
      return json(200, { transitions: transitions(issue) });
    if (sub === "/transitions" && method === "POST") {
      const { id } = (body as { transition: { id: string } }).transition;
      const way = transitions(issue).find((t) => t.id === id);
      if (!way)
        return json(400, { errorMessages: [`Transition id '${id}' is not valid for this issue.`] });
      issue.status = way.to.name;
      issue.updated = tick();
      return json(204);
    }
    if (sub?.startsWith("/remotelink")) {
      const link = issue.links.find((l) => l.linkId === linkId);
      if (method === "GET" && linkId === undefined)
        return json(
          200,
          issue.links.map((l) => ({
            id: Number(l.linkId),
            object: { url: l.url, title: l.title },
          })),
        );
      if (method === "GET")
        return link
          ? json(200, { id: Number(link.linkId), object: { url: link.url, title: link.title } })
          : json(404, {});
      if (method === "POST" && linkId === undefined) {
        const { object } = body as { object: { url: string; title: string } };
        const made = { linkId: String(nextLink), url: object.url, title: object.title };
        nextLink += 1;
        issue.links.push(made);
        issue.updated = tick();
        return json(201, { id: Number(made.linkId) });
      }
      if (method === "DELETE" && link) {
        issue.links = issue.links.filter((l) => l !== link);
        issue.updated = tick();
        return json(204);
      }
    }
    return json(405, { errorMessages: [`${method} ${path} isn't something this site answers`] });
  };

  const holds = new Map<string, { reached: PromiseWithResolvers<void>; release: Promise<void> }>();

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== memorySiteOrigin) throw new Error(`no route to ${url.origin}`);
    const method = init?.method ?? "GET";
    if (outage === "offline") throw new TypeError("fetch failed");
    calls.push({ method, path: `${url.pathname}${url.search}` });
    if (signature !== null && new Headers(init?.headers).get("authorization") !== signature)
      return json(401, { errorMessages: ["You are not authenticated."] });
    if (outage === "signed-out")
      return json(401, {
        errorMessages: ["Client must be authenticated to access this resource."],
      });
    if (outage === "unexpected")
      return json(400, {
        errorMessages: [`The value '${project}' does not exist for the field 'project'.`],
      });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const key = /^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-[0-9]+)/.exec(url.pathname)?.[1];
    const held = url.pathname === searchPath ? "search" : key;
    const hold = method !== "GET" && held !== undefined ? holds.get(held) : undefined;
    if (hold) {
      hold.reached.resolve();
      await hold.release;
    }
    const response = answer(method, url, body);
    // As fetch reports a connection that drops before the answer arrives.
    if (method !== "GET" && key !== undefined && unanswered.has(key))
      throw new TypeError("fetch failed");
    return response;
  };

  return {
    fetch: fetchFn,
    calls,
    issue: (key: string) => structuredClone(issues.get(key) ?? null),
    refuse: (key: string) => refused.add(key),
    loseAnswers: (key: string) => unanswered.add(key),
    hold(key: string) {
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      holds.set(key, { reached, release: release.promise });
      return {
        reached: reached.promise,
        release() {
          holds.delete(key);
          release.resolve();
        },
      };
    },
    makeFinal(status: string) {
      final.add(status);
    },
    allow(key: string) {
      refused.delete(key);
      unanswered.delete(key);
    },
    // Jira's search catches up with writes a while after them; reading an issue by key never lags.
    searchLags() {
      searchable = new Map(structuredClone([...issues]));
    },
    searchCatchesUp() {
      searchable = null;
    },
    estimation(on: boolean) {
      estimates = on;
    },
    outage(kind: typeof outage) {
      outage = kind;
    },
    add(made: { issueType: "Epic" | "Story"; summary: string; epic?: string }): string {
      const issue: Issue = {
        id: String(20000 + nextIssue),
        key: `${project}-${nextIssue}`,
        issueType: made.issueType,
        summary: made.summary,
        description: "",
        status: "To Do",
        labels: [],
        comments: [],
        epic: made.epic ?? null,
        assignee: null,
        points: null,
        links: [],
        updated: tick(),
      };
      nextIssue += 1;
      issues.set(issue.key, issue);
      return issue.key;
    },
    remove(key: string) {
      if (!issues.delete(key)) throw new Error(`no issue ${key}`);
    },
    edit(key: string, change: Partial<Pick<Issue, "summary" | "points" | "status">>) {
      const issue = issues.get(key);
      if (!issue) throw new Error(`no issue ${key}`);
      Object.assign(issue, change, { updated: tick() });
    },
    describe(key: string, document: unknown) {
      const issue = issues.get(key);
      if (!issue) throw new Error(`no issue ${key}`);
      Object.assign(issue, { document, description: adfToText(document), updated: tick() });
    },
    comment(key: string, author: string, document: unknown) {
      const issue = issues.get(key);
      if (!issue) throw new Error(`no issue ${key}`);
      const at = tick();
      issue.comments.push({ id: commentId(), author, body: adfToText(document), at, document });
      issue.updated = at;
    },
    editComment(key: string, id: string, body: string) {
      const comment = issues.get(key)?.comments.find((c) => c.id === id);
      if (!comment) throw new Error(`no comment ${id} on ${key}`);
      Object.assign(comment, { body });
      delete comment.document;
    },
  };
}

const text = (words: string, marks?: unknown[]) => ({
  type: "text",
  text: words,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const item = (...content: unknown[]) => ({ type: "listItem", content: [paragraph(...content)] });

// For `describe`: one link goes to a scheme no browser should follow, and a table, a panel and a mention have no panel blocks.
export const richDescription = {
  type: "doc",
  version: 1,
  content: [
    paragraph(
      text("Same as the app, for browsers that support it. "),
      text("Hide the button", [{ type: "strong" }]),
      text(" otherwise."),
    ),
    { type: "heading", attrs: { level: 2 }, content: [text("Acceptance")] },
    {
      type: "bulletList",
      content: [
        item(text("Shows only where "), text("canMakePayment()", [{ type: "code" }])),
        item(text("Falls back to the card form, "), text("never", [{ type: "em" }])),
        item(
          text("Matches the "),
          text("app's flow", [
            { type: "link", attrs: { href: "https://design.example.com/wallet" } },
          ]),
        ),
      ],
    },
    {
      type: "orderedList",
      attrs: { order: 1 },
      content: [item(text("Ship to 10% of browsers")), item(text("Then everyone"))],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("if (await wallet.canMakePayment()) show(button);\nelse hide(button);")],
    },
    {
      type: "panel",
      attrs: { panelType: "warning" },
      content: [paragraph(text("Apple Pay needs the domain file first."))],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [paragraph(text("Browser"))] },
            { type: "tableHeader", content: [paragraph(text("Wallet"))] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [paragraph(text("Safari"))] },
            { type: "tableCell", content: [paragraph(text("Apple Pay"))] },
          ],
        },
      ],
    },
    paragraph(
      { type: "mention", attrs: { id: "esme", text: "@Esme Whitlock" } },
      text(" to check "),
      text("this", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
      text(" before the review."),
    ),
  ],
};

export const richComment = {
  type: "doc",
  version: 1,
  content: [
    paragraph(text("Checked on the three browsers we care about:")),
    {
      type: "bulletList",
      content: [
        item(text("Safari shows the button")),
        item(text("Chrome shows it once a card is saved")),
        item(text("Firefox falls back to the card form")),
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "text" },
      content: [text("PaymentRequest is not defined")],
    },
    paragraph(
      text("Firefox's console says the above; "),
      text("the tracking bug", [
        { type: "link", attrs: { href: "https://bugs.example.com/wallet/1203" } },
      ]),
      text(" has more."),
    ),
  ],
};
