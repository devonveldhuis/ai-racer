import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { CarPhysics } from '../car/CarPhysics';
import { maxSteerAngle } from '../car/control';
import { ControllerHost, HOLD_INPUT } from '../control/ControllerHost';
import { blankObservation } from '../control/testObservation';
import type { CarController } from '../control/types';
import { DEFAULT_CONFIG } from '../core/config';
import { buildTrack, type LoadModelFn } from '../track/builder';
import { Race, startPoseMetres } from './Race';
import { rectLayout } from './testLayouts';

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
const LATERAL_ACCEL = 13;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('race with the real car (scripted pure-pursuit driver)', () => {
  it('completes a 1-lap race and produces a plausible result', async () => {
    const layout = rectLayout();
    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    const track = await buildTrack(layout, scene, world, { loadModel });
    const car = new CarPhysics(world, DEFAULT_CONFIG, track.surfaceAt);
    const race = new Race({
      layout,
      worldScale: S,
      config: DEFAULT_CONFIG.race,
      controller: 'scripted',
    });
    const events: string[] = [];
    race.events.on('countdownTick', (e) => events.push(`tick${e.value}`));
    race.events.on('checkpoint', (e) => events.push(`cp${e.index}`));
    race.events.on('lap', () => events.push('lap'));

    race.beginGenerating();
    car.resetTo(startPoseMetres(layout, S));
    race.startCountdown();

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

    // The driver only uses what a controller would see, plus the race's progress.
    const driver: CarController = {
      name: 'scripted',
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
        const vTarget = Math.min(
          30,
          Math.max(3.5, Math.sqrt(LATERAL_ACCEL / Math.max(kmax, 1e-3))),
        );
        const err = vTarget - s.speed;
        const accelerator =
          err > 0 ? 0.5 + Math.min(0.5, err * 0.5) : Math.max(0, 0.5 + err * 0.25);
        return { accelerator, steering };
      },
    };
    const host = new ControllerHost(driver, { decisionHz: 60 });
    host.enabled = false;

    let simTime = 0;
    let heldMoved = 0;
    const startPos = car.getState().position;
    for (let step = 0; step < 60 * 120 && race.state !== 'finished'; step++) {
      host.step(simTime, () => blankObservation(simTime));
      car.setInput(host.enabled ? host.input : HOLD_INPUT);
      car.update(DT);
      world.step();
      simTime += DT;
      const s = car.getState();
      if (race.state === 'countdown') {
        heldMoved = Math.max(
          heldMoved,
          Math.hypot(s.position.x - startPos.x, s.position.z - startPos.z),
        );
      }
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
    }

    expect(race.state).toBe('finished');
    const result = race.result!;
    expect(heldMoved).toBeLessThan(0.5); // the car sat on the line during the countdown
    expect(events.slice(0, 4)).toEqual(['tick3', 'tick2', 'tick1', 'tick0']);
    expect(events.slice(4)).toEqual(['cp0', 'cp1', 'cp2', 'cp3', 'lap']);
    expect(result.laps).toBe(1);
    expect(result.lapTimes).toHaveLength(1);
    expect(result.lapTimes[0]).toBeCloseTo(result.totalTime, 9);
    // The loop is about cl.totalLength * S metres; the driver averages 5.5 to 25 m/s.
    const lapMetres = cl.totalLength * S;
    expect(result.totalTime).toBeGreaterThan(lapMetres / 40);
    expect(result.totalTime).toBeLessThan(lapMetres / 4 + 2 * result.resets + 5);
    expect(result.resets).toBe(0);
    expect(result.offTrackTime).toBeLessThan(result.totalTime * 0.25);
    expect(result.seed).toBe(layout.seed);
    expect(result.controller).toBe('scripted');

    car.dispose();
    track.dispose();
  }, 60_000);
});
