import { describe, expect, test } from "bun:test";
import { createUpgradeEventBridge } from "./upgrade-event-bridge";
import type { StepStatus, UpgradeEvent, UpgradeStep } from "./upgrade";

interface Harness {
  bridge: ReturnType<typeof createUpgradeEventBridge>;
  subscribers: Set<(event: UpgradeEvent) => void>;
  sent: UpgradeEvent[];
  emit: (step: UpgradeStep, status: StepStatus) => UpgradeEvent;
}

/** Fake subscriber registry mirroring lib/upgrade.ts subscribe()/unsubscribe. */
function harness(): Harness {
  const subscribers = new Set<(event: UpgradeEvent) => void>();
  const sent: UpgradeEvent[] = [];
  let nextId = 1;
  const bridge = createUpgradeEventBridge({
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    send: (event) => {
      sent.push(event);
    },
  });
  const emit = (step: UpgradeStep, status: StepStatus): UpgradeEvent => {
    const event: UpgradeEvent = {
      id: nextId++,
      step,
      status,
      message: `${step}/${status}`,
      timestamp: new Date().toISOString(),
    };
    for (const subscriber of [...subscribers]) subscriber(event);
    return event;
  };
  return { bridge, subscribers, sent, emit };
}

describe("createUpgradeEventBridge", () => {
  test("forwards live events after attach", () => {
    const { bridge, sent, emit } = harness();
    expect(bridge.isAttached()).toBe(false);
    bridge.attach();
    expect(bridge.isAttached()).toBe(true);
    const event = emit("digest_compare", "running");
    expect(sent).toEqual([event]);
  });

  test("a second attach while attached is a no-op (no duplicate subscribers)", () => {
    const { bridge, subscribers, sent, emit } = harness();
    bridge.attach();
    bridge.attach();
    expect(subscribers.size).toBe(1);
    const event = emit("backup", "running");
    expect(sent).toEqual([event]);
  });

  test("detach stops delivery; events emitted while detached are dropped, not replayed", () => {
    const { bridge, sent, emit } = harness();
    bridge.attach();
    const first = emit("backup", "running");
    bridge.detach();
    expect(bridge.isAttached()).toBe(false);
    emit("backup", "success"); // dropped
    bridge.detach(); // idempotent
    bridge.attach(); // reconnect: resumes at the next live event
    const third = emit("recreate", "running");
    expect(sent).toEqual([first, third]);
  });

  test("a terminal cleanup success event is forwarded, then auto-unsubscribes", () => {
    const { bridge, subscribers, sent, emit } = harness();
    bridge.attach();
    emit("cleanup", "running");
    const terminal = emit("cleanup", "success");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(terminal);
    expect(bridge.isAttached()).toBe(false);
    expect(subscribers.size).toBe(0);
    emit("cleanup", "success"); // after detach: not delivered
    expect(sent).toHaveLength(2);
  });

  test("a terminal cleanup failure also unsubscribes; non-terminal cleanup keeps the subscription", () => {
    const { bridge, sent, emit } = harness();
    bridge.attach();
    emit("cleanup", "running");
    expect(bridge.isAttached()).toBe(true);
    const failure = emit("cleanup", "failure");
    expect(sent[sent.length - 1]).toEqual(failure);
    expect(bridge.isAttached()).toBe(false);
  });
});
