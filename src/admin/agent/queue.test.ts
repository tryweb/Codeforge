import { describe, expect, test } from "bun:test";
import { createDeferralQueue } from "./queue";

describe("deferral queue", () => {
  test("shifts items in first-in, first-out order", () => {
    const queue = createDeferralQueue<string>();
    queue.push("first");
    queue.push("second");
    queue.push("third");

    expect(queue.shift()).toBe("first");
    expect(queue.shift()).toBe("second");
    expect(queue.shift()).toBe("third");
  });

  test("peeks without removing the oldest item", () => {
    const queue = createDeferralQueue<object>();
    const item = { id: "command-1" };
    queue.push(item);

    expect(queue.peek()).toBe(item);
    expect(queue.peek()).toBe(item);
    expect(queue.size()).toBe(1);
  });

  test("reports the current size", () => {
    const queue = createDeferralQueue<number>();

    expect(queue.size()).toBe(0);
    queue.push(1);
    queue.push(2);
    expect(queue.size()).toBe(2);
    queue.shift();
    expect(queue.size()).toBe(1);
  });

  test("clears every queued item", () => {
    const queue = createDeferralQueue<number>();
    queue.push(1);
    queue.push(2);

    queue.clear();

    expect(queue.size()).toBe(0);
    expect(queue.peek()).toBeUndefined();
  });

  test("returns undefined when shifting an empty queue", () => {
    const queue = createDeferralQueue<string>();

    expect(queue.shift()).toBeUndefined();
  });
});
