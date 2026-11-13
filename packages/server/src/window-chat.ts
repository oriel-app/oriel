// Not deleted while hidden: its old chat still opens from the Done page and would go with it.
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

export const inOverview = (workstream: { origin: { kind: string }; size: number }): boolean =>
  workstream.origin.kind !== "window" || workstream.size > 0;
