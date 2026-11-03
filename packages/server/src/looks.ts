// A look at the workspace that runs again each time it changes, one at a
// time: a change while a look runs queues one more, never more. The desktop
// app's notifications and its question before quitting each look this way.
export type Looks = {
  // The workspace changed: look again, after any look still running.
  changed(): void;
  // Resolves once no look is running or queued.
  idle(): Promise<void>;
  // Waits for the last look, and looks no more.
  stop(): Promise<void>;
};

export function looks(look: () => Promise<void>, failed: (error: unknown) => void): Looks {
  let stopped = false;
  let queued = false;
  let running: Promise<void> = Promise.resolve();
  const once = async () => {
    queued = false;
    if (!stopped) await look();
  };
  return {
    changed() {
      if (queued || stopped) return;
      queued = true;
      running = running.then(once).catch(failed);
    },
    idle: () => running,
    async stop() {
      stopped = true;
      await running;
    },
  };
}
