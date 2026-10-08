/**
 * Collects cleanup functions while something is built step by step. If a later step throws,
 * `disposeAll()` frees what was built so far (in reverse order, one failing cleanup does not
 * stop the others); on success `release()` hands the whole stack over as one function.
 */
export class DisposeStack {
  private fns: (() => void)[] = [];

  /** Registers `fn` and returns `value`, so it can wrap a constructor call. */
  add<T>(value: T, fn: () => void): T {
    this.fns.push(fn);
    return value;
  }

  /** Runs and clears every cleanup, newest first. Errors are logged, not thrown. */
  disposeAll(): void {
    const fns = this.fns;
    this.fns = [];
    for (let i = fns.length - 1; i >= 0; i--) {
      try {
        (fns[i] as () => void)();
      } catch (e) {
        console.error('Cleanup failed', e);
      }
    }
  }

  /** Empties the stack and returns a function that runs what it held. */
  release(): () => void {
    const fns = this.fns;
    this.fns = [];
    const holder = new DisposeStack();
    holder.fns = fns;
    return () => holder.disposeAll();
  }
}
