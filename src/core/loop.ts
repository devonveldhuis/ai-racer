export interface GameLoopOptions {
  /** Fixed physics rate in Hz (default 60). */
  hz?: number;
  /** Max physics steps per frame, to avoid the spiral of death (default 5). */
  maxSubSteps?: number;
  /** Fixed-step simulation update; `dt` is in seconds. */
  update: (dt: number) => void;
  /** Render callback; `alpha` in [0, 1) is the fraction into the next step. */
  render: (alpha: number) => void;
}

/**
 * Fixed-timestep loop (accumulator pattern). `advance()` is pure with respect to
 * time (takes elapsed seconds) so it can be unit-tested; `start()` drives it
 * from requestAnimationFrame.
 */
export class GameLoop {
  readonly dt: number;
  private readonly maxSubSteps: number;
  private readonly updateFn: (dt: number) => void;
  private readonly renderFn: (alpha: number) => void;
  private accumulator = 0;
  private last: number | null = null;
  private rafId: number | null = null;

  constructor(opts: GameLoopOptions) {
    this.dt = 1 / (opts.hz ?? 60);
    this.maxSubSteps = opts.maxSubSteps ?? 5;
    this.updateFn = opts.update;
    this.renderFn = opts.render;
  }

  /** Advances by `elapsed` seconds of wall time; returns number of update steps run. */
  advance(elapsed: number): number {
    this.accumulator += Math.max(0, elapsed);
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSubSteps) {
      this.updateFn(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    // Spiral-of-death guard: drop time we could not simulate.
    if (this.accumulator >= this.dt) this.accumulator = this.accumulator % this.dt;
    this.renderFn(this.accumulator / this.dt);
    return steps;
  }

  start(): void {
    if (this.rafId !== null) return;
    this.last = null;
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      if (this.last !== null) this.advance((now - this.last) / 1000);
      this.last = now;
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.last = null;
  }
}
