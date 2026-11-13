// A change while a look runs queues one more, never more.
export type Looks = {
  changed(): void;
  idle(): Promise<void>;
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
