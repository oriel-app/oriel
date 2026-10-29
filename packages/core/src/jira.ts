import type { Instant, ItemId } from "./ids.ts";
import { type Infer, nullable, number, object, optional, string } from "./validate.ts";

// What the index keeps per Jira item: enough for grouping (epic, assignee,
// stuck) and the window's filters, nothing more.
export type JiraAttrs = {
  issueType: string;
  status: { name: string; category: "todo" | "in-progress" | "done" };
  epic: ItemId<"jira"> | null;
  assignee: { accountId: string; name: string } | null;
  points: number | null;
  labels: string[];
};

// Full content, read live at run time. Rich text arrives as plain text.
export type JiraContent = JiraAttrs & {
  summary: string;
  description: string;
  comments: { author: string; body: string; at: Instant }[];
  links: { linkId: string; url: string; title: string }[];
};

// The write operations. Bindings validate captured arguments with these, the
// writer applies them, diffs describe them and revert inverts them. The last
// two exist only as reverts: removeLink undoes addLink, deleteItem undoes
// createStory.
export const jiraOps = {
  createStory: object({
    summary: string,
    description: optional(string),
    points: optional(nullable(number)),
    epic: nullable(string),
  }),
  setSummary: object({ summary: string }),
  setDescription: object({ description: string }),
  setEstimate: object({ points: nullable(number) }),
  setAssignee: object({ accountId: nullable(string) }),
  addLink: object({ url: string, title: string }),
  removeLink: object({ linkId: string }),
  deleteItem: object({}),
};
export type JiraOp = keyof typeof jiraOps;
export type JiraArgs<O extends JiraOp> = Infer<(typeof jiraOps)[O]>;

export function isJiraOp(op: string): op is JiraOp {
  return Object.hasOwn(jiraOps, op);
}
