// The window chat's own workstream (decision 0027). One with no members and
// no working thread is hidden wherever workstreams are listed: the sidebar,
// the overview, the pickers and Oriel's reads. It isn't deleted, since its
// old chat still opens from the Done page and would go with it; it shows
// again once it has a member or a working thread.
import type { Instant, Workstream } from "@oriel/core";
import type { ThreadStore, WorkstreamStore } from "@oriel/db";

export function listedWorkstreams(deps: {
  workstreams: Pick<WorkstreamStore, "region">;
  threads: Pick<ThreadStore, "ofWorkstream">;
  now: () => Instant;
}): (workstream: Workstream) => boolean {
  return (workstream) =>
    workstream.origin.kind !== "window" ||
    (deps.workstreams.region(workstream.id, workstream.version)?.items.length ?? 0) > 0 ||
    deps.threads
      .ofWorkstream(workstream.id, deps.now())
      .some(({ thread }) => thread.state === "working");
}

// Whether the overview counts a workstream as one of the user's (the hub's
// call on decision 0027): a window chat's own with no members isn't, even
// while its chat is working, though the sidebar lists it so the chat is
// one click away. Once it has members it is an ordinary workstream.
export const inOverview = (workstream: { origin: { kind: string }; size: number }): boolean =>
  workstream.origin.kind !== "window" || workstream.size > 0;
