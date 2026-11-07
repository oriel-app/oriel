// Linear taking in the stand-in tracker's issues once it's on (decision
// 0059): one create of a change set for each, epics first, each as a
// project of the team, then each story, as an issue in its epic's project
// when its epic is among them. The stand-in's own words go into Linear as
// they are.
import type { CapturedMutation, ItemId, NewRef, TakenIssue } from "@oriel/core";
import { maxTitle } from "./ops.ts";

// A title Linear takes: a longer one is cut at a character, never a half
// of one.
const titleOf = (text: string) => [...text.trim()].slice(0, maxTitle).join("") || "Untitled";

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
    mutations.push({ op, target: null, ref, args, into: "linear" });
  };
  for (const issue of issues.filter((each) => each.kind === "epic"))
    make(issue, "createProject", {
      name: titleOf(issue.summary),
      ...(issue.description ? { description: issue.description } : {}),
    });
  for (const issue of issues.filter((each) => each.kind === "story"))
    make(issue, "createIssue", {
      title: titleOf(issue.summary),
      ...(issue.description ? { description: issue.description } : {}),
      ...(issue.points === null ? {} : { estimate: Math.min(64, Math.round(issue.points)) }),
      project: (issue.epic && refs.get(issue.epic)) ?? null,
    });
  return { mutations, items };
}
