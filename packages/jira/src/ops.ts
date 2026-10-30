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
// Remote link IDs are numbers; anything else could steer the request path.
const linkId = refine(string, (id) => /^[1-9][0-9]*$/.test(id), "a link ID is a number");
const httpsUrl = refine(
  string,
  (url) => URL.canParse(url) && new URL(url).protocol === "https:",
  "expected an https URL",
);

// Jira's catalogue of write operations. Bindings validate captured arguments
// with these, the writer applies them, diffs describe them and revert inverts
// them. The last two exist only as reverts: removeLink undoes addLink,
// deleteItem undoes createStory.
export const jiraOps = {
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
  addLink: { args: object({ url: httpsUrl, title: string }), revertOnly: false },
  removeLink: { args: object({ linkId }), revertOnly: true },
  deleteItem: { args: object({}), revertOnly: true },
} as const satisfies OpCatalogue;

export type JiraOp = keyof typeof jiraOps;
export type JiraArgs<O extends JiraOp> = Infer<(typeof jiraOps)[O]["args"]>;

export function isJiraOp(op: string): op is JiraOp {
  return Object.hasOwn(jiraOps, op);
}
