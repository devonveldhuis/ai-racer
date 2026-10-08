/**
 * Fixed-capacity particle pool (pure data, no three.js). Slots are reused: `spawn` takes a dead
 * slot, and if all are alive it recycles the oldest one (ring order), so the arrays never grow.
 * Positions, colours and the age fraction are plain typed arrays a `THREE.Points` can wrap.
 */
export class DustPool {
  readonly capacity: number;
  /** x, y, z per particle (metres). */
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly colors: Float32Array;
  /** Age / life in [0, 1]; 1 = dead (not drawn). */
  readonly age: Float32Array;
  private readonly life: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
  }

  get aliveCount(): number {
    return this.alive;
  }

  /** Starts a particle; returns its slot. */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    r: number,
    g: number,
    b: number,
  ): number {
    // Look for a dead slot starting at the cursor; fall back to the cursor itself (oldest).
    let slot = this.cursor;
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.cursor + k) % this.capacity;
      if ((this.age[i] as number) >= 1) {
        slot = i;
        break;
      }
    }
    if ((this.age[slot] as number) >= 1) this.alive++;
    this.cursor = (slot + 1) % this.capacity;
    const o = slot * 3;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.velocities[o] = vx;
    this.velocities[o + 1] = vy;
    this.velocities[o + 2] = vz;
    this.colors[o] = r;
    this.colors[o + 1] = g;
    this.colors[o + 2] = b;
    this.age[slot] = 0;
    this.life[slot] = Math.max(1e-3, life);
    return slot;
  }

  /** Moves and ages all live particles by `dt` seconds; particles drift up and slow down. */
  update(dt: number): void {
    const drag = Math.exp(-2 * dt);
    for (let i = 0; i < this.capacity; i++) {
      const a = this.age[i] as number;
      if (a >= 1) continue;
      const na = a + dt / (this.life[i] as number);
      if (na >= 1) {
        this.age[i] = 1;
        this.alive--;
        continue;
      }
      this.age[i] = na;
      const o = i * 3;
      this.velocities[o] = (this.velocities[o] as number) * drag;
      this.velocities[o + 2] = (this.velocities[o + 2] as number) * drag;
      this.positions[o] = (this.positions[o] as number) + (this.velocities[o] as number) * dt;
      this.positions[o + 1] =
        (this.positions[o + 1] as number) + (this.velocities[o + 1] as number) * dt;
      this.positions[o + 2] =
        (this.positions[o + 2] as number) + (this.velocities[o + 2] as number) * dt;
    }
  }
}
