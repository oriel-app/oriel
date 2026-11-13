import type { CapturedMutation, ItemId, NewRef, TakenIssue } from "@oriel/core";
import { isSummary, maxSummary } from "./ops.ts";

// A longer summary is cut at a character, never half of one.
const summaryOf = (text: string) =>
  isSummary(text) ? text : [...text.trim()].slice(0, maxSummary).join("") || "Untitled";

export function takeIssues(issues: readonly TakenIssue[]): {
  mutations: CapturedMutation[];
  items: Record<NewRef, ItemId>;
} {
  const mutations: CapturedMutation[] = [];
  const items: Record<NewRef, ItemId> = {};
  const refs = new Map<string, NewRef>();
  const make = (issue: TakenIssue, op: string, args: Record<string, unknown>) => {
    const ref: NewRef = `new:${mutations.length + 1}`;
    refs.set(issue.id, ref);
    items[ref] = issue.id;
    mutations.push({ op, target: null, ref, args, into: "jira" });
  };
  for (const issue of issues.filter((each) => each.kind === "epic"))
    make(issue, "createEpic", {
      summary: summaryOf(issue.summary),
      ...(issue.description ? { description: issue.description } : {}),
    });
  for (const issue of issues.filter((each) => each.kind === "story"))
    make(issue, "createStory", {
      summary: summaryOf(issue.summary),
      ...(issue.description ? { description: issue.description } : {}),
      ...(issue.points === null ? {} : { points: issue.points }),
      epic: (issue.epic && refs.get(issue.epic)) ?? null,
    });
  return { mutations, items };
}
