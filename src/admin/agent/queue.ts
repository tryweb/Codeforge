/** A mutable first-in, first-out queue for commands waiting to be dispatched. */
export interface DeferralQueue<T> {
  push: (item: T) => void;
  shift: () => T | undefined;
  peek: () => T | undefined;
  size: () => number;
  clear: () => void;
}

/** Create an in-memory FIFO queue that preserves each queued item's identity. */
export function createDeferralQueue<T>(): DeferralQueue<T> {
  const items: T[] = [];

  return {
    push: (item) => {
      items.push(item);
    },
    shift: () => items.shift(),
    peek: () => items[0],
    size: () => items.length,
    clear: () => {
      items.length = 0;
    },
  };
}
