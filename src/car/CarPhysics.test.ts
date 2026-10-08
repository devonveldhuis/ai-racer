import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SurfaceType } from '../assets/surfaces';
import { DEFAULT_CONFIG } from '../core/config';
import { CarPhysics } from './CarPhysics';

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;

function setup(surface: SurfaceType | null = 'road') {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0));
  const car = new CarPhysics(world, DEFAULT_CONFIG, () => surface);
  car.resetTo({ position: { x: 0, z: 0 }, heading: 0 });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      car.update(DT);
      world.step();
    }
  };
  return { world, car, step };
}

describe('CarPhysics', () => {
  it('settles on its wheels and faces -z at heading 0', () => {
    const { car, step } = setup();
    step(60);
    const s = car.getState();
    expect(s.position.y).toBeGreaterThan(0.15);
    expect(s.position.y).toBeLessThan(0.4);
    expect(Math.abs(s.speed)).toBeLessThan(0.05);
    expect(car.upY()).toBeGreaterThan(0.99);
    for (let i = 0; i < 4; i++) expect(car.vehicle.wheelIsInContact(i)).toBe(true);
    car.setInput({ accelerator: 1 });
    step(60);
    expect(car.getState().position.z).toBeLessThan(-1);
    expect(car.getState().speed).toBeGreaterThan(3);
  });

  it('reaches 30 +/- 3 m/s after 15 s at full throttle on road', () => {
    const { car, step } = setup('road');
    car.setInput({ accelerator: 1 });
    step(900);
    expect(Math.abs(car.getState().speed - 30)).toBeLessThanOrEqual(3);
  });

  it('is limited to at most 40 % of that on grass', () => {
    const road = setup('road');
    road.car.setInput({ accelerator: 1 });
    road.step(900);
    const grass = setup('grass');
    grass.car.setInput({ accelerator: 1 });
    grass.step(900);
    const vr = road.car.getState().speed;
    const vg = grass.car.getState().speed;
    expect(vg).toBeGreaterThan(2);
    expect(vg).toBeLessThanOrEqual(0.4 * vr);
  });

  it('brakes from top speed to a stop in less than 4 s without nosing over', () => {
    const { car, step } = setup();
    car.setInput({ accelerator: 1 });
    step(900);
    car.setInput({ accelerator: 0 });
    let t = 0;
    let minUp = 1;
    while (car.getState().speed > 0.2 && t < 600) {
      step();
      t++;
      minUp = Math.min(minUp, car.upY());
    }
    expect(t * DT).toBeLessThan(4);
    expect(minUp).toBeGreaterThan(0.9);
    step(60);
    expect(car.getState().speed).toBeGreaterThan(-0.5); // no reversing
  });

  it('coasts down at neutral', () => {
    const { car, step } = setup();
    car.setInput({ accelerator: 1 });
    step(900);
    const v0 = car.getState().speed;
    car.setInput({ accelerator: 0.5 });
    step(120);
    const v1 = car.getState().speed;
    expect(v1).toBeLessThan(v0 - 1);
    expect(v1).toBeGreaterThan(0);
    step(240);
    expect(car.getState().speed).toBeLessThan(v1);
  });

  it('keeps upright with full steering lock at top speed for 10 s (both ways)', () => {
    for (const steering of [1, -1]) {
      const { car, step } = setup();
      car.setInput({ accelerator: 1 });
      step(900);
      car.setInput({ accelerator: 1, steering });
      let minUp = 1;
      for (let i = 0; i < 600; i++) {
        step();
        minUp = Math.min(minUp, car.upY());
      }
      expect(minUp).toBeGreaterThan(0.7);
    }
  });

  it('turns left for negative steering (heading decreases) and right for positive', () => {
    const left = setup();
    left.car.setInput({ accelerator: 1, steering: -1 });
    left.step(90);
    expect(left.car.getState().heading).toBeLessThan(-0.2);
    expect(left.car.getState().position.x).toBeLessThan(-1);
    const right = setup();
    right.car.setInput({ accelerator: 1, steering: 1 });
    right.step(90);
    expect(right.car.getState().heading).toBeGreaterThan(0.2);
    expect(right.car.getState().position.x).toBeGreaterThan(1);
  });

  it('rate-limits the wheel angle', () => {
    const { car, step } = setup();
    car.setInput({ steering: 1 });
    step(1);
    expect(car.getState().steerAngle).toBeCloseTo(DEFAULT_CONFIG.car.steerRate * DT, 6);
  });

  it.each([0, 0.5])('survives a 0.15 m kerb-height step at top speed (ridge yaw %f)', (yaw) => {
    const { world, car, step } = setup();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(8, 0.075, 0.5)
        .setTranslation(0, 0.075, -150)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
    car.setInput({ accelerator: 1 });
    let minUp = 1;
    let maxY = 0;
    for (let i = 0; i < 900; i++) {
      step();
      minUp = Math.min(minUp, car.upY());
      maxY = Math.max(maxY, car.getState().position.y);
    }
    expect(car.getState().position.z).toBeLessThan(-200);
    expect(minUp).toBeGreaterThan(0.7);
    expect(maxY).toBeLessThan(1.5); // not launched
  });

  it('reports the per-wheel surface and clamps / ignores bad input', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0));
    // Left half of the world is grass.
    const car = new CarPhysics(world, DEFAULT_CONFIG, (x) => (x < 0 ? 'grass' : 'road'));
    car.resetTo({ position: { x: 0, z: 0 }, heading: 0 });
    for (let i = 0; i < 30; i++) {
      car.update(DT);
      world.step();
    }
    // Facing -z, the car's left is -x: wheels 0 and 2 (left) are on grass.
    expect(car.getState().wheelSurfaces).toEqual(['grass', 'road', 'grass', 'road']);
    car.setInput({ accelerator: 3, steering: NaN });
    expect(car.getState().input).toEqual({ accelerator: 1, steering: 0 });
  });

  it('resetTo zeroes velocity, centres the input and round-trips the heading', () => {
    const { car, step } = setup();
    car.setInput({ accelerator: 1, steering: 1 });
    step(200);
    const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const heading of dirs) {
      car.resetTo({ position: { x: 12, z: -7 }, heading });
      const s = car.getState();
      const v = car.body.linvel();
      const w = car.body.angvel();
      expect(Math.hypot(v.x, v.y, v.z)).toBe(0);
      expect(Math.hypot(w.x, w.y, w.z)).toBe(0);
      expect(s.position.x).toBeCloseTo(12);
      expect(s.position.z).toBeCloseTo(-7);
      expect(s.position.y).toBeGreaterThan(0.3);
      expect(s.steerAngle).toBe(0);
      expect(s.input).toEqual({ accelerator: DEFAULT_CONFIG.car.neutral, steering: 0 });
      // Angle difference modulo 2 pi (PI and -PI are the same heading).
      const d = Math.atan2(Math.sin(s.heading - heading), Math.cos(s.heading - heading));
      expect(Math.abs(d)).toBeLessThan(1e-6);
      expect(car.upY()).toBeCloseTo(1);
    }
  });

  it('drives along the heading it was reset to (east = +x)', () => {
    const { car, step } = setup();
    car.resetTo({ position: { x: 0, z: 0 }, heading: Math.PI / 2 });
    car.setInput({ accelerator: 1 });
    step(90);
    const s = car.getState();
    expect(s.position.x).toBeGreaterThan(3);
    expect(Math.abs(s.position.z)).toBeLessThan(0.5);
  });

  it('dispose removes the body, collider and vehicle controller', () => {
    const { world, car } = setup();
    const before = { b: world.bodies.len(), c: world.colliders.len() };
    expect(before.b).toBe(1);
    car.dispose();
    expect(world.bodies.len()).toBe(0);
    expect(world.colliders.len()).toBe(before.c - 1);
    expect(world.vehicleControllers.size).toBe(0);
    car.dispose();
  });
});
