// A key of another project, or a word shaped like one (`UTF-8`, `SHA-256`), names nothing.
import { itemId, type Recognizer } from "@oriel/core";

export type JiraScope = { projects: readonly string[] };

const projectShape = /^[A-Z][A-Z0-9_]*$/;

export function jiraRecognizer({ projects }: JiraScope): Recognizer {
  const keys = projects.filter((project) => projectShape.test(project));
  if (keys.length === 0) return () => [];
  // Not inside a longer word or number on either side: `XSYN-5` and
  // `SYN-5a` are no keys, and `SYN-05` isn't `SYN-5`.
  const key = new RegExp(`(?<![A-Za-z0-9_])(?:${keys.join("|")})-[1-9][0-9]*(?![A-Za-z0-9_])`, "g");
  return (text) => [...new Set(text.match(key) ?? [])].map((found) => itemId("jira", found));
}
