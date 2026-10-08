/**
 * Car simulation on Rapier's `DynamicRayCastVehicleController`. Rapier only, no three.js, so
 * it runs headless. Metres, N, radians; frame: x right-handed world, y up, N = -z (see
 * `src/track/layout.ts`). In the chassis frame the car faces +z (like the Racing Kit model);
 * its left is +x. Wheel order everywhere: front left, front right, rear left, rear right.
 *
 * Call `update(dt)` once per fixed step, right before `world.step()`.
 *
 * Arcade stability (see also `CarConfig`): the centre of mass sits low (`comY`), the
 * principal inertia is scaled up (`inertiaScale`), angular damping is on, and an anti-roll
 * torque about the forward axis levels the body. Surface grip: `frictionSlip` per wheel from
 * the surface under its contact point; surface drag is a linear damping on the horizontal
 * velocity, weighted by the share of wheels touching each surface.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { SurfaceType } from '../assets/surfaces';
import type { GameConfig } from '../core/config';
import {
  ackermannAngles,
  mapPedals,
  sanitizeInput,
  stepSteerAngle,
  targetSteerAngle,
} from './control';
import type { CarInput, CarPose, CarState } from './types';

export type SurfaceLookup = (x: number, z: number) => SurfaceType | null;
export type CarPhysicsConfig = Pick<GameConfig, 'car' | 'surfaces'>;

const WHEELS = 4;

/** Quaternion of a rotation about +y by `yaw`. */
function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Rotates the unit vector `v` by quaternion `q`. */
function rotate(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export class CarPhysics {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  private readonly world: RAPIER.World;
  private readonly cfg: CarPhysicsConfig;
  private readonly surfaceAt: SurfaceLookup;
  private input: CarInput;
  private steerAngle = 0;
  private wheelSurfaces: (SurfaceType | null)[] = [null, null, null, null];
  private disposed = false;

  constructor(world: RAPIER.World, config: CarPhysicsConfig, surfaceAt: SurfaceLookup) {
    this.world = world;
    this.cfg = config;
    this.surfaceAt = surfaceAt;
    const c = config.car;
    this.input = { accelerator: c.neutral, steering: 0 };

    const { x: hx, y: hy, z: hz } = c.halfExtents;
    const m = c.mass;
    // Solid box inertia about the centre of mass, scaled up.
    const k = c.inertiaScale / 3;
    const inertia = {
      x: k * m * (hy * hy + hz * hz),
      y: k * m * (hx * hx + hz * hz),
      z: k * m * (hx * hx + hy * hy),
    };
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(m, { x: 0, y: c.comY, z: 0 }, inertia, {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
        })
        .setAngularDamping(c.angularDamping)
        .setCanSleep(false),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(0, c.colliderY, 0)
        .setDensity(0)
        .setFriction(0.1)
        .setRestitution(0),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    const s = c.suspension;
    const axles = [c.frontAxleZ, c.frontAxleZ, c.rearAxleZ, c.rearAxleZ];
    for (let i = 0; i < WHEELS; i++) {
      const left = i % 2 === 0;
      this.vehicle.addWheel(
        { x: left ? c.wheelX : -c.wheelX, y: c.connectionY, z: axles[i] as number },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        s.restLength,
        c.wheelRadius,
      );
      this.vehicle.setWheelMaxSuspensionTravel(i, s.maxTravel);
      this.vehicle.setWheelSuspensionStiffness(i, s.stiffness);
      this.vehicle.setWheelSuspensionCompression(i, s.compression);
      this.vehicle.setWheelSuspensionRelaxation(i, s.relaxation);
      this.vehicle.setWheelMaxSuspensionForce(i, s.maxForce);
      this.vehicle.setWheelSideFrictionStiffness(i, c.sideFrictionStiffness);
      this.vehicle.setWheelFrictionSlip(i, config.surfaces.road.frictionSlip);
    }
  }

  /** Sets the pedal/steering input. Out-of-range values are clamped, non-finite ones ignored. */
  setInput(input: Partial<CarInput>): void {
    this.input = sanitizeInput(this.input, input);
  }

  getInput(): CarInput {
    return { ...this.input };
  }

  /** Forward unit vector of the chassis in world space. */
  private forward(): { x: number; y: number; z: number } {
    return rotate(this.body.rotation(), { x: 0, y: 0, z: 1 });
  }

  private forwardSpeed(): number {
    const v = this.body.linvel();
    const f = this.forward();
    return v.x * f.x + v.y * f.y + v.z * f.z;
  }

  /** Surface under wheel `i`: its contact point, or its hard point if it is in the air. */
  private wheelSurface(i: number): SurfaceType | null {
    const p = this.vehicle.wheelIsInContact(i)
      ? this.vehicle.wheelContactPoint(i)
      : this.vehicle.wheelHardPoint(i);
    return p ? this.surfaceAt(p.x, p.z) : null;
  }

  /**
   * Applies the input, steering rate limit, surface grip and drag, then updates the vehicle
   * (suspension, engine, brakes, tyre forces). Call before `world.step()`.
   */
  update(dt: number): void {
    const c = this.cfg.car;
    const speed = this.forwardSpeed();

    // Steering: target from the speed-dependent lock, rate limited. Positive = right.
    const target = targetSteerAngle(this.input.steering, speed, c);
    this.steerAngle = stepSteerAngle(this.steerAngle, target, c.steerRate, dt);

    const ack = ackermannAngles(this.steerAngle, c.frontAxleZ - c.rearAxleZ, c.wheelX);
    const pedals = mapPedals(this.input.accelerator, c);
    // Power curve: the engine fades out towards `engineTopSpeed`.
    const engine = pedals.engine * Math.max(0, 1 - Math.max(0, speed) / c.engineTopSpeed);
    const brake = pedals.brake;
    let dragSum = 0;
    let grounded = 0;
    for (let i = 0; i < WHEELS; i++) {
      const surf = this.wheelSurface(i);
      this.wheelSurfaces[i] = surf;
      const params = surf ? this.cfg.surfaces[surf] : undefined;
      if (params) this.vehicle.setWheelFrictionSlip(i, params.frictionSlip);
      if (params && this.vehicle.wheelIsInContact(i)) {
        dragSum += params.drag;
        grounded++;
      }
      // Rapier's steering is positive to the left, ours positive to the right.
      const wheelAngle = i === 0 ? ack.left : i === 1 ? ack.right : 0;
      this.vehicle.setWheelSteering(i, -wheelAngle);
      this.vehicle.setWheelEngineForce(i, engine / WHEELS);
      this.vehicle.setWheelBrake(i, brake / WHEELS);
    }

    // Surface drag: horizontal linear damping, averaged over the wheels on the ground.
    if (grounded > 0) {
      const f = Math.exp(-(dragSum / grounded) * dt);
      const v = this.body.linvel();
      this.body.setLinvel({ x: v.x * f, y: v.y, z: v.z * f }, true);
    }

    // Anti-roll: torque about the forward axis proportional to the sideways lean.
    if (c.antiRoll > 0) {
      const q = this.body.rotation();
      const right = rotate(q, { x: -1, y: 0, z: 0 });
      const f = this.forward();
      // Lean angle about the forward axis: the right vector's vertical component.
      const lean = Math.asin(Math.max(-1, Math.min(1, right.y)));
      const t = c.antiRoll * lean; // torque about +forward lifts the left side (+x)
      this.body.addTorque({ x: f.x * t, y: f.y * t, z: f.z * t }, true);
    }

    this.vehicle.updateVehicle(dt);
  }

  getState(): CarState {
    const p = this.body.translation();
    const f = this.forward();
    return {
      position: { x: p.x, y: p.y, z: p.z },
      heading: Math.atan2(f.x, -f.z),
      speed: this.forwardSpeed(),
      surface: this.surfaceAt(p.x, p.z),
      wheelSurfaces: [...this.wheelSurfaces],
      input: { ...this.input },
      steerAngle: this.steerAngle,
    };
  }

  /** Chassis up vector, y component (1 = upright, < 0 = upside down). */
  upY(): number {
    return rotate(this.body.rotation(), { x: 0, y: 1, z: 0 }).y;
  }

  /** Rendering access: chassis pose and wheel state. */
  getWheelState(i: number): {
    steering: number;
    rotation: number;
    suspensionLength: number;
  } {
    return {
      steering: -(this.vehicle.wheelSteering(i) ?? 0),
      rotation: this.vehicle.wheelRotation(i) ?? 0,
      suspensionLength: this.vehicle.wheelSuspensionLength(i) ?? this.cfg.car.suspension.restLength,
    };
  }

  /**
   * Teleports the car upright, `resetHeight` above the ground, at rest, steering centred and
   * the input neutral. `pose.position` is in metres.
   */
  resetTo(pose: CarPose): void {
    const c = this.cfg.car;
    const q = yawQuat(Math.PI - pose.heading);
    this.body.setTranslation(
      { x: pose.position.x, y: c.wheelRadius + c.resetHeight, z: pose.position.z },
      true,
    );
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.input = { accelerator: c.neutral, steering: 0 };
    for (let i = 0; i < WHEELS; i++) {
      this.vehicle.setWheelSteering(i, 0);
      this.vehicle.setWheelEngineForce(i, 0);
      this.vehicle.setWheelBrake(i, 0);
    }
  }

  /** Removes the vehicle controller, collider and body from the world. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.removeVehicleController(this.vehicle);
    this.world.removeCollider(this.collider, false);
    this.world.removeRigidBody(this.body);
  }
}
