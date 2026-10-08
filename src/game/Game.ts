/**
 * The default game scene: generated track, the car, a controller behind a `ControllerHost`, the
 * chase camera and the fixed-step loop. Race logic (countdown, checkpoints, laps) comes later.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ChaseCamera } from '../camera/ChaseCamera';
import { CarPhysics } from '../car/CarPhysics';
import { CarView } from '../car/CarView';
import type { CarPose } from '../car/types';
import { ControllerHost } from '../control/ControllerHost';
import { createController } from '../control/registry';
import { buildObservation } from '../control/types';
import type { ControllerKind, GameConfig } from '../core/config';
import { GameLoop } from '../core/loop';
import { buildTrack } from '../track/builder';
import { generateTrack } from '../track/generator';

const MAX_FRAME_DT = 0.1;

export async function runGame(config: GameConfig): Promise<void> {
  await RAPIER.init();
  const S = config.worldScale;

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / config.physicsHz;
  const camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.1, 3000);

  const layout = generateTrack(config.seed);
  const track = await buildTrack(layout, scene, world, {
    worldScale: S,
    margin: config.trackMargin,
    outOfBoundsY: config.outOfBoundsY,
  });
  const car = new CarPhysics(world, config, track.surfaceAt);
  const view = await CarView.create(car, config);
  scene.add(view.root);
  const sp = layout.startPose;
  const startPose: CarPose = {
    position: { x: sp.position.x * S, z: sp.position.z * S },
    heading: sp.heading,
  };

  const controller = createController(config.controller, { config });
  const host = new ControllerHost(controller, {
    decisionHz: config.decisionHz[controller.name as ControllerKind] ?? 10,
    mode: config.controlMode,
    neutral: config.car.neutral,
  });
  const chase = new ChaseCamera(camera, view.root, config.camera, canvas);

  let simTime = 0;
  let resets = 0;
  const reset = () => {
    car.resetTo(startPose);
    host.reset();
    car.setInput(host.input);
    view.snap();
    chase.snap();
    resets++;
  };
  car.resetTo(startPose);
  view.snap();
  chase.snap();

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') reset();
    else if (k === 'c') chase.cycle();
  });

  let panel: HTMLDivElement | null = null;
  if (config.debug) {
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;top:8px;left:8px;padding:6px 8px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.4 monospace;white-space:pre;pointer-events:none;';
    document.body.appendChild(panel);
  }

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let lastRender = performance.now();
  const loop = new GameLoop({
    hz: config.physicsHz,
    maxSubSteps: config.maxSubSteps,
    shouldUpdate: () => !host.blocking,
    update: (dt) => {
      host.step(simTime, () => buildObservation(simTime, car.getState()));
      car.setInput(host.input);
      car.update(dt);
      world.step();
      view.capture();
      simTime += dt;
      if (track.isOutOfBounds(car.getState().position)) reset();
    },
    render: (alpha) => {
      const now = performance.now();
      const frameDt = Math.min(MAX_FRAME_DT, (now - lastRender) / 1000);
      lastRender = now;
      view.render(alpha);
      chase.update(frameDt);
      renderer.render(scene, camera);
      if (panel) {
        const s = car.getState();
        const st = host.stats();
        panel.textContent =
          `seed ${config.seed}   controller ${controller.name}   ${config.controlMode}   camera ${chase.mode}\n` +
          `speed ${s.speed.toFixed(1)} m/s (${(s.speed * 3.6).toFixed(0)} km/h)   surface ${s.surface ?? 'void'}   resets ${resets}\n` +
          `input accel ${s.input.accelerator.toFixed(2)} steer ${s.input.steering.toFixed(2)}\n` +
          `host decisions ${st.decisions} skipped ${st.skipped} errors ${st.errors} latency ${st.latencyMean.toFixed(2)}/${st.latencyP95.toFixed(2)} ms\n` +
          `[WASD/arrows] drive  [C] camera  [R] reset`;
      }
    },
  });
  loop.start();

  (window as unknown as Record<string, unknown>).__game = {
    car,
    view,
    track,
    host,
    chase,
    reset,
    state: () => ({ ...car.getState(), resets, simTime }),
    stepFrames: (frames: number) => loop.advance(frames / config.physicsHz),
  };
}
