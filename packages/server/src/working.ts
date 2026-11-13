// The shell knows the number at once when Cmd+Q comes, with nothing to ask the server then.
import type { Log, Ulid } from "@oriel/core";
import { type Looks, looks } from "./looks.ts";

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

// Starting from 0, which is what the shell assumes of a server that has told it nothing.
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
