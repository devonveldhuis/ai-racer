import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceType } from '../assets/surfaces';
import { DEFAULT_CONFIG, type RaceConfig } from '../core/config';
import { generateTrack } from '../track/generator';
import type { TrackLayout } from '../track/layout';
import {
  checkpointPose,
  crossesCheckpoint,
  Race,
  startPoseMetres,
  type CarSample,
  type RaceActions,
  type RaceEvents,
} from './Race';
import { densify, pathAround, rectLayout } from './testLayouts';

const S = 4;
const DT = 1 / 60;
const layout = rectLayout();
const start = startPoseMetres(layout, S);

type P = { x: number; z: number };
const sample = (position: P, over: Partial<CarSample> = {}): CarSample => ({
  position,
  heading: 0,
  upY: 1,
  surface: 'road',
  ...over,
});

interface Rig {
  race: Race;
  log: string[];
  events: { [K in keyof RaceEvents]: RaceEvents[K][] };
  /** Steps with the car at `p` for `seconds`; returns the last actions. */
  hold(seconds: number, p?: P, over?: Partial<CarSample>): RaceActions;
  /** Steps along `path`, one point per step. */
  drive(path: P[], over?: Partial<CarSample>): RaceActions;
}

function rig(raceConfig: Partial<RaceConfig> = {}, lay: TrackLayout = layout, ready = true): Rig {
  const race = new Race({
    layout: lay,
    worldScale: S,
    config: { ...DEFAULT_CONFIG.race, ...raceConfig },
    controller: 'test',
  });
  const events: Rig['events'] = {
    stateChanged: [],
    countdownTick: [],
    checkpoint: [],
    lap: [],
    finished: [],
    reset: [],
  };
  for (const k of Object.keys(events) as (keyof RaceEvents)[]) {
    race.events.on(k, (e) => (events[k] as unknown[]).push(e));
  }
  const log: string[] = [];
  race.events.on('stateChanged', (e) => log.push(`${e.previous}>${e.state}`));
  if (ready) {
    race.beginGenerating();
    race.startCountdown();
  }
  const sp = startPoseMetres(lay, S).position;
  const last: RaceActions = { resetTo: null, controllerEnabled: false };
  return {
    race,
    log,
    events,
    hold(seconds, p = sp, over = {}) {
      let a = last;
      const steps = Math.round(seconds / DT);
      for (let i = 0; i < steps; i++) a = race.step(DT, sample(p, over));
      return a;
    },
    drive(path, over = {}) {
      let a = last;
      for (const p of path) a = race.step(DT, sample(p, over));
      return a;
    },
  };
}

/** Runs the countdown out so the race is `racing`. */
function go(r: Rig): void {
  r.hold(3);
  expect(r.race.state).toBe('racing');
}

const lapPath = (lay = layout, count = 1) =>
  densify(pathAround(lay, S, startPoseMetres(lay, S).position, count), 0.5);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crossesCheckpoint', () => {
  const cp = layout.checkpoints[0]!;
  const n = cp.normal;
  const at = (d: number, lateral = 0): P => ({
    x: (cp.position.x + n.x * d - n.z * lateral) * S,
    z: (cp.position.z + n.z * d + n.x * lateral) * S,
  });

  it('is true across the segment in the driving direction only', () => {
    expect(crossesCheckpoint(at(-0.1), at(0.1), cp, S)).toBe(true);
    expect(crossesCheckpoint(at(0.1), at(-0.1), cp, S)).toBe(false);
  });

  it('is false beside the segment or short of it', () => {
    expect(crossesCheckpoint(at(-0.1, 1), at(0.1, 1), cp, S)).toBe(false);
    expect(crossesCheckpoint(at(-0.2), at(-0.1), cp, S)).toBe(false);
    expect(crossesCheckpoint(at(0), at(0), cp, S)).toBe(false);
  });
});

describe('state machine', () => {
  it('goes loading > generating > countdown > racing > finished', () => {
    const r = rig({}, layout, false);
    expect(r.race.state).toBe('loading');
    r.race.beginGenerating();
    expect(r.race.state).toBe('generating');
    r.race.startCountdown();
    expect(r.race.state).toBe('countdown');
    r.hold(3);
    expect(r.race.state).toBe('racing');
    r.drive(lapPath());
    expect(r.race.state).toBe('finished');
    expect(r.log).toEqual([
      'loading>generating',
      'generating>countdown',
      'countdown>racing',
      'racing>finished',
    ]);
  });

  it('pauses and resumes from the countdown and from the race', () => {
    const r = rig();
    r.race.pause();
    expect(r.race.state).toBe('paused');
    r.race.resume();
    expect(r.race.state).toBe('countdown');
    r.hold(3);
    r.race.pause();
    expect(r.race.state).toBe('paused');
    r.race.togglePause();
    expect(r.race.state).toBe('racing');
    expect(r.log).toEqual([
      'loading>generating',
      'generating>countdown',
      'countdown>paused',
      'paused>countdown',
      'countdown>racing',
      'racing>paused',
      'paused>racing',
    ]);
  });

  it('cannot pause while loading or finished', () => {
    const r = rig({}, layout, false);
    r.race.pause();
    expect(r.race.state).toBe('loading');
    r.race.beginGenerating();
    r.race.startCountdown();
    go(r);
    r.drive(lapPath());
    expect(r.race.state).toBe('finished');
    r.race.pause();
    expect(r.race.state).toBe('finished');
  });

  it('freezes the countdown and the race time while paused', () => {
    const r = rig();
    r.hold(1.5);
    r.race.pause();
    r.hold(5);
    r.race.resume();
    expect(r.race.state).toBe('countdown');
    r.hold(1.4);
    expect(r.race.state).toBe('countdown');
    r.hold(0.2);
    expect(r.race.state).toBe('racing');
    r.hold(2);
    const t = r.race.time;
    r.race.pause();
    r.hold(10);
    expect(r.race.time).toBe(t);
    expect(r.race.controllerEnabled).toBe(false);
  });
});

describe('countdown', () => {
  it('ticks 3, 2, 1, 0 once per step interval and enables the controller at GO', () => {
    const r = rig();
    expect(r.events.countdownTick.map((e) => e.value)).toEqual([3]);
    const enabledAt: number[] = [];
    let t = 0;
    while (r.race.state === 'countdown') {
      const a = r.race.step(DT, sample(start.position));
      t += DT;
      if (a.controllerEnabled) enabledAt.push(t);
    }
    expect(r.events.countdownTick.map((e) => e.value)).toEqual([3, 2, 1, 0]);
    expect(t).toBeCloseTo(3, 6);
    // Enabled from the step that reaches GO (the game applies it to the next step).
    expect(enabledAt).toHaveLength(1);
    expect(enabledAt[0]).toBeCloseTo(3, 6);
    expect(r.race.step(DT, sample(start.position)).controllerEnabled).toBe(true);
    expect(r.race.raceTime).toBeCloseTo(DT, 9);
  });

  it('holds the controller disabled during the countdown', () => {
    const r = rig();
    for (let i = 0; i < 170; i++) {
      expect(r.race.step(DT, sample(start.position)).controllerEnabled).toBe(false);
    }
    expect(r.race.raceTime).toBe(0);
  });

  it('honours the configured step duration', () => {
    const r = rig({ countdownStepSeconds: 0.5 });
    r.hold(1.4);
    expect(r.race.state).toBe('countdown');
    r.hold(0.2);
    expect(r.race.state).toBe('racing');
    expect(r.events.countdownTick.map((e) => e.value)).toEqual([3, 2, 1, 0]);
  });

  it('disables the controller again when the race finishes', () => {
    const r = rig();
    go(r);
    const a = r.drive(lapPath());
    expect(r.race.state).toBe('finished');
    expect(a.controllerEnabled).toBe(false);
  });
});

describe('start', () => {
  it('does not count the start position as a lap or a checkpoint', () => {
    const r = rig();
    go(r);
    r.hold(5);
    expect(r.race.state).toBe('racing');
    expect(r.events.checkpoint).toEqual([]);
    expect(r.events.lap).toEqual([]);
    expect(r.race.checkpointsPassed).toBe(0);
  });

  it('begins the first lap at checkpoint 0 and finishes at the line', () => {
    const r = rig();
    go(r);
    r.drive(lapPath());
    expect(r.events.checkpoint.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(r.events.lap).toHaveLength(1);
    expect(r.events.finished).toHaveLength(1);
  });
});

describe('checkpoints', () => {
  /** A lap path where the points near checkpoint `skip` are moved well off the road, so the
   * car passes the checkpoint line "around" its end. */
  function cutAround(skip: number): P[] {
    const cp = layout.checkpoints[skip]!;
    const cx = cp.position.x * S;
    const cz = cp.position.z * S;
    const sx = (cp.b.x - cp.a.x) * S;
    const sz = (cp.b.z - cp.a.z) * S;
    const sl = Math.hypot(sx, sz);
    return lapPath().map((p) =>
      Math.hypot(p.x - cx, p.z - cz) < 3 ? { x: p.x + (sx / sl) * 6, z: p.z + (sz / sl) * 6 } : p,
    );
  }

  it('only counts the next expected checkpoint, in order', () => {
    const r = rig();
    go(r);
    r.drive(lapPath());
    expect(r.events.checkpoint.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(r.events.checkpoint.map((c) => c.lap)).toEqual([1, 1, 1, 1]);
  });

  it('does not finish when a checkpoint is skipped (corner cut across the grass)', () => {
    const r = rig();
    go(r);
    r.drive(cutAround(1));
    expect(r.events.checkpoint.map((c) => c.index)).toEqual([0]);
    expect(r.race.state).toBe('racing');
    expect(r.race.checkpointsPassed).toBe(1);
    expect(r.events.finished).toEqual([]);
    // Crossing the finish line without checkpoints 1 and 2 does nothing either, and a clean
    // second pass round the loop completes the race.
    r.drive(lapPath());
    expect(r.race.state).toBe('finished');
    expect(r.events.checkpoint.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('does not finish when the last checkpoint is skipped', () => {
    const r = rig();
    go(r);
    r.drive(cutAround(layout.checkpoints.length - 1));
    expect(r.events.checkpoint.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(r.race.state).toBe('racing');
  });

  it('ignores backwards crossings', () => {
    const r = rig();
    go(r);
    const path = lapPath();
    let i = 0;
    while (r.race.checkpointsPassed < 1) r.race.step(DT, sample(path[i++]!));
    // Back over checkpoint 0 and further: nothing changes.
    for (let k = i - 1; k >= i - 40; k--) r.race.step(DT, sample(path[k]!));
    expect(r.race.checkpointsPassed).toBe(1);
    expect(r.events.checkpoint).toHaveLength(1);
    // Forward again: checkpoint 0 is not counted twice, checkpoint 1 is.
    for (let k = i - 40; k < path.length && r.race.checkpointsPassed < 2; k++) {
      r.race.step(DT, sample(path[k]!));
    }
    expect(r.events.checkpoint.map((c) => c.index)).toEqual([0, 1]);
  });

  it('does not count a driver going round the loop the wrong way', () => {
    const r = rig();
    go(r);
    r.drive([...lapPath()].reverse());
    expect(r.events.checkpoint).toEqual([]);
    expect(r.race.state).toBe('racing');
  });

  it('records increasing split times', () => {
    const r = rig();
    go(r);
    r.drive(lapPath());
    const times = r.events.checkpoint.map((c) => c.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[times.length - 1]).toBeCloseTo(r.events.finished[0]!.totalTime, 9);
  });
});

describe('laps', () => {
  it('counts laps with laps: 2', () => {
    const r = rig({ laps: 2 });
    go(r);
    const two = lapPath(layout, 2);
    const half = Math.floor(two.length / 2);
    // Run until the first lap has completed.
    let i = 0;
    while (r.events.lap.length < 1) r.race.step(DT, sample(two[i++]!));
    expect(r.race.state).toBe('racing');
    expect(r.race.lap).toBe(2);
    expect(r.race.checkpointsPassed).toBe(0);
    expect(i).toBeLessThanOrEqual(half + 10);
    r.drive(two.slice(i));
    expect(r.race.state).toBe('finished');
    expect(r.events.lap.map((l) => l.lap)).toEqual([1, 2]);
    expect(r.events.checkpoint.map((c) => `${c.lap}:${c.index}`)).toEqual([
      '1:0',
      '1:1',
      '1:2',
      '1:3',
      '2:0',
      '2:1',
      '2:2',
      '2:3',
    ]);
    const result = r.events.finished[0]!;
    expect(result.laps).toBe(2);
    expect(result.lapTimes).toHaveLength(2);
    expect(result.lapTimes[0]! + result.lapTimes[1]!).toBeCloseTo(result.totalTime, 9);
  });

  it('the first crossing of the finish line after the lap is a new lap only after all checkpoints', () => {
    const r = rig({ laps: 2 });
    go(r);
    r.drive(lapPath(layout, 1));
    expect(r.race.state).toBe('racing');
    expect(r.race.lap).toBe(2);
  });
});

describe('timing', () => {
  it('uses simulation time (the sum of dt), not the wall clock', () => {
    let wall = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => (wall += 777));
    vi.spyOn(Date, 'now').mockImplementation(() => (wall += 12345));
    const run = () => {
      const r = rig();
      go(r);
      r.hold(2.5);
      return r.race.time;
    };
    const t1 = run();
    wall += 1e9;
    const t2 = run();
    expect(t1).toBeCloseTo(150 * DT, 9);
    expect(t2).toBe(t1);
  });

  it('a finished race has a total of dt times steps from GO plus penalties', () => {
    const r = rig();
    go(r);
    const path = lapPath();
    r.drive(path);
    const result = r.events.finished[0]!;
    expect(result.totalTime / DT).toBeGreaterThan(path.length * 0.8);
    expect(result.totalTime / DT).toBeLessThanOrEqual(path.length);
    expect(result.totalTime).toBeCloseTo(Math.round(result.totalTime / DT) * DT, 9);
  });

  it('puts the seed, controller and a timestamp into the result', () => {
    const r = rig();
    go(r);
    r.drive(lapPath());
    const result = r.events.finished[0]!;
    expect(result.seed).toBe(layout.seed);
    expect(result.controller).toBe('test');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    expect(r.race.result).toEqual(result);
    expect(result.resets).toBe(0);
    expect(result.offTrackTime).toBe(0);
  });
});

describe('resets', () => {
  it('moves the car to the start pose before the first checkpoint, with a penalty', () => {
    const r = rig();
    go(r);
    r.hold(1);
    const before = r.race.time;
    r.race.requestReset();
    const a = r.hold(DT);
    expect(a.resetTo).toEqual(start);
    expect(r.events.reset).toEqual([{ reason: 'manual', penalty: 2 }]);
    expect(r.race.resets).toBe(1);
    expect(r.race.time).toBeCloseTo(before + DT + 2, 9);
    expect(r.race.raceTime).toBeCloseTo(before + DT, 9);
  });

  it('resets to the last passed checkpoint, centred and along its normal', () => {
    const r = rig();
    go(r);
    const path = lapPath();
    let i = 0;
    while (r.race.checkpointsPassed < 2) r.race.step(DT, sample(path[i++]!));
    r.race.requestReset();
    const a = r.race.step(DT, sample(path[i]!));
    const cp = layout.checkpoints[1]!;
    expect(a.resetTo).toEqual(checkpointPose(cp, S));
    expect(a.resetTo!.position.x).toBeCloseTo(cp.position.x * S, 9);
    expect(a.resetTo!.position.z).toBeCloseTo(cp.position.z * S, 9);
    const h = a.resetTo!.heading;
    expect(Math.sin(h)).toBeCloseTo(cp.normal.x, 9);
    expect(-Math.cos(h)).toBeCloseTo(cp.normal.z, 9);
    expect(r.race.checkpointsPassed).toBe(2);
  });

  it('does not count the teleport as a crossing, and the race can still be finished', () => {
    const r = rig();
    go(r);
    const path = lapPath();
    let i = 0;
    while (r.race.checkpointsPassed < 1) r.race.step(DT, sample(path[i++]!));
    r.race.requestReset();
    r.race.step(DT, sample(path[i++]!));
    // The next sample is the car at the reset pose, far from where it was.
    const pose = layout.checkpoints[0]!.position;
    r.race.step(DT, sample({ x: pose.x * S, z: pose.z * S }));
    expect(r.race.checkpointsPassed).toBe(1);
    r.drive(path.slice(i));
    expect(r.race.state).toBe('finished');
    expect(r.events.finished[0]!.resets).toBe(1);
    expect(r.events.finished[0]!.totalTime).toBeGreaterThan(2);
  });

  it('uses the configured penalty and counts every reset', () => {
    const r = rig({ resetPenaltySeconds: 5 });
    go(r);
    for (let k = 0; k < 3; k++) {
      r.race.requestReset();
      r.hold(DT);
    }
    expect(r.race.resets).toBe(3);
    expect(r.race.time).toBeCloseTo(3 * DT + 15, 9);
    expect(r.events.reset.map((e) => e.penalty)).toEqual([5, 5, 5]);
  });

  it('ignores reset requests outside the race', () => {
    const r = rig();
    r.race.requestReset();
    r.hold(3.1);
    expect(r.race.resets).toBe(0);
    r.race.pause();
    r.race.requestReset();
    r.race.resume();
    r.hold(0.5);
    expect(r.race.resets).toBe(0);
  });

  it('resets on out-of-bounds with the same penalty', () => {
    const r = rig();
    go(r);
    const a = r.hold(DT, { x: 0, z: 0 }, { outOfBounds: true });
    expect(a.resetTo).toEqual(start);
    expect(r.events.reset).toEqual([{ reason: 'outOfBounds', penalty: 2 }]);
  });

  it('resets a flipped car only after flipResetSeconds', () => {
    const r = rig();
    go(r);
    r.hold(1.9, undefined, { upY: 0.1 });
    expect(r.race.resets).toBe(0);
    r.hold(0.2, undefined, { upY: 0.1 });
    expect(r.race.resets).toBe(1);
    expect(r.events.reset).toEqual([{ reason: 'flipped', penalty: 2 }]);
  });

  it('returns the reset pose on the step that triggers a flip reset', () => {
    const r = rig();
    go(r);
    let pose: RaceActions['resetTo'] = null;
    for (let i = 0; i < 130; i++) {
      const a = r.race.step(DT, sample(start.position, { upY: -1 }));
      if (a.resetTo) pose = a.resetTo;
    }
    expect(pose).toEqual(start);
    expect(r.race.resets).toBe(1);
  });

  it('forgives a flip that rights itself', () => {
    const r = rig();
    go(r);
    r.hold(1.5, undefined, { upY: 0.1 });
    r.hold(0.1, undefined, { upY: 0.9 });
    r.hold(1.5, undefined, { upY: 0.1 });
    expect(r.race.resets).toBe(0);
  });
});

describe('off-track time', () => {
  it('accumulates on grass, sand and no ground while racing only', () => {
    const r = rig();
    r.hold(1, undefined, { surface: 'grass' }); // countdown: not counted
    expect(r.race.offTrackTime).toBe(0);
    r.hold(1.9, undefined, { surface: 'grass' });
    go(r);
    const surfaces: (SurfaceType | null)[] = ['road', 'kerb', 'wall'];
    for (const s of surfaces) r.hold(1, undefined, { surface: s });
    expect(r.race.offTrackTime).toBe(0);
    r.hold(1, undefined, { surface: 'grass' });
    r.hold(0.5, undefined, { surface: 'sand' });
    r.hold(0.25, undefined, { surface: null });
    expect(r.race.offTrackTime).toBeCloseTo(1.75, 6);
  });

  it('is part of the result', () => {
    const r = rig();
    go(r);
    r.hold(1, undefined, { surface: 'grass' });
    r.drive(lapPath());
    expect(r.events.finished[0]!.offTrackTime).toBeCloseTo(1, 6);
  });
});

describe('progress', () => {
  it('exposes the track progress every step', () => {
    const r = rig();
    expect(r.race.progress).toBeNull();
    r.hold(0.1);
    const p = r.race.progress!;
    expect(p.distanceAlong).toBeGreaterThan(0);
    expect(Math.abs(p.lateralOffset)).toBeLessThan(1e-6);
  });
});

describe('generated tracks (shape independent)', () => {
  it('crossing every checkpoint in order finishes the race, seeds 1 to 10', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const lay = generateTrack(seed);
      const r = rig({}, lay);
      r.hold(3);
      r.drive(lapPath(lay));
      expect(r.race.state, `seed ${seed}`).toBe('finished');
      expect(r.events.checkpoint.map((c) => c.index)).toEqual(lay.checkpoints.map((c) => c.index));
    }
  });

  it('skipping any one checkpoint does not finish the race, seeds 1 to 10', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const lay = generateTrack(seed);
      const skip = Math.floor(lay.checkpoints.length / 2);
      const cp = lay.checkpoints[skip]!;
      const cx = cp.position.x * S;
      const cz = cp.position.z * S;
      const sx = (cp.b.x - cp.a.x) * S;
      const sz = (cp.b.z - cp.a.z) * S;
      const sl = Math.hypot(sx, sz);
      const path = lapPath(lay).map((p) =>
        Math.hypot(p.x - cx, p.z - cz) < 3 ? { x: p.x + (sx / sl) * 6, z: p.z + (sz / sl) * 6 } : p,
      );
      const r = rig({}, lay);
      r.hold(3);
      r.drive(path);
      expect(r.race.state, `seed ${seed}`).toBe('racing');
      expect(r.race.checkpointsPassed).toBe(skip);
    }
  });
});
