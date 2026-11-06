// A second issue tracker, in tests only (OA-273): Tickets, whose items are
// issues of a kind no package declares. It maps them onto core's issues
// shape, as every tracker's connector does (decision 0059), and borrows
// nothing from Jira, so a surface that shows them as it shows Jira's knows
// trackers only by that shape. Not a package, and never shipped.
import {
  type FieldReader,
  type Instant,
  issueColumns,
  issueDeclaredFacets,
  issueDetails,
  issueFacts,
  issueFields,
  type IssueFields,
  issueOverview,
  issueRecord,
  itemId,
  nullable,
  number,
  object,
  op,
  type OpSpecs,
  type PanelOf,
  type Recognizer,
  type ReadResult,
  type SourceDeclaration,
  type Source,
  string,
} from "@oriel/core";

const day = 86_400_000;
const site = "https://tickets.example";

type Ticket = { key: string; id: string; summary: string; description: string; issue: IssueFields };

// Four tickets as of `now`: an epic, a story in progress with no update in
// 20 days, an unassigned task with no estimate whose text names the story,
// and a bug no epic holds, done.
export function tickets(now: Instant): Ticket[] {
  const ago = (days: number) => new Date(Date.parse(now) - days * day).toISOString() as Instant;
  const epic = { id: itemId("tickets", "TK-1"), stableId: "t-1" };
  const ada = { id: "u-ada", name: "Ada Quill" };
  const raw: unknown[] = [
    {
      key: "TK-1",
      id: "t-1",
      summary: "Kiosk mode",
      description: "",
      issue: {
        kind: "epic",
        type: "Epic",
        container: null,
        status: { name: "Doing", category: "in-progress" },
        assignee: ada,
        estimate: null,
        labels: [],
        updatedAt: ago(1),
      },
    },
    {
      key: "TK-2",
      id: "t-2",
      summary: "Tap to pay at the kiosk",
      description: "Contactless cards and phones.",
      issue: {
        kind: "story",
        type: "Story",
        container: epic,
        status: { name: "Doing", category: "in-progress" },
        assignee: ada,
        estimate: 3,
        labels: ["payments"],
        updatedAt: ago(20),
      },
    },
    {
      key: "TK-3",
      id: "t-3",
      summary: "Kiosk receipt layout",
      description: "Follows TK-2.",
      issue: {
        kind: "task",
        type: "Task",
        container: epic,
        status: { name: "Backlog", category: "todo" },
        assignee: null,
        estimate: null,
        labels: [],
        updatedAt: ago(2),
      },
    },
    {
      key: "TK-4",
      id: "t-4",
      summary: "Card reader times out",
      description: "",
      issue: {
        kind: "bug",
        type: "Bug",
        container: null,
        status: { name: "Shipped", category: "done" },
        assignee: { id: "u-bo", name: "Bo Reyes" },
        estimate: 1,
        labels: [],
        updatedAt: ago(3),
      },
    },
  ];
  // Checked as a tracker's mapping would be.
  return raw.map((each, i) => {
    const parsed = object({ issue: issueFields })(each, `$[${i}]`);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return { ...(each as Ticket), issue: parsed.value.issue };
  });
}

const idOf = (ticket: Ticket) => itemId("tickets", ticket.key);
const textOf = (ticket: Ticket) => [ticket.summary, ticket.description].join("\n\n");

const recordOf = (ticket: Ticket) =>
  issueRecord(
    {
      id: idOf(ticket),
      stableId: ticket.id,
      title: ticket.summary,
      location: `${site}/${ticket.key}`,
    },
    ticket.issue,
  );

// What a live read returns of a ticket.
const content = object({ title: string, text: string, description: string, issue: issueFields });

// The source over the tickets: a sync of them all, and live reads.
type Content = { description: string; issue: IssueFields };

export function ticketsSource(all: readonly Ticket[]): Source<"tickets", unknown, Content> {
  const byId = new Map(all.map((ticket) => [idOf(ticket), ticket]));
  return {
    kind: "tickets",
    async *sync() {
      yield {
        records: all.map(recordOf),
        gone: [],
        cursor: null,
        texts: Object.fromEntries(all.map((ticket) => [ticket.id, textOf(ticket)])),
      };
    },
    async read(ids) {
      return ids.map((id): ReadResult<"tickets", Content> => {
        const ticket = byId.get(id);
        if (!ticket) return { id, status: "gone", reason: "deleted" };
        const { summary: title, description, issue } = ticket;
        return { id, status: "ok", content: { title, text: textOf(ticket), description, issue } };
      });
    },
  };
}

// Its fields as its op specs name them, for a diff.
export function ticketsReader(all: readonly Ticket[]): FieldReader<"tickets"> {
  const byId = new Map(all.map((ticket) => [idOf(ticket), ticket]));
  return {
    async current(id, fields) {
      const ticket = byId.get(id);
      if (!ticket) return "gone";
      const values: Record<string, unknown> = {
        summary: ticket.summary,
        points: ticket.issue.estimate ?? null,
        updated: ticket.issue.updatedAt,
      };
      return Object.fromEntries(fields.map((field) => [field, values[field]]));
    },
    name: async () => null,
  };
}

const panel: PanelOf = (read) => {
  const parsed = content(read);
  if (!parsed.ok) return null;
  const { issue, description } = parsed.value;
  return {
    title: null,
    blocks: [
      issueFacts(issue),
      { kind: "text", heading: "Description", text: description, format: "plain" },
    ],
  };
};

const recognizer = (): Recognizer => (text) =>
  [...new Set(text.match(/\bTK-[1-9][0-9]*\b/g) ?? [])].map((key) => itemId("tickets", key));

const specs: OpSpecs = {
  name: "Tickets",
  titleField: "summary",
  fields: { summary: "value", points: "value", updated: "value" },
  updatedField: "updated",
  ops: {
    setEstimate: op(
      { args: object({ points: nullable(number) }), revertOnly: false },
      {
        idempotent: true,
        after: ({ points }) => ({ points }),
        describe: ({ points }, { subject }) =>
          `Estimate “${subject?.title ?? "it"}” at ${points ?? "no"} points.`,
        undo: (_args, applied) => ({ op: "setEstimate", args: { points: applied.before.points } }),
      },
    ),
  },
};

// What Tickets declares of itself, as a connector would: how it shows,
// its panel, its facets, its recognizer, its candidates and its op specs.
export const ticketsDeclaration = {
  kind: "tickets",
  key: /^TK-[1-9][0-9]*$/,
  name: "Tickets",
  inSentence: "Tickets",
  icon: "ticket",
  keysReadAs: null,
  columns: issueColumns,
  details: issueDetails,
  panel,
  facets: issueDeclaredFacets,
  recognizer,
  overview: issueOverview,
  specs,
} satisfies Partial<SourceDeclaration>;
