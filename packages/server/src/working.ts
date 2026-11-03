// Asking before quitting (decision 0045): the desktop app asks the person
// before it quits while Oriel works on a thread, its turn running or one of
// its change sets applying. The server tells the shell how many threads that
// is each time the number changes, or 0 while Settings has asking off, so the
// shell knows at once when Cmd+Q comes, with nothing to ask the server then.
import type { Log, Ulid } from "@oriel/core";
import { type Looks, looks } from "./looks.ts";

// How many threads Oriel is working on: a turn running, or a change set
// applying, which a done thread's revert can be too.
export async function workingThreads(deps: {
  threads: readonly { id: Ulid }[];
  running(threadId: Ulid): boolean;
  changeSets(threadId: Ulid): Promise<readonly { id: Ulid }[]>;
  applying(changeSetId: Ulid): boolean;
}): Promise<number> {
  let count = 0;
  for (const thread of deps.threads) {
    if (deps.running(thread.id)) count += 1;
    else if ((await deps.changeSets(thread.id)).some((set) => deps.applying(set.id))) count += 1;
  }
  return count;
}

export type Working = (threads: number) => Promise<void>;

// Tells `tell` the number each time it changes, starting from 0, which is
// what the shell assumes of a server that has told it nothing.
export function quitGuard(deps: {
  working(): Promise<number>;
  on(): boolean;
  tell: Working;
  log: Log;
}): Looks {
  let told = 0;
  return looks(
    async () => {
      const threads = deps.on() ? await deps.working() : 0;
      if (threads === told) return;
      try {
        await deps.tell(threads);
        told = threads;
      } catch {
        deps.log("working: the shell didn't take it", { threads });
      }
    },
    (error) => deps.log("working: couldn't look", { error: String(error) }),
  );
}
