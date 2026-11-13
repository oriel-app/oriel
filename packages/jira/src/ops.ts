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

export const maxSummary = 255;

export const isSummary = (text: string): boolean =>
  text.trim() !== "" && [...text].length <= maxSummary;

const summary = refine(string, isSummary, `expected 1 to ${maxSummary} characters`);
// Remote link and comment IDs are numbers; anything else could steer the
// request path.
const linkId = refine(string, (id) => /^[1-9][0-9]*$/.test(id), "a link ID is a number");
const commentId = refine(string, (id) => /^[1-9][0-9]*$/.test(id), "a comment ID is a number");

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

const statusName = refine(string, (name) => name.trim() !== "", "expected a status name");

export const issueFields = ["summary", "description", "points", "assignee", "epic"] as const;

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
  setStatus: { args: object({ status: statusName }), revertOnly: false },
  addLink: { args: object({ url: httpsUrl, title: string }), revertOnly: false },
  removeLink: { args: object({ linkId }), revertOnly: true },
  addComment: { args: object({ body: commentBody }), revertOnly: false },
  removeComment: { args: object({ commentId }), revertOnly: true },
  deleteItem: { args: object({}), revertOnly: true },
} as const satisfies OpCatalogue;

export type JiraOp = keyof typeof jiraOps;
export type JiraArgs<O extends JiraOp> = Infer<(typeof jiraOps)[O]["args"]>;

export function isJiraOp(op: string): op is JiraOp {
  return Object.hasOwn(jiraOps, op);
}
