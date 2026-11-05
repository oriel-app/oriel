import {
  type Infer,
  nullable,
  number,
  object,
  type OpCatalogue,
  optional,
  refine,
  string,
} from "@oriel/core";

// Jira's limit on a summary, in characters.
export const maxSummary = 255;

export const isSummary = (text: string): boolean =>
  text.trim() !== "" && [...text].length <= maxSummary;

const summary = refine(string, isSummary, `expected 1 to ${maxSummary} characters`);
// Remote link and comment IDs are numbers; anything else could steer the
// request path.
const linkId = refine(string, (id) => /^[1-9][0-9]*$/.test(id), "a link ID is a number");
const commentId = refine(string, (id) => /^[1-9][0-9]*$/.test(id), "a comment ID is a number");

// Jira's limit on a comment, in characters.
export const maxComment = 32_767;
export const commentBody = refine(
  string,
  (text) => text.trim() !== "" && [...text].length <= maxComment,
  `expected 1 to ${maxComment} characters`,
);
const httpsUrl = refine(
  string,
  (url) => URL.canParse(url) && new URL(url).protocol === "https:",
  "expected an https URL",
);

// A status as its workflow names it, such as "In Progress".
const statusName = refine(string, (name) => name.trim() !== "", "expected a status name");

// An issue's fields, by core's names: what the writer reads for a delete's
// `before`, and what a diff lists for a delete.
export const issueFields = ["summary", "description", "points", "assignee", "epic"] as const;

// Jira's catalogue of write operations. Bindings validate captured arguments
// with these, the writer applies them, diffs describe them and revert inverts
// them. Three exist only as reverts: removeLink undoes addLink,
// removeComment undoes addComment, and deleteItem undoes createStory and
// createEpic.
export const jiraOps = {
  createEpic: {
    args: object({ summary, description: optional(string) }),
    revertOnly: false,
  },
  createStory: {
    args: object({
      summary,
      description: optional(string),
      points: optional(nullable(number)),
      epic: nullable(string),
    }),
    revertOnly: false,
  },
  setSummary: { args: object({ summary }), revertOnly: false },
  setDescription: { args: object({ description: string }), revertOnly: false },
  setEstimate: { args: object({ points: nullable(number) }), revertOnly: false },
  setAssignee: { args: object({ accountId: nullable(string) }), revertOnly: false },
  // Jira moves an issue through its workflow's transitions: the writer takes
  // the one that leads to `status`, and refuses when there is none.
  setStatus: { args: object({ status: statusName }), revertOnly: false },
  addLink: { args: object({ url: httpsUrl, title: string }), revertOnly: false },
  removeLink: { args: object({ linkId }), revertOnly: true },
  // A comment, as plain text: it adds to an item and changes nothing in it.
  addComment: { args: object({ body: commentBody }), revertOnly: false },
  removeComment: { args: object({ commentId }), revertOnly: true },
  deleteItem: { args: object({}), revertOnly: true },
} as const satisfies OpCatalogue;

export type JiraOp = keyof typeof jiraOps;
export type JiraArgs<O extends JiraOp> = Infer<(typeof jiraOps)[O]["args"]>;

export function isJiraOp(op: string): op is JiraOp {
  return Object.hasOwn(jiraOps, op);
}
