import type { UpgradeEvent } from "./upgrade";

/** Matches subscribe() in ./upgrade: register a listener, get an unsubscribe. */
export type UpgradeSubscribe = (subscriber: (event: UpgradeEvent) => void) => () => void;

export interface UpgradeEventBridgeDeps {
  subscribe: UpgradeSubscribe;
  send: (event: UpgradeEvent) => void;
}

export interface UpgradeEventBridge {
  attach(): void;
  detach(): void;
  isAttached(): boolean;
}

/**
 * One upgrade-event subscriber per active center connection. attach() is
 * idempotent (no duplicate subscribers after reconnect); every live event is
 * forwarded via send; a terminal cleanup event (success or failure) removes
 * the subscriber after forwarding; detach() is idempotent. No buffering or
 * replay: events emitted while detached are dropped, and a re-attach resumes
 * at the next live event.
 */
export function createUpgradeEventBridge({ subscribe, send }: UpgradeEventBridgeDeps): UpgradeEventBridge {
  let unsubscribe: (() => void) | null = null;

  function detach(): void {
    if (unsubscribe === null) return;
    const release = unsubscribe;
    unsubscribe = null;
    release();
  }

  function onEvent(event: UpgradeEvent): void {
    send(event);
    if (event.step === "cleanup" && (event.status === "success" || event.status === "failure")) {
      detach();
    }
  }

  function attach(): void {
    if (unsubscribe !== null) return;
    unsubscribe = subscribe(onEvent);
  }

  return {
    attach,
    detach,
    isAttached: () => unsubscribe !== null,
  };
}
