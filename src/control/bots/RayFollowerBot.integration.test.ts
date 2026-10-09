/**
 * The bot on generated tracks with the real pipeline: Rapier car, `buildTrack` (stub models),
 * sensor, `Race` and `ControllerHost`, realtime with sync decisions at 10 Hz. A test-only
 * pure-pursuit driver (which reads the layout, unlike the bot) runs the same seeds for the
 * lap-time comparison. Set `BOT_SEEDS=n` for another number of seeds (default 20) and
 * `BOT_REPORT=1` to print the per-seed numbers.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { CarPhysics } from '../../car/CarPhysics';
import { maxSteerAngle } from '../../car/control';
import { DEFAULT_CONFIG, type ControlMode } from '../../core/config';
import { Race, startPoseMetres } from '../../race/Race';
import { RayConeSensor } from '../../sensors/RayConeSensor';
import { buildTrack, type LoadModelFn } from '../../track/builder';
import { generateTrack } from '../../track/generator';
import { ControllerHost, HOLD_INPUT } from '../ControllerHost';
import { isObservation, buildObservation, type CarController } from '../types';
import { RemoteController } from '../RemoteController';
import { startMockServer } from '../../../tools/mock-ai-server';
import { RayFollowerBot } from './RayFollowerBot';

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
const S = DEFAULT_CONFIG.worldScale;
const loadModel: LoadModelFn = async (_n, scale) => {
  const g = new THREE.Group();
  g.scale.setScalar(scale);
  return g;
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface RaceOutcome {
  finished: boolean;
  /** Simulated seconds to finish (or until the limit), without penalties. */
  seconds: number;
  /** Race time including penalties, if finished. */
  totalTime: number | null;
  resets: number;
  offTrack: number;
  invalidObservations: number;
}

type MakeController = (ctx: {
  race: Race;
  car: CarPhysics;
  layout: ReturnType<typeof generateTrack>;
}) => { controller: CarController; hz: number };

export async function runRace(
  seed: number,
  make: MakeController,
  limitSeconds: number,
  mode: ControlMode = 'realtime',
): Promise<RaceOutcome> {
  const layout = generateTrack(seed);
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const track = await buildTrack(layout, scene, world, { loadModel });
  const car = new CarPhysics(world, DEFAULT_CONFIG, track.surfaceAt);
  const race = new Race({
    layout,
    worldScale: S,
    config: DEFAULT_CONFIG.race,
    controller: 'test',
  });
  const sensor = new RayConeSensor({
    world,
    track,
    config: DEFAULT_CONFIG.sensor,
    ownBody: car.body,
  });
  race.beginGenerating();
  car.resetTo(startPoseMetres(layout, S));
  race.startCountdown();

  const { controller, hz } = make({ race, car, layout });
  const host = new ControllerHost(controller, {
    decisionHz: hz,
    mode,
    neutral: DEFAULT_CONFIG.car.neutral,
  });
  host.enabled = false;
  let invalid = 0;
  let simTime = 0;
  const maxSteps = Math.floor(limitSeconds / DT) + 4 * 60;
  for (let step = 0; step < maxSteps && race.state !== 'finished'; step++) {
    // Lockstep: wait (in wall-clock time) for a pending decision, like the game loop does.
    while (host.blocking) await new Promise((r) => setTimeout(r, 0));
    host.step(simTime, () => {
      const st = car.getState();
      const o = buildObservation(
        race.raceTime,
        st,
        race.progress,
        {
          checkpoint: race.checkpointsPassed,
          totalCheckpoints: race.checkpointCount,
          lap: race.lap,
          totalLaps: race.laps,
        },
        sensor.sense(st),
      );
      if (!isObservation(o)) invalid++;
      return o;
    });
    car.setInput(host.enabled ? host.input : HOLD_INPUT);
    car.update(DT);
    world.step();
    simTime += DT;
    const s = car.getState();
    const actions = race.step(DT, {
      position: s.position,
      heading: s.heading,
      upY: car.upY(),
      surface: s.surface,
      outOfBounds: track.isOutOfBounds(s.position),
    });
    host.enabled = actions.controllerEnabled;
    if (actions.resetTo) {
      car.resetTo(actions.resetTo);
      host.reset();
    }
    if (race.raceTime > limitSeconds) break;
  }
  const out: RaceOutcome = {
    finished: race.state === 'finished',
    seconds: race.raceTime,
    totalTime: race.result?.totalTime ?? null,
    resets: race.resets,
    offTrack: race.offTrackTime,
    invalidObservations: invalid,
  };
  car.dispose();
  track.dispose();
  return out;
}

/** Test-only pure-pursuit driver on the centreline (reads the layout and the race progress). */
const pursuit: MakeController = ({ race, car, layout }) => {
  const cl = layout.centreline;
  const pts = cl.points.map((p) => ({ x: p.x * S, z: p.z * S }));
  const n = pts.length;
  const spacing = (cl.totalLength * S) / n;
  const wheelBase = DEFAULT_CONFIG.car.frontAxleZ - DEFAULT_CONFIG.car.rearAxleZ;
  const headings = cl.tangent.map((t) => Math.atan2(t.x, -t.z));
  const curv = headings.map((_, i) => {
    const a = headings[(i - 2 + n) % n] as number;
    const b = headings[(i + 2) % n] as number;
    return Math.abs(wrap(b - a)) / (4 * spacing);
  });
  return {
    hz: 60,
    controller: {
      name: 'pursuit',
      decide: () => {
        const s = car.getState();
        const here = race.progress?.nearestIndex ?? 0;
        const look = Math.max(5, 3 + 0.7 * Math.abs(s.speed));
        const target = pts[(here + Math.round(look / spacing)) % n] as { x: number; z: number };
        const alpha = wrap(
          Math.atan2(target.x - s.position.x, -(target.z - s.position.z)) - s.heading,
        );
        const ld = Math.hypot(target.x - s.position.x, target.z - s.position.z);
        const delta = Math.atan((2 * wheelBase * Math.sin(alpha)) / Math.max(ld, 1));
        const steering = delta / maxSteerAngle(s.speed, DEFAULT_CONFIG.car);
        let kmax = 0;
        const ahead = Math.ceil((8 + 1.2 * Math.abs(s.speed)) / spacing);
        for (let j = 0; j <= ahead; j++) kmax = Math.max(kmax, curv[(here + j) % n] as number);
        const vTarget = Math.min(30, Math.max(3.5, Math.sqrt(13 / Math.max(kmax, 1e-3))));
        const err = vTarget - s.speed;
        const accelerator =
          err > 0 ? 0.5 + Math.min(0.5, err * 0.5) : Math.max(0, 0.5 + err * 0.25);
        return { accelerator, steering };
      },
    },
  };
};

const bot: MakeController = () => ({
  hz: DEFAULT_CONFIG.decisionHz.bot,
  controller: new RayFollowerBot({ neutral: DEFAULT_CONFIG.car.neutral }),
});

const SEED_COUNT = Number(process.env.BOT_SEEDS ?? 20);
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);
const report = Boolean(process.env.BOT_REPORT);

describe('RayFollowerBot on generated tracks', () => {
  it(`finishes a 1-lap race on most of ${SEED_COUNT} seeds, using only valid observations`, async () => {
    const rows: string[] = [];
    let finished = 0;
    let invalid = 0;
    for (const seed of SEEDS) {
      const layout = generateTrack(seed);
      // Generous limit: the lap at an average of 3 m/s, plus a minute.
      const limit = (layout.centreline.totalLength * S) / 3 + 60;
      const b = await runRace(seed, bot, limit);
      if (b.finished) finished++;
      invalid += b.invalidObservations;
      if (report) {
        const pp = await runRace(seed, pursuit, limit);
        rows.push(
          `seed ${seed}: ${(layout.centreline.totalLength * S).toFixed(0)} m | bot ${b.finished ? b.seconds.toFixed(1) + ' s' : 'DNF'} resets ${b.resets} off ${b.offTrack.toFixed(1)} s | pursuit ${pp.finished ? pp.seconds.toFixed(1) + ' s' : 'DNF'} resets ${pp.resets}`,
        );
      }
    }
    if (report) console.info(rows.join('\n') + `\nbot finished ${finished}/${SEED_COUNT}`);
    expect(invalid).toBe(0);
    expect(finished / SEED_COUNT).toBeGreaterThanOrEqual(0.8);
  }, 600_000);
});

describe('RemoteController against the real mock AI server (lockstep, Node fetch)', () => {
  for (const choices of [false, true]) {
    it(`finishes a lap with ${choices ? 'discrete choices' : 'continuous answers'}`, async () => {
      const server = await startMockServer({ port: 0, latencyMs: 0, choices });
      try {
        const seed = 3;
        const layout = generateTrack(seed);
        const limit = (layout.centreline.totalLength * S) / 3 + 60;
        const make: MakeController = () => ({
          hz: DEFAULT_CONFIG.decisionHz.remote,
          controller: new RemoteController({
            url: `http://localhost:${server.port}`,
            neutral: DEFAULT_CONFIG.car.neutral,
          }),
        });
        const r = await runRace(seed, make, limit, 'lockstep');
        expect(r.invalidObservations).toBe(0);
        expect(r.finished).toBe(true);
        expect(r.resets).toBe(0);
      } finally {
        await server.close();
      }
    }, 120_000);
  }
});
