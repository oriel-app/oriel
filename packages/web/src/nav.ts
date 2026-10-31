// What the sidebar shows, from the lists the app already keeps: the user's
// groups, each with its threads, most recently active first, and where the
// page is among them.
import type { Model } from "./root.ts";
import type { GroupSummary, ThreadSummaryView } from "./view.ts";

export type NavGroup = {
  group: GroupSummary;
  threads: ThreadSummaryView[];
  // The page is this group, or one of its threads.
  current: boolean;
};

export type Nav = {
  // Null until the groups have loaded.
  groups: NavGroup[] | null;
  // The thread on the page, if one is.
  thread: string | null;
  // Threads whose agent is mid-turn, and threads waiting on the user: a
  // change set to review or a reply.
  busy: number;
  needsYou: number;
};

export function nav(model: Model): Nav {
  const { route } = model;
  const thread = route.page === "thread" ? route.id : null;
  // A thread's group is known from the list before the thread itself loads.
  const group =
    route.page === "group"
      ? route.id
      : thread === null
        ? null
        : (model.thread?.view?.group.id ??
          model.threads?.find((summary) => summary.id === thread)?.group.id ??
          null);
  const threads = [...(model.threads ?? [])].sort((a, b) =>
    b.activityAt.localeCompare(a.activityAt),
  );
  return {
    groups:
      model.groups?.map((summary) => ({
        group: summary,
        threads: threads.filter((each) => each.group.id === summary.id),
        current: summary.id === group,
      })) ?? null,
    thread,
    busy: threads.filter((each) => each.waitingOn === "agent").length,
    needsYou: threads.filter((each) => each.waitingOn === "review" || each.waitingOn === "reply")
      .length,
  };
}
