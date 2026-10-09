import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CarState } from '../car/types';
import { buildObservation, isObservation, type RaySample } from '../control/types';
import { DEFAULT_CONFIG, type SensorConfig } from '../core/config';
import { buildTrack, type BuiltTrack, type LoadModelFn } from '../track/builder';
import { generateTrack } from '../track/generator';
import { dirHeading, type TrackLayout } from '../track/layout';
import { surfaceAtGrid } from '../track/surface';
import { startPoseMetres } from '../race/Race';
import { RayConeSensor } from './RayConeSensor';
import { FIRST_CORNER, runUpLayout } from './testLayouts';

beforeAll(async () => {
  await RAPIER.init();
});

const S = 4;
const sensorCfg: SensorConfig = DEFAULT_CONFIG.sensor;

function carState(x: number, z: number, heading: number, y = 0.2): CarState {
  return {
    position: { x, y, z },
    heading,
    speed: 12.3456,
    surface: 'road',
    wheelSurfaces: ['road', 'road', 'road', 'road'],
    input: { accelerator: 0.75, steering: -0.2 },
    steerAngle: 0,
  };
}

/** A track stub over a hand-built layout, with one big tagged ground collider. */
function stubWorld(layout: TrackLayout) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0),
  );
  const track = {
    layout,
    worldScale: S,
    surfaceAt: (x: number, z: number) => surfaceAtGrid(layout, x / S, z / S, 3),
    colliderKind: (h: number) => (h === ground.handle ? ('ground' as const) : undefined),
  };
  return { world, track, ground };
}

function entryOf(layout: TrackLayout, piece: number): { x: number; z: number } {
  const k = layout.centreline.pieceIndex.indexOf(piece);
  const p = layout.centreline.points[k]!;
  return { x: p.x * S, z: p.z * S };
}

const forward = (rays: RaySample[]): RaySample => rays[Math.floor(rays.length / 2)]!;

describe('RayConeSensor ground samples', () => {
  for (const ccw of [false, true]) {
    it(`sees a ${ccw ? 'left' : 'right'} corner ahead before reaching it`, () => {
      const layout = runUpLayout(ccw);
      const { world, track } = stubWorld(layout);
      const sensor = new RayConeSensor({ world, track, config: sensorCfg });
      const entry = entryOf(layout, FIRST_CORNER);
      const heading = dirHeading(layout.pieces[FIRST_CORNER]!.entryDir);
      const want = ccw ? 'left_curve' : 'right_curve';
      // Car on the straight, behind the corner, heading along the track.
      const at = (back: number) => carState(entry.x, entry.z + back, heading);
      const classes = (back: number) => forward(sensor.sense(at(back))).samples.map((s) => s.class);
      // 3 m back: the 5 m sample is 2 m into the corner.
      expect(classes(3)).toEqual([
        want,
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ]);
      // 18 m back: the 20 m sample is 2 m into the corner, the nearer ones are straight.
      expect(classes(18).slice(0, 3)).toEqual(['straight', 'straight', want]);
      // 22 m back (still on the run-up): the 5, 10 and 20 m samples are all straight.
      expect(classes(22).slice(0, 3)).toEqual(['straight', 'straight', 'straight']);
    });
  }

  it('reports the configured samples per ray, left to right', () => {
    const layout = runUpLayout(false);
    const { world, track } = stubWorld(layout);
    const sensor = new RayConeSensor({ world, track, config: sensorCfg });
    const rays = sensor.sense(carState(0, 0, 0));
    expect(rays).toHaveLength(9);
    expect(rays[0]!.angleDeg).toBe(-45);
    expect(rays[8]!.angleDeg).toBe(45);
    for (const r of rays) expect(r.samples.map((s) => s.distance)).toEqual([5, 10, 20, 35]);
  });

  it('supports ?fov=120&rays=15 style configs and a single ray', () => {
    const layout = runUpLayout(false);
    const { world, track } = stubWorld(layout);
    const wide = new RayConeSensor({
      world,
      track,
      config: { ...sensorCfg, fovDeg: 120, rayCount: 15 },
    });
    const rays = wide.sense(carState(0, 0, 0));
    expect(rays).toHaveLength(15);
    expect(rays[0]!.angleDeg).toBe(-60);
    expect(rays[14]!.angleDeg).toBe(60);
    const one = new RayConeSensor({ world, track, config: { ...sensorCfg, rayCount: 1 } });
    expect(one.sense(carState(0, 0, 0)).map((r) => r.angleDeg)).toEqual([0]);
  });
});

describe('RayConeSensor obstacle cast', () => {
  function setup() {
    const layout = runUpLayout(false);
    const s = stubWorld(layout);
    const sensor = new RayConeSensor({ world: s.world, track: s.track, config: sensorCfg });
    return { ...s, sensor };
  }

  it('reports nothing for an empty world (ground is ignored)', () => {
    const { world, sensor } = setup();
    world.step();
    for (const r of sensor.sense(carState(0, 0, 0))) {
      expect(r.obstacleDistance).toBeNull();
      expect(r.obstacleClass).toBeNull();
    }
  });

  it('reports a cuboid tagged as a wall as `wall` at the right distance', () => {
    const { world, sensor } = setup();
    const wall = world.createCollider(
      RAPIER.ColliderDesc.cuboid(5, 1, 0.25).setTranslation(0, 1, -12),
    );
    sensor.wallColliders.add(wall.handle);
    world.step();
    const rays = sensor.sense(carState(0, 0, 0));
    const r = forward(rays);
    expect(r.obstacleClass).toBe('wall');
    expect(Math.abs((r.obstacleDistance as number) - 11.75)).toBeLessThanOrEqual(0.05);
    // A ray 22.5 degrees to the left still reaches the wall (it is 10 m wide), at a longer range.
    expect(rays[2]!.angleDeg).toBe(-22.5);
    expect(
      Math.abs((rays[2]!.obstacleDistance as number) - 11.75 / Math.cos(Math.PI / 8)),
    ).toBeLessThan(0.05);
    // The outermost ray (45 degrees) passes beside the wall.
    expect(rays[0]!.obstacleDistance).toBeNull();
    // Ground samples beyond the obstacle are still reported.
    expect(r.samples).toHaveLength(4);
    expect(r.samples[3]!.distance).toBe(35);
  });

  it('reports an untagged cuboid as `obstacle`', () => {
    const { world, sensor } = setup();
    world.createCollider(RAPIER.ColliderDesc.cuboid(5, 1, 0.25).setTranslation(0, 1, -20));
    world.step();
    const r = forward(sensor.sense(carState(0, 0, 0)));
    expect(r.obstacleClass).toBe('obstacle');
    expect(Math.abs((r.obstacleDistance as number) - 19.75)).toBeLessThanOrEqual(0.05);
  });

  it('ignores obstacles beyond maxRange and uses the car heading', () => {
    const { world, sensor } = setup();
    world.createCollider(RAPIER.ColliderDesc.cuboid(5, 1, 0.25).setTranslation(0, 1, -60));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 1, 5).setTranslation(15, 1, 0));
    world.step();
    // Heading north: the far block is out of range and the east wall is off to the side.
    const north = sensor.sense(carState(0, 0, 0));
    for (const r of north) expect(r.obstacleDistance).toBeNull();
    // Heading east, the east wall is straight ahead at 14.75 m.
    const east = sensor.sense(carState(0, 0, Math.PI / 2));
    expect(Math.abs((forward(east).obstacleDistance as number) - 14.75)).toBeLessThanOrEqual(0.05);
  });

  it("never reports the car's own body", () => {
    const { world, track } = stubWorld(runUpLayout(false));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 2, 2), body);
    world.step();
    const car = carState(0, 0, 0, 0);
    const own = new RayConeSensor({ world, track, config: sensorCfg, ownBody: body });
    for (const r of own.sense(car)) expect(r.obstacleDistance).toBeNull();
    // Without excluding it, the same body is an obstacle.
    const other = new RayConeSensor({ world, track, config: sensorCfg });
    expect(forward(other.sense(car)).obstacleClass).toBe('obstacle');
  });
});

/** Real built track with a stub model loader (no WebGL). */
async function realTrack(seed: number): Promise<{ world: RAPIER.World; track: BuiltTrack }> {
  const geometry = new THREE.BoxGeometry(1, 0.01, 1);
  const material = new THREE.MeshBasicMaterial();
  const loadModel: LoadModelFn = async (_n, scale) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geometry, material));
    g.scale.setScalar(scale);
    return g;
  };
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const track = await buildTrack(generateTrack(seed), new THREE.Scene(), world, {
    loadModel,
    worldScale: S,
    margin: 3,
  });
  return { world, track };
}

describe('RayConeSensor on a built track', () => {
  it('ignores the ground and safety floor, and its output is a valid observation', async () => {
    const { world, track } = await realTrack(5);
    const sensor = new RayConeSensor({ world, track, config: sensorCfg });
    const pose = startPoseMetres(track.layout, S);
    world.step();
    const rays = sensor.sense(carState(pose.position.x, pose.position.z, pose.heading));
    for (const r of rays) expect(r.obstacleDistance).toBeNull();
    expect(forward(rays).samples[0]!.class).not.toBe('void');
    const obs = buildObservation(
      1.23456,
      carState(pose.position.x, pose.position.z, pose.heading),
      { headingError: 0.123456, lateralOffset: -0.98765 },
      { checkpoint: 1, totalCheckpoints: 4, lap: 1, totalLaps: 2 },
      rays,
    );
    expect(isObservation(obs)).toBe(true);
    expect(JSON.parse(JSON.stringify(obs))).toEqual(obs);
    expect(obs.t).toBe(1.235);
    expect(obs.car.speed).toBe(12.35);
    expect(obs.car.headingError).toBe(0.123);
    track.dispose();
  });

  it('senses a full cone quickly (reported, loosely asserted)', async () => {
    const { world, track } = await realTrack(7);
    const sensor = new RayConeSensor({ world, track, config: sensorCfg });
    const pose = startPoseMetres(track.layout, S);
    world.step();
    const times: number[] = [];
    for (let i = 0; i < 1100; i++) {
      // Move the car a little so the samples are not all the same.
      const car = carState(
        pose.position.x,
        pose.position.z - (i % 50),
        pose.heading + (i % 7) / 10,
      );
      const t0 = performance.now();
      sensor.sense(car);
      times.push(performance.now() - t0);
    }
    const sorted = times.slice(100).sort((a, b) => a - b); // drop the warm-up
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.info(
      `sense() x${sorted.length}: median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms`,
    );
    expect(median).toBeLessThan(5);
    track.dispose();
  });
});
