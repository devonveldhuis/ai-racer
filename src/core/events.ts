/**
 * A tiny typed event emitter. `E` maps event names to their payload types:
 * `new EventBus<{ lap: { n: number } }>()`. Listeners run synchronously in subscription order.
 */
export class EventBus<E extends object> {
  private readonly listeners = new Map<keyof E, Set<(payload: never) => void>>();

  /** Subscribes `fn` to `event`; returns a function that unsubscribes it. */
  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    // Wrap so subscribing the same function twice gives two independent subscriptions.
    const wrapped = ((payload: E[K]) => fn(payload)) as (payload: never) => void;
    const owner = set;
    owner.add(wrapped);
    return () => {
      owner.delete(wrapped);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Iterate a copy so listeners may unsubscribe while handling the event.
    for (const fn of [...set]) (fn as (p: E[K]) => void)(payload);
  }

  /** Removes all listeners (of one event, or of every event). */
  clear(event?: keyof E): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }
}
