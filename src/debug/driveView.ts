import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CarPhysics } from '../car/CarPhysics';
import { CarView } from '../car/CarView';
import type { CarInput } from '../car/types';
import { DEFAULT_CONFIG } from '../core/config';
import { GameLoop } from '../core/loop';
import { buildTrack } from '../track/builder';
import { generateTrack } from '../track/generator';

/**
 * `?view=drive&seed=N` dev harness (temporary, replaced by the real game in task 006): the
 * generated track with the car on the start pose, a fixed follow camera and raw keyboard
 * input. Up / W = accelerator 1, Down / S = 0, neither (or both) = neutral; Left / A and
 * Right / D steer. `R` resets to the start pose, and falling off the ground resets too.
 * `window.__drive` exposes the car for scripted checks.
 */
export async function runDriveView(search: URLSearchParams): Promise<void> {
  await RAPIER.init();
  const config = DEFAULT_CONFIG;
  const S = config.worldScale;
  let seed = Number(search.get('seed') ?? String(config.seed));
  if (!Number.isSafeInteger(seed)) seed = config.seed;

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / config.physicsHz;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);

  const layout = generateTrack(seed);
  const track = await buildTrack(layout, scene, world);
  const car = new CarPhysics(world, config, track.surfaceAt);
  const view = await CarView.create(car, config);
  scene.add(view.root);
  const sp = layout.startPose;
  const startPose = {
    position: { x: sp.position.x * S, z: sp.position.z * S },
    heading: sp.heading,
  };

  let resets = 0;
  const reset = () => {
    car.resetTo(startPose);
    view.snap();
  };
  reset();

  const keys = new Set<string>();
  const norm = (k: string) => k.toLowerCase();
  window.addEventListener('keydown', (e) => {
    const k = norm(e.key);
    if (k === 'r') {
      reset();
      resets++;
    } else keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(norm(e.key)));
  window.addEventListener('blur', () => keys.clear());

  const readInput = (): CarInput => {
    const up = keys.has('arrowup') || keys.has('w');
    const down = keys.has('arrowdown') || keys.has('s');
    const left = keys.has('arrowleft') || keys.has('a');
    const right = keys.has('arrowright') || keys.has('d');
    return {
      accelerator: up === down ? config.car.neutral : up ? 1 : 0,
      steering: (right ? 1 : 0) - (left ? 1 : 0),
    };
  };

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:8px;left:8px;padding:6px 8px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.4 monospace;white-space:pre;pointer-events:none;';
  document.body.appendChild(panel);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const forward = new THREE.Vector3();
  const loop = new GameLoop({
    hz: config.physicsHz,
    maxSubSteps: config.maxSubSteps,
    update: () => {
      car.setInput(readInput());
      car.update(world.timestep);
      world.step();
      view.capture();
      if (track.isOutOfBounds(car.getState().position)) {
        reset();
        resets++;
      }
    },
    render: (alpha) => {
      view.render(alpha);
      // Fixed follow camera: behind and above the car along its facing direction.
      forward.set(0, 0, 1).applyQuaternion(view.root.quaternion);
      forward.y = 0;
      forward.normalize();
      camera.position.copy(view.root.position).addScaledVector(forward, -14);
      camera.position.y = view.root.position.y + 7;
      camera.lookAt(view.root.position.x, view.root.position.y + 1, view.root.position.z);
      renderer.render(scene, camera);

      const s = car.getState();
      const surf = (x: string | null) => (x ?? 'void').padEnd(5);
      panel.textContent =
        `seed ${seed}   resets ${resets}\n` +
        `speed ${s.speed.toFixed(1)} m/s   ${(s.speed * 3.6).toFixed(0)} km/h\n` +
        `surface ${surf(s.surface)} wheels FL ${surf(s.wheelSurfaces[0] ?? null)} FR ${surf(s.wheelSurfaces[1] ?? null)}\n` +
        `                        RL ${surf(s.wheelSurfaces[2] ?? null)} RR ${surf(s.wheelSurfaces[3] ?? null)}\n` +
        `input accel ${s.input.accelerator.toFixed(2)} steer ${s.input.steering.toFixed(2)}   wheel angle ${((s.steerAngle * 180) / Math.PI).toFixed(0)} deg\n` +
        `[arrows/WASD] drive   [R] reset`;
    },
  });
  loop.start();

  (window as unknown as Record<string, unknown>).__drive = {
    car,
    view,
    track,
    keys,
    reset,
    state: () => ({ ...car.getState(), up: car.upY(), resets }),
    stepFrames: (frames: number) => loop.advance(frames / config.physicsHz),
  };
}
