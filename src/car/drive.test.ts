import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { buildTrack, type LoadModelFn } from '../track/builder';
import { generateTrack } from '../track/generator';
import type { TrackLayout } from '../track/layout';
import { CarPhysics } from './CarPhysics';
import { maxSteerAngle } from './control';

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

/** Lateral acceleration (m/s2) the driver allows itself in corners. */
const LATERAL_ACCEL = 13;

/** Seeds used for the lap test; at least one has a small corner (checked below). */
const SEEDS = [1, 2, 3, 4, 5];
const hasSmallCorner = (l: TrackLayout) => l.pieces.some((p) => p.tileId === 'roadCornerSmall');

interface LapResult {
  finished: boolean;
  time: number;
  minUp: number;
  roadFraction: number;
  outOfBounds: boolean;
  topSpeed: number;
}

/**
 * Test-only pure-pursuit driver on the centreline: steers at a point a speed-dependent
 * distance ahead, and slows down for the sharpest curvature in the next stretch of road.
 */
async function driveLap(seed: number, limitSeconds: number): Promise<LapResult> {
  const layout = generateTrack(seed);
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const track = await buildTrack(layout, scene, world, { loadModel });
  const car = new CarPhysics(world, DEFAULT_CONFIG, track.surfaceAt);
  const sp = layout.startPose;
  car.resetTo({ position: { x: sp.position.x * S, z: sp.position.z * S }, heading: sp.heading });

  const cl = layout.centreline;
  const pts = cl.points.map((p) => ({ x: p.x * S, z: p.z * S }));
  const n = pts.length;
  const spacing = (cl.totalLength * S) / n;
  const wheelBase = DEFAULT_CONFIG.car.frontAxleZ - DEFAULT_CONFIG.car.rearAxleZ;
  // Curvature at each point from the tangent change over ~2 points either side.
  const headings = cl.tangent.map((t) => Math.atan2(t.x, -t.z));
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const curv = headings.map((_, i) => {
    const a = headings[(i - 2 + n) % n] as number;
    const b = headings[(i + 2) % n] as number;
    return Math.abs(wrap(b - a)) / (4 * spacing);
  });

  // Start near the beginning of the loop: find the closest centreline point.
  let idx = 0;
  let best = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - sp.position.x * S, p.z - sp.position.z * S);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  const startIdx = idx;
  let progress = 0; // unwrapped number of points advanced since the start
  const maxSteps = Math.floor(limitSeconds / DT);
  let roadSteps = 0;
  let minUp = 1;
  let topSpeed = 0;
  let outOfBounds = false;
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    const s = car.getState();
    const px = s.position.x;
    const pz = s.position.z;
    // Advance the nearest point (search a short window ahead, never backwards).
    let bestD = Infinity;
    let bestJ = 0;
    for (let j = 0; j <= 30; j++) {
      const p = pts[(startIdx + progress + j) % n] as { x: number; z: number };
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    progress += bestJ;
    if (progress >= n) break;
    const here = (startIdx + progress) % n;

    // Look-ahead target and speed from the curvature ahead.
    const look = Math.max(5, 3 + 0.7 * Math.abs(s.speed));
    const target = pts[(here + Math.round(look / spacing)) % n] as { x: number; z: number };
    const alpha = wrap(Math.atan2(target.x - px, -(target.z - pz)) - s.heading);
    const ld = Math.hypot(target.x - px, target.z - pz);
    const delta = Math.atan((2 * wheelBase * Math.sin(alpha)) / Math.max(ld, 1));
    const steering = delta / maxSteerAngle(s.speed, DEFAULT_CONFIG.car);

    let kmax = 0;
    const aheadPts = Math.ceil((8 + 1.2 * Math.abs(s.speed)) / spacing);
    for (let j = 0; j <= aheadPts; j++) kmax = Math.max(kmax, curv[(here + j) % n] as number);
    const vTarget = Math.min(30, Math.max(3.5, Math.sqrt(LATERAL_ACCEL / Math.max(kmax, 1e-3))));
    const err = vTarget - s.speed;
    const accelerator = err > 0 ? 0.5 + Math.min(0.5, err * 0.5) : Math.max(0, 0.5 + err * 0.25);

    car.setInput({ accelerator, steering });
    car.update(DT);
    world.step();

    const after = car.getState();
    if (after.surface === 'road' || after.surface === 'kerb') roadSteps++;
    minUp = Math.min(minUp, car.upY());
    topSpeed = Math.max(topSpeed, after.speed);
    if (track.isOutOfBounds(after.position)) {
      outOfBounds = true;
      break;
    }
  }
  const result: LapResult = {
    finished: progress >= n,
    time: steps * DT,
    minUp,
    roadFraction: roadSteps / Math.max(1, steps),
    outOfBounds,
    topSpeed,
  };
  car.dispose();
  track.dispose();
  return result;
}

describe('drivability (pure-pursuit driver on generated tracks)', () => {
  it('the chosen seeds include a track with a small corner', () => {
    expect(SEEDS.some((s) => hasSmallCorner(generateTrack(s)))).toBe(true);
  });

  for (const seed of SEEDS) {
    it(`completes a lap on seed ${seed}`, async () => {
      const layout = generateTrack(seed);
      // Measured laps average about 8 m/s along the centreline; the limit asks for 5.5 m/s (~50 % headroom).
      const limit = (layout.centreline.totalLength * S) / 5.5 + 2;
      const r = await driveLap(seed, limit);
      if (process.env.LAP_REPORT) {
        console.info(
          `seed ${seed}: ${layout.pieces.length} pieces, ${(layout.centreline.totalLength * S).toFixed(0)} m, small=${hasSmallCorner(layout)}, ` +
            `lap ${r.time.toFixed(1)} s, road ${(r.roadFraction * 100).toFixed(1)} %, top ${r.topSpeed.toFixed(1)} m/s, minUp ${r.minUp.toFixed(2)}`,
        );
      }
      expect(r.outOfBounds).toBe(false);
      expect(r.finished).toBe(true);
      expect(r.minUp).toBeGreaterThan(0.7);
      expect(r.roadFraction).toBeGreaterThanOrEqual(0.8);
    });
  }
});
