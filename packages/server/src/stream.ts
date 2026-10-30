// A push-to-pull queue for a streamed reply. `return` (the client left, or
// the server is closing) ends it at once, even while the reader waits, and
// calls `onEnd` exactly once.
export function channel<T>(onEnd: () => void) {
  const queue: T[] = [];
  let waiting: ((result: IteratorResult<T, undefined>) => void) | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd();
    waiting?.({ value: undefined, done: true });
    waiting = null;
  };
  const iterator: AsyncIterableIterator<T, undefined> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    next() {
      const value = queue.shift();
      if (value !== undefined) return Promise.resolve({ value, done: false });
      if (ended) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    return() {
      end();
      return Promise.resolve({ value: undefined, done: true });
    },
  };
  return {
    push(value: T): void {
      if (ended) return;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value, done: false });
        return;
      }
      queue.push(value);
    },
    end,
    iterator,
  };
}
