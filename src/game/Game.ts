/**
 * The default game scene and the full race loop: generate a track, count down, race, finish.
 * One `Session` is the track, car, view, controller and race of the current round; `N` and
 * `Enter` dispose it and build a new one on the same renderer, scene and Rapier world.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ChaseCamera } from '../camera/ChaseCamera';
import { CarPhysics } from '../car/CarPhysics';
import { CarView } from '../car/CarView';
import type { CarPose } from '../car/types';
import { ControllerHost } from '../control/ControllerHost';
import { createController } from '../control/registry';
import { buildObservation, type CarController } from '../control/types';
import type { ControllerKind, GameConfig } from '../core/config';
import { GameLoop } from '../core/loop';
import { Race, startPoseMetres } from '../race/Race';
import { recordResult } from '../race/results';
import { buildTrack, type BuiltTrack } from '../track/builder';
import { generateTrack } from '../track/generator';
import { installGameKeys } from './gameKeys';

const MAX_FRAME_DT = 0.1;

export interface GameHandle {
  /** Stops the loop, removes listeners and DOM elements and frees the renderer and world. */
  dispose(): void;
}

interface Session {
  seed: number;
  track: BuiltTrack;
  car: CarPhysics;
  view: CarView;
  controller: CarController;
  host: ControllerHost;
  chase: ChaseCamera;
  race: Race;
  simTime: number;
  dispose(): void;
}

function formatTime(t: number): string {
  return `${t.toFixed(2)} s`;
}

export async function runGame(config: GameConfig): Promise<GameHandle> {
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

  let disposed = false;
  let session: Session | null = null;
  let building = false;
  let seed = config.seed;

  const applyReset = (s: Session, pose: CarPose) => {
    s.car.resetTo(pose);
    s.host.reset();
    s.car.setInput(s.host.input);
    s.view.snap();
    s.chase.snap();
  };

  const counts = () => {
    let objects = 0;
    scene.traverse(() => objects++);
    return {
      colliders: world.colliders.len(),
      bodies: world.bodies.len(),
      sceneObjects: objects,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
  };

  const buildSession = async (newSeed: number): Promise<Session> => {
    const layout = generateTrack(newSeed);
    const race = new Race({
      layout,
      worldScale: S,
      config: config.race,
      controller: config.controller,
    });
    race.beginGenerating();
    const track = await buildTrack(layout, scene, world, {
      worldScale: S,
      margin: config.trackMargin,
      outOfBoundsY: config.outOfBoundsY,
    });
    const car = new CarPhysics(world, config, track.surfaceAt);
    const view = await CarView.create(car, config);
    scene.add(view.root);
    const controller = createController(config.controller, { config });
    const host = new ControllerHost(controller, {
      decisionHz: config.decisionHz[controller.name as ControllerKind] ?? 10,
      mode: config.controlMode,
      neutral: config.car.neutral,
    });
    host.enabled = false;
    const chase = new ChaseCamera(camera, view.root, config.camera, canvas);
    const s: Session = {
      seed: newSeed,
      track,
      car,
      view,
      controller,
      host,
      chase,
      race,
      simTime: 0,
      dispose() {
        race.dispose();
        chase.dispose();
        controller.dispose?.();
        view.dispose();
        car.dispose();
        track.dispose();
      },
    };
    race.events.on('finished', (result) => recordResult(result));
    applyReset(s, startPoseMetres(layout, S));
    race.startCountdown();
    return s;
  };

  /** Disposes the current session and builds a new one for `newSeed`. */
  const rebuild = async (newSeed: number): Promise<void> => {
    if (building || disposed) return;
    building = true;
    try {
      session?.dispose();
      session = null;
      seed = newSeed;
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(newSeed));
      window.history.replaceState(null, '', url);
      const s = await buildSession(newSeed);
      if (disposed) s.dispose();
      else session = s;
    } catch (e) {
      // A dispose() during the build frees the world under it; that failure is expected.
      if (!disposed) throw e;
    } finally {
      building = false;
    }
  };

  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;top:12%;left:0;right:0;text-align:center;font:600 28px/1.3 system-ui,sans-serif;text-shadow:0 2px 6px rgba(0,0,0,.7);white-space:pre;';
  (document.getElementById('ui') ?? document.body).appendChild(hud);

  const hudText = (s: Session | null): string => {
    if (!s) return building ? 'Generating track…' : '';
    const r = s.race;
    switch (r.state) {
      case 'countdown':
        return r.countdownValue === null ? '' : String(r.countdownValue);
      case 'racing': {
        const go = r.raceTime < 1 ? 'GO!\n' : '';
        return `${go}${formatTime(r.time)}   lap ${r.lap}/${r.laps}   checkpoint ${r.checkpointsPassed}/${r.checkpointCount}`;
      }
      case 'paused':
        return `Paused (${formatTime(r.time)}) — Esc: resume`;
      case 'finished':
        return `Finished ${formatTime(r.result?.totalTime ?? r.time)} — Enter: restart, N: new track`;
      default:
        return 'Generating track…';
    }
  };

  const removeKeys = installGameKeys({
    reset: () => session?.race.requestReset('manual'),
    pause: () => session?.race.togglePause(),
    restart: () => void rebuild(seed),
    newTrack: () => void rebuild(Math.floor(Math.random() * 1e9)),
    cycleCamera: () => session?.chase.cycle(),
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
  let lastHud = '';
  const loop = new GameLoop({
    hz: config.physicsHz,
    maxSubSteps: config.maxSubSteps,
    shouldUpdate: () =>
      session !== null && !session.host.blocking && session.race.state !== 'paused',
    update: (dt) => {
      const s = session;
      if (!s) return;
      const { host, car, race } = s;
      host.step(s.simTime, () => buildObservation(s.simTime, car.getState()));
      car.setInput(host.input);
      car.update(dt);
      world.step();
      s.view.capture();
      s.simTime += dt;
      const st = car.getState();
      const actions = race.step(dt, {
        position: st.position,
        heading: st.heading,
        upY: car.upY(),
        surface: st.surface,
        outOfBounds: s.track.isOutOfBounds(st.position),
      });
      host.enabled = actions.controllerEnabled;
      if (actions.resetTo) applyReset(s, actions.resetTo);
    },
    render: (alpha) => {
      const now = performance.now();
      const frameDt = Math.min(MAX_FRAME_DT, (now - lastRender) / 1000);
      lastRender = now;
      const s = session;
      if (s) {
        s.view.render(alpha);
        s.chase.update(frameDt);
      }
      renderer.render(scene, camera);
      const text = hudText(s);
      if (text !== lastHud) {
        hud.textContent = text;
        lastHud = text;
      }
      if (panel) {
        if (!s) {
          panel.textContent = building ? 'building…' : '';
          return;
        }
        const car = s.car.getState();
        const hs = s.host.stats();
        const r = s.race;
        const p = r.progress;
        const c = counts();
        panel.textContent =
          `seed ${s.seed}   controller ${s.controller.name}   ${config.controlMode}   camera ${s.chase.mode}\n` +
          `race ${r.state}   time ${r.time.toFixed(2)} s (penalties ${(r.time - r.raceTime).toFixed(0)} s)   lap ${r.lap}/${r.laps}   cp ${r.checkpointsPassed}/${r.checkpointCount}\n` +
          `resets ${r.resets}   off-track ${r.offTrackTime.toFixed(2)} s\n` +
          `progress ${p ? `${p.distanceAlong.toFixed(1)} m   heading err ${p.headingError.toFixed(2)} rad   lateral ${p.lateralOffset.toFixed(2)}` : '-'}\n` +
          `speed ${car.speed.toFixed(1)} m/s (${(car.speed * 3.6).toFixed(0)} km/h)   surface ${car.surface ?? 'void'}\n` +
          `input accel ${car.input.accelerator.toFixed(2)} steer ${car.input.steering.toFixed(2)}\n` +
          `host decisions ${hs.decisions} skipped ${hs.skipped} errors ${hs.errors} latency ${hs.latencyMean.toFixed(2)}/${hs.latencyP95.toFixed(2)} ms\n` +
          `colliders ${c.colliders} bodies ${c.bodies} objects ${c.sceneObjects} geometries ${c.geometries} textures ${c.textures}\n` +
          `[WASD/arrows] drive  [C] camera  [R] reset  [Esc] pause  [Enter] restart  [N] new track`;
      }
    },
  });

  await rebuild(seed);
  loop.start();

  const debugHook = {
    get car() {
      return session?.car;
    },
    get view() {
      return session?.view;
    },
    get track() {
      return session?.track;
    },
    get host() {
      return session?.host;
    },
    get chase() {
      return session?.chase;
    },
    get race() {
      return session?.race;
    },
    reset: () => session?.race.requestReset('manual'),
    rebuild,
    counts,
    state: () => {
      const s = session;
      return s ? { ...s.car.getState(), resets: s.race.resets, simTime: s.simTime } : null;
    },
    stepFrames: (frames: number) => loop.advance(frames / config.physicsHz),
  };
  (window as unknown as Record<string, unknown>).__game = debugHook;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.stop();
      removeKeys();
      window.removeEventListener('resize', resize);
      session?.dispose();
      session = null;
      hud.remove();
      panel?.remove();
      renderer.dispose();
      world.free();
      if ((window as unknown as Record<string, unknown>).__game === debugHook) {
        delete (window as unknown as Record<string, unknown>).__game;
      }
    },
  };
}
