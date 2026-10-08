/**
 * Camera rig with three modes, cycled by `cycle()`: chase (behind and above the car, looking
 * slightly ahead), top-down (north-up, following the car) and free orbit (`OrbitControls`
 * around the car). It follows the *interpolated* car transform (`CarView.root`) with
 * frame-rate-independent exponential smoothing, so it neither jitters nor depends on the
 * render rate. Call `update(frameDt)` once per rendered frame after `CarView.render`.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ChaseCameraConfig } from '../core/config';

export type CameraMode = 'chase' | 'topdown' | 'orbit';
const MODES: CameraMode[] = ['chase', 'topdown', 'orbit'];

const UP = new THREE.Vector3(0, 1, 0);
/** North is -z (see `layout.ts`), so a north-up top-down camera has -z as its screen up. */
const NORTH = new THREE.Vector3(0, 0, -1);

export class ChaseCamera {
  mode: CameraMode = 'chase';
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.Object3D;
  private readonly cfg: ChaseCameraConfig;
  private readonly domElement: HTMLElement | undefined;
  private controls: OrbitControls | null = null;
  private readonly look = new THREE.Vector3();
  private readonly up = UP.clone();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly desiredUp = new THREE.Vector3();
  private readonly carPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  constructor(
    camera: THREE.PerspectiveCamera,
    target: THREE.Object3D,
    cfg: ChaseCameraConfig,
    domElement?: HTMLElement,
  ) {
    this.camera = camera;
    this.target = target;
    this.cfg = cfg;
    this.domElement = domElement;
    this.snap();
  }

  /** chase -> top-down -> orbit -> chase. */
  cycle(): CameraMode {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]!);
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    if (this.mode === 'orbit' && mode !== 'orbit' && this.controls) {
      // Leaving orbit: smooth on from where the orbit camera was looking.
      this.look.copy(this.controls.target);
      this.up.copy(UP);
    }
    this.mode = mode;
    if (mode === 'orbit') {
      this.camera.up.copy(UP);
      if (!this.controls && this.domElement) {
        this.controls = new OrbitControls(this.camera, this.domElement);
        this.controls.enableDamping = false;
        this.controls.maxPolarAngle = Math.PI * 0.49;
      }
      if (this.controls) {
        this.target.getWorldPosition(this.carPos);
        this.controls.target.copy(this.carPos);
        this.controls.enabled = true;
        this.controls.update();
      }
    } else if (this.controls) {
      this.controls.enabled = false;
    }
  }

  /** Jumps to the desired pose with no smoothing (after a reset or a mode change). */
  snap(): void {
    this.computeDesired();
    this.camera.position.copy(this.desiredPos);
    this.look.copy(this.desiredLook);
    this.up.copy(this.desiredUp);
    this.apply();
    if (this.mode === 'orbit' && this.controls) {
      this.controls.target.copy(this.carPos);
      this.controls.update();
    }
  }

  update(dt: number): void {
    if (this.mode === 'orbit') {
      this.updateOrbit();
      return;
    }
    this.computeDesired();
    const k = 1 - Math.exp(-this.cfg.stiffness * Math.max(0, dt));
    this.camera.position.lerp(this.desiredPos, k);
    this.look.lerp(this.desiredLook, k);
    this.up.lerp(this.desiredUp, k).normalize();
    this.apply();
  }

  dispose(): void {
    this.controls?.dispose();
    this.controls = null;
  }

  private updateOrbit(): void {
    this.target.getWorldPosition(this.carPos);
    if (!this.controls) return;
    // Carry the camera along with the car so the orbit offset is kept.
    this.tmp.copy(this.carPos).sub(this.controls.target);
    this.camera.position.add(this.tmp);
    this.controls.target.copy(this.carPos);
    this.controls.update();
  }

  private apply(): void {
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.look);
  }

  private computeDesired(): void {
    this.target.getWorldPosition(this.carPos);
    if (this.mode === 'topdown') {
      this.desiredLook.copy(this.carPos);
      this.desiredPos.copy(this.carPos).y += this.cfg.topDownHeight;
      this.desiredUp.copy(NORTH);
      return;
    }
    // Horizontal facing of the car; keep the previous one when it points straight up/down.
    this.tmp.set(0, 0, 1).applyQuaternion(this.target.getWorldQuaternion(this.quat));
    this.tmp.y = 0;
    if (this.tmp.lengthSq() > 1e-6) this.fwd.copy(this.tmp.normalize());
    this.desiredPos
      .copy(this.carPos)
      .addScaledVector(this.fwd, -this.cfg.distance)
      .addScaledVector(UP, this.cfg.height);
    this.desiredLook.copy(this.carPos).addScaledVector(this.fwd, this.cfg.lookAhead);
    this.desiredLook.y += 0.5;
    this.desiredUp.copy(UP);
  }
}
