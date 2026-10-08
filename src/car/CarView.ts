/**
 * three.js side of the car: loads `raceCar<Colour>.glb`, follows a `CarPhysics` and spins and
 * steers the wheels. The model faces +z (the physics frame), so with the heading convention of
 * `layout.ts` the yaw is `PI - heading`; that is already in the body quaternion.
 *
 * Origin: the loader cancels the kit's root offset, which leaves the car centred in x with its
 * axles at model (z -0.473 / +0.328, y 0.118). The body origin of `CarPhysics` is the midpoint
 * between the axles at axle height, so the model is shifted by `-(0.118, -0.0725) * scale`.
 * Wheel nodes have their origin on the inner face of the tyre; each is re-pivoted to the tyre
 * centre so steering and spin turn about the tyre's own axis.
 */
import * as THREE from 'three';
import type { GameConfig } from '../core/config';
import { loadModel as defaultLoadModel } from '../assets/loader';
import type { CarPhysics } from './CarPhysics';

export type LoadModelFn = (name: string, scale: number) => Promise<THREE.Object3D>;

/** Model-space reference point (units) that becomes the body origin: axle height, mid-wheelbase. */
const MODEL_ORIGIN = new THREE.Vector3(0, 0.1175, -0.0725);
const WHEEL_NAMES = ['wheelFrontLeft', 'wheelFrontRight', 'wheelBackLeft', 'wheelBackRight'];

interface WheelNode {
  node: THREE.Object3D;
  restY: number;
}

export class CarView {
  /** Add this to the scene. Its transform is the interpolated chassis pose. */
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly wheels: WheelNode[] = [];
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly curPos = new THREE.Vector3();
  private readonly curQuat = new THREE.Quaternion();
  private readonly scale: number;
  private readonly physics: CarPhysics;
  private readonly restLength: number;

  private constructor(
    model: THREE.Object3D,
    physics: CarPhysics,
    scale: number,
    restLength: number,
  ) {
    this.model = model;
    this.physics = physics;
    this.scale = scale;
    this.restLength = restLength;
    this.root.name = 'car';
    model.position.set(-MODEL_ORIGIN.x * scale, -MODEL_ORIGIN.y * scale, -MODEL_ORIGIN.z * scale);
    this.root.add(model);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    model.updateMatrixWorld(true);
    for (const name of WHEEL_NAMES) {
      const node = model.getObjectByName(name);
      if (!node) throw new Error(`Car model has no node "${name}"`);
      // Re-pivot to the tyre centre: shift the node by the offset, children back by the same.
      const box = new THREE.Box3().setFromObject(node);
      const centre = node.parent!.worldToLocal(box.getCenter(new THREE.Vector3()));
      const dx = centre.x - node.position.x;
      node.position.x += dx;
      for (const child of node.children) child.position.x -= dx / node.scale.x;
      node.rotation.order = 'YXZ';
      this.wheels.push({ node, restY: node.position.y });
    }
    this.snap();
  }

  static async create(
    physics: CarPhysics,
    config: Pick<GameConfig, 'car'>,
    loadModel: LoadModelFn = defaultLoadModel,
  ): Promise<CarView> {
    const model = await loadModel(`raceCar${config.car.colour}`, config.car.modelScale);
    return new CarView(model, physics, config.car.modelScale, config.car.suspension.restLength);
  }

  /** Stores the physics pose as the "current" one (call once per fixed step, after
   * `world.step()`), keeping the previous one for interpolation. */
  capture(): void {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    const p = this.physics.body.translation();
    const q = this.physics.body.rotation();
    this.curPos.set(p.x, p.y, p.z);
    this.curQuat.set(q.x, q.y, q.z, q.w);
  }

  /** Call after a teleport so the car does not slide across the map. */
  snap(): void {
    const p = this.physics.body.translation();
    const q = this.physics.body.rotation();
    this.curPos.set(p.x, p.y, p.z);
    this.curQuat.set(q.x, q.y, q.z, q.w);
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  /** Per rendered frame; `alpha` in [0, 1) is the fraction into the next physics step. */
  render(alpha: number): void {
    // The stored "current" pose is from the latest step; interpolate prev -> latest
    // (one step of latency, the usual fixed-timestep presentation).
    this.root.position.lerpVectors(this.prevPos, this.curPos, alpha);
    this.root.quaternion.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    this.wheels.forEach((w, i) => {
      const s = this.physics.getWheelState(i);
      w.node.position.y = w.restY + (this.restLength - s.suspensionLength) / this.scale;
      w.node.rotation.y = -s.steering; // + steering = right = clockwise = -y in three.js
      w.node.rotation.x = s.rotation;
    });
  }

  /** Removes the car from its parent. Geometry and materials are shared with the loader
   * cache and are not disposed. */
  dispose(): void {
    this.root.removeFromParent();
    this.root.remove(this.model);
  }
}
