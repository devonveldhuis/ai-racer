/**
 * The race state machine: countdown, checkpoints, laps, timing, resets and the result.
 * Pure logic (no three.js / Rapier), driven by `step(dt, carSample)` once per fixed physics
 * step. All times are simulation time (the sum of `dt`), never the wall clock, so lockstep
 * runs give fair times. Positions are metres; layout data is in grid units (x `worldScale`).
 *
 * The game acts on what `step` returns: `resetTo` (teleport the car there) and
 * `controllerEnabled` (false = hold the car). The same information is also emitted as events.
 *
 * Time bookkeeping: `raceTime` is the simulation time since GO, `time` adds the reset
 * penalties. Splits, lap times and the total time use `time`, so lap times add up to the total.
 */
import type { SurfaceType } from '../assets/surfaces';
import type { CarPose } from '../car/types';
import type { RaceConfig } from '../core/config';
import { EventBus } from '../core/events';
import type { Checkpoint, TrackLayout } from '../track/layout';
import { trackProgress, type TrackProgress } from './progress';
import type { RaceResult } from './results';

export type RaceState = 'loading' | 'generating' | 'countdown' | 'racing' | 'finished' | 'paused';
export type ResetReason = 'manual' | 'outOfBounds' | 'flipped';

/** The car as the race sees it, once per physics step. */
export interface CarSample {
  /** Metres. */
  position: { x: number; z: number };
  /** Radians, the `layout.ts` convention. */
  heading: number;
  /** Chassis up vector y component (1 = upright, < 0 = upside down). */
  upY: number;
  surface: SurfaceType | null;
  /** The car fell off the world (`BuiltTrack.isOutOfBounds`). */
  outOfBounds?: boolean;
}

export interface RaceEvents {
  stateChanged: { state: RaceState; previous: RaceState };
  /** 3, 2, 1, then 0 = GO. */
  countdownTick: { value: number };
  checkpoint: { index: number; lap: number; time: number };
  lap: { lap: number; time: number };
  finished: RaceResult;
  reset: { reason: ResetReason; penalty: number };
}

export interface RaceActions {
  /** Teleport the car here (zero velocity, upright); the game must also reset the controller. */
  resetTo: CarPose | null;
  /** False while the car must be held (countdown, pause, finished). */
  controllerEnabled: boolean;
}

export interface RaceOptions {
  layout: TrackLayout;
  worldScale: number;
  config: RaceConfig;
  /** Name recorded in the result. */
  controller: string;
}

const COUNTDOWN_FROM = 3;
const FLIP_UP_Y = 0.3;
const EPS = 1e-9;

/** Where a car starts, in metres. */
export function startPoseMetres(layout: TrackLayout, worldScale: number): CarPose {
  const sp = layout.startPose;
  return {
    position: { x: sp.position.x * worldScale, z: sp.position.z * worldScale },
    heading: sp.heading,
  };
}

/** The pose a reset to checkpoint `cp` gives: centred on the line, heading along its normal. */
export function checkpointPose(cp: Checkpoint, worldScale: number): CarPose {
  return {
    position: { x: cp.position.x * worldScale, z: cp.position.z * worldScale },
    heading: Math.atan2(cp.normal.x, -cp.normal.z),
  };
}

/**
 * True if the movement `p0 -> p1` crosses checkpoint `cp` in its driving direction
 * (segment-segment intersection, dot product with the normal > 0).
 */
export function crossesCheckpoint(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  cp: Checkpoint,
  worldScale: number,
): boolean {
  const ax = cp.a.x * worldScale;
  const az = cp.a.z * worldScale;
  const rx = p1.x - p0.x;
  const rz = p1.z - p0.z;
  const sx = cp.b.x * worldScale - ax;
  const sz = cp.b.z * worldScale - az;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-12) return false;
  const qx = ax - p0.x;
  const qz = az - p0.z;
  const t = (qx * sz - qz * sx) / denom;
  const u = (qx * rz - qz * rx) / denom;
  if (!(t > 0 && t <= 1 && u >= 0 && u <= 1)) return false;
  return rx * cp.normal.x + rz * cp.normal.z > 0;
}

export class Race {
  readonly events = new EventBus<RaceEvents>();
  readonly layout: TrackLayout;
  private readonly S: number;
  private readonly cfg: RaceConfig;
  private readonly controllerName: string;
  private readonly checkpoints: Checkpoint[];

  private _state: RaceState = 'loading';
  private beforePause: RaceState = 'countdown';
  private countdownElapsed = 0;
  private tickIndex = 0;
  private _countdownValue: number | null = null;

  private _raceTime = 0;
  private _penalty = 0;
  private _offTrack = 0;
  private _resets = 0;
  private _lap = 1;
  private next = 0;
  private lastPassed: number | null = null;
  private lapStart = 0;
  private lapTimes: number[] = [];
  private flipTime = 0;
  private pendingReset: ResetReason | null = null;
  private prev: { x: number; z: number } | null = null;
  private _progress: TrackProgress | null = null;
  private _result: RaceResult | null = null;

  constructor(opts: RaceOptions) {
    this.layout = opts.layout;
    this.S = opts.worldScale;
    this.cfg = opts.config;
    this.controllerName = opts.controller;
    this.checkpoints = opts.layout.checkpoints;
  }

  get state(): RaceState {
    return this._state;
  }
  /** 3, 2, 1, 0 (GO) while counting down; null before and after. */
  get countdownValue(): number | null {
    return this._countdownValue;
  }
  /** Simulation seconds since GO, without penalties. Frozen while paused. */
  get raceTime(): number {
    return this._raceTime;
  }
  /** Race time including reset penalties (the time that counts). */
  get time(): number {
    return this._raceTime + this._penalty;
  }
  get resets(): number {
    return this._resets;
  }
  get offTrackTime(): number {
    return this._offTrack;
  }
  /** Current lap, 1-based. */
  get lap(): number {
    return this._lap;
  }
  get laps(): number {
    return this.cfg.laps;
  }
  /** Checkpoints passed in the current lap (the last one is the finish line) out of the total. */
  get checkpointsPassed(): number {
    return this.next;
  }
  get checkpointCount(): number {
    return this.checkpoints.length;
  }
  get progress(): TrackProgress | null {
    return this._progress;
  }
  get result(): RaceResult | null {
    return this._result;
  }
  get controllerEnabled(): boolean {
    return this._state === 'racing';
  }
  /** The pose a reset would use right now. */
  get resetPose(): CarPose {
    return this.lastPassed === null
      ? startPoseMetres(this.layout, this.S)
      : checkpointPose(this.checkpoints[this.lastPassed] as Checkpoint, this.S);
  }

  /** `loading -> generating`: the track is being built. */
  beginGenerating(): void {
    if (this._state === 'loading') this.setState('generating');
  }

  /** `loading | generating -> countdown`: the car is on the start pose. Emits tick 3. */
  startCountdown(): void {
    if (this._state !== 'loading' && this._state !== 'generating') return;
    this.countdownElapsed = 0;
    this.tickIndex = 0;
    this.setState('countdown');
    this.tick();
  }

  pause(): void {
    if (this._state !== 'countdown' && this._state !== 'racing') return;
    this.beforePause = this._state;
    this.setState('paused');
  }

  resume(): void {
    if (this._state === 'paused') this.setState(this.beforePause);
  }

  togglePause(): void {
    if (this._state === 'paused') this.resume();
    else this.pause();
  }

  /** Asks for a reset to the last checkpoint at the next step. Only honoured while racing. */
  requestReset(reason: ResetReason = 'manual'): void {
    if (this._state === 'racing') this.pendingReset = reason;
  }

  /** Advances by one fixed step of `dt` seconds. */
  step(dt: number, car: CarSample): RaceActions {
    const actions: RaceActions = { resetTo: null, controllerEnabled: false };
    const live = this._state === 'countdown' || this._state === 'racing';
    if (live || this._state === 'finished') {
      this._progress = trackProgress(
        this.layout,
        this.S,
        car.position,
        car.heading,
        this._progress?.nearestIndex,
      );
    }
    if (this._state === 'countdown') {
      this.stepCountdown(dt, car);
    } else if (this._state === 'racing') {
      this.stepRacing(dt, car, actions);
    }
    actions.controllerEnabled = this.controllerEnabled;
    return actions;
  }

  dispose(): void {
    this.events.clear();
  }

  private setState(state: RaceState): void {
    const previous = this._state;
    if (state === previous) return;
    this._state = state;
    this.events.emit('stateChanged', { state, previous });
  }

  private tick(): void {
    const value = COUNTDOWN_FROM - this.tickIndex;
    this._countdownValue = value;
    this.events.emit('countdownTick', { value });
  }

  private stepCountdown(dt: number, car: CarSample): void {
    this.prev = { x: car.position.x, z: car.position.z };
    this.countdownElapsed += dt;
    const stepSeconds = this.cfg.countdownStepSeconds;
    while (
      this.tickIndex < COUNTDOWN_FROM &&
      this.countdownElapsed + EPS >= (this.tickIndex + 1) * stepSeconds
    ) {
      this.tickIndex++;
      this.tick();
    }
    if (this.tickIndex >= COUNTDOWN_FROM) {
      this._raceTime = 0;
      this.lapStart = 0;
      this.flipTime = 0;
      this.setState('racing');
    }
  }

  private stepRacing(dt: number, car: CarSample, actions: RaceActions): void {
    this._raceTime += dt;
    const s = car.surface;
    if (s === null || s === 'grass' || s === 'sand') this._offTrack += dt;

    // Flipped for too long?
    if (car.upY < FLIP_UP_Y) this.flipTime += dt;
    else this.flipTime = 0;

    let reason = this.pendingReset;
    this.pendingReset = null;
    if (car.outOfBounds) reason = 'outOfBounds';
    else if (reason === null && this.flipTime + EPS >= this.cfg.flipResetSeconds) {
      reason = 'flipped';
    }
    if (reason !== null) {
      this.doReset(reason, actions);
      return;
    }

    const p1 = { x: car.position.x, z: car.position.z };
    const p0 = this.prev;
    this.prev = p1;
    if (!p0) return;
    const cp = this.checkpoints[this.next];
    if (!cp || !crossesCheckpoint(p0, p1, cp, this.S)) return;
    this.passCheckpoint();
  }

  private passCheckpoint(): void {
    const index = this.next;
    const time = this.time;
    this.lastPassed = index;
    this.events.emit('checkpoint', { index, lap: this._lap, time });
    if (index < this.checkpoints.length - 1) {
      this.next++;
      return;
    }
    // The finish line, after every other checkpoint of this lap.
    const lapTime = time - this.lapStart;
    this.lapStart = time;
    this.lapTimes.push(lapTime);
    this.events.emit('lap', { lap: this._lap, time: lapTime });
    if (this._lap >= this.cfg.laps) {
      this.next = 0;
      this.finish();
    } else {
      this._lap++;
      this.next = 0;
    }
  }

  private finish(): void {
    const result: RaceResult = {
      seed: this.layout.seed,
      controller: this.controllerName,
      laps: this.cfg.laps,
      totalTime: this.time,
      lapTimes: [...this.lapTimes],
      resets: this._resets,
      offTrackTime: this._offTrack,
      timestamp: new Date().toISOString(),
    };
    this._result = result;
    this.setState('finished');
    this.events.emit('finished', result);
  }

  private doReset(reason: ResetReason, actions: RaceActions): void {
    const penalty = this.cfg.resetPenaltySeconds;
    this._penalty += penalty;
    this._resets++;
    this.flipTime = 0;
    this.prev = null;
    actions.resetTo = this.resetPose;
    this.events.emit('reset', { reason, penalty });
  }
}
