import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { ChaseCamera } from './ChaseCamera';

const cfg = DEFAULT_CONFIG.camera;

function setup(heading = 0) {
  const target = new THREE.Group();
  target.position.set(10, 0.3, -20);
  // Car faces +z in its own frame; yaw by `heading` about y.
  target.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  target.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 1000);
  const rig = new ChaseCamera(camera, target, cfg);
  return { target, camera, rig };
}

function runFor(rig: ChaseCamera, seconds: number, fps: number) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) rig.update(1 / fps);
}

describe('ChaseCamera', () => {
  it('converges behind and above a stationary car', () => {
    const { camera, rig, target } = setup(Math.PI / 2); // facing +x
    camera.position.set(0, 50, 0); // start far away
    runFor(rig, 4, 60);
    expect(camera.position.x).toBeCloseTo(target.position.x - cfg.distance, 3);
    expect(camera.position.z).toBeCloseTo(target.position.z, 3);
    expect(camera.position.y).toBeCloseTo(target.position.y + cfg.height, 3);
  });

  it('is independent of the frame rate', () => {
    const a = setup(0.7);
    const b = setup(0.7);
    a.camera.position.set(0, 20, 0);
    b.camera.position.set(0, 20, 0);
    runFor(a.rig, 1, 30);
    runFor(b.rig, 1, 144);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(0.05);
  });

  it('snap() jumps straight to the desired pose', () => {
    const { camera, rig, target } = setup(0);
    camera.position.set(100, 100, 100);
    rig.snap();
    expect(camera.position.z).toBeCloseTo(target.position.z - cfg.distance, 6);
    expect(camera.position.y).toBeCloseTo(target.position.y + cfg.height, 6);
  });

  it('cycles chase -> topdown -> orbit -> chase and goes north-up above the car', () => {
    const { camera, rig, target } = setup(1.2);
    expect(rig.mode).toBe('chase');
    expect(rig.cycle()).toBe('topdown');
    runFor(rig, 6, 60);
    expect(camera.position.x).toBeCloseTo(target.position.x, 2);
    expect(camera.position.z).toBeCloseTo(target.position.z, 2);
    expect(camera.position.y).toBeCloseTo(target.position.y + cfg.topDownHeight, 2);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    expect(screenUp.z).toBeLessThan(-0.99); // north (-z) is up on screen
    expect(rig.cycle()).toBe('orbit');
    expect(rig.cycle()).toBe('chase');
  });
});
