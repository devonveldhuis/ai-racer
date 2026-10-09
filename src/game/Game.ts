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
import type { CarPose, CarState } from '../car/types';
import { DecisionLog } from '../control/DecisionLog';
import { ControllerHost } from '../control/ControllerHost';
import { createController } from '../control/registry';
import {
  buildObservation,
  type CarController,
  type Observation,
  type RaySample,
} from '../control/types';
import type { ControllerKind, GameConfig } from '../core/config';
import { GameLoop } from '../core/loop';
import { TILE_CATALOG } from '../assets/tiles';
import { preloadModels } from '../assets/loader';
import { SensorOverlay } from '../debug/SensorOverlay';
import { Dust } from '../fx/Dust';
import { Race, startPoseMetres } from '../race/Race';
import { recordResult } from '../race/results';
import { formatObservation } from '../sensors/format';
import { RayConeSensor } from '../sensors/RayConeSensor';
import { buildTrack, type BuiltTrack } from '../track/builder';
import { generateTrack } from '../track/generator';
import { Hud, type HudSnapshot } from '../ui/Hud';
import { DisposeStack } from './DisposeStack';
import { installGameKeys } from './gameKeys';

const MAX_FRAME_DT = 0.1;
/** Minimum wall-clock ms between updates of the sensor panel text (10 Hz). */
const OVERLAY_TEXT_MS = 100;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
  /** Decisions of a non-keyboard controller (`null` for the keyboard). */
  log: DecisionLog | null;
  chase: ChaseCamera;
  race: Race;
  dust: Dust;
  sensor: RayConeSensor;
  overlay: SensorOverlay;
  simTime: number;
  dispose(): void;
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

  const hud = new Hud({
    actions: {
      restart: () => void rebuild(seed),
      newTrack: () => void rebuild(Math.floor(Math.random() * 1e9)),
      downloadLog: () => downloadLog(),
    },
    neutral: config.car.neutral,
  });

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

  /** The full observation for the current step (senses the rays). */
  const observe = (s: Session, st: CarState, rays: RaySample[]): Observation => {
    const r = s.race;
    return buildObservation(
      r.raceTime,
      st,
      r.progress,
      {
        checkpoint: r.checkpointsPassed,
        totalCheckpoints: r.checkpointCount,
        lap: r.lap,
        totalLaps: r.laps,
      },
      rays,
    );
  };

  /** Whether the sensor overlay is shown (`F1`; on from the start with `?debug=1`). */
  let sensorOverlayOn = config.debug;

  const buildSession = async (newSeed: number): Promise<Session> => {
    // Everything built so far is freed if a later step throws (e.g. a model fails to load).
    const cleanup = new DisposeStack();
    try {
      const layout = generateTrack(newSeed);
      const race = cleanup.add(
        new Race({
          layout,
          worldScale: S,
          config: config.race,
          controller: config.controller,
        }),
        () => race.dispose(),
      );
      race.beginGenerating();
      const track = cleanup.add(
        await buildTrack(layout, scene, world, {
          worldScale: S,
          margin: config.trackMargin,
          outOfBoundsY: config.outOfBoundsY,
        }),
        () => track.dispose(),
      );
      const car = cleanup.add(new CarPhysics(world, config, track.surfaceAt), () => car.dispose());
      const view = cleanup.add(await CarView.create(car, config), () => view.dispose());
      scene.add(view.root);
      const controller = cleanup.add(createController(config.controller, { config }), () =>
        controller.dispose?.(),
      );
      const log =
        controller.name === 'keyboard' ? null : new DecisionLog(config.decisionLogCapacity);
      const host = new ControllerHost(controller, {
        decisionHz: config.decisionHz[controller.name as ControllerKind] ?? 10,
        mode: config.controlMode,
        neutral: config.car.neutral,
        log: log ?? undefined,
      });
      host.enabled = false;
      const chase = cleanup.add(new ChaseCamera(camera, view.root, config.camera, canvas), () =>
        chase.dispose(),
      );
      const dust = cleanup.add(new Dust(config.car), () => dust.dispose());
      scene.add(dust.points);
      const sensor = cleanup.add(
        new RayConeSensor({
          world,
          track,
          config: config.sensor,
          ownBody: car.body,
        }),
        () => sensor.dispose(),
      );
      const overlay = cleanup.add(
        new SensorOverlay({
          scene,
          rayCount: sensor.angles.length,
          sampleCount: config.sensor.sampleDistances.length,
          maxRange: config.sensor.maxRange,
        }),
        () => overlay.dispose(),
      );
      overlay.setVisible(sensorOverlayOn);
      // The session's cleanup, filled in last: `release()` must run after every step that can
      // throw, so a failure above or below frees what was built (in the catch).
      let disposeSession: () => void = () => undefined;
      const s: Session = {
        seed: newSeed,
        track,
        car,
        view,
        controller,
        host,
        log,
        chase,
        race,
        dust,
        sensor,
        overlay,
        simTime: 0,
        dispose: () => disposeSession(),
      };
      race.events.on('finished', (result) => recordResult(result));
      applyReset(s, startPoseMetres(layout, S));
      race.startCountdown();
      disposeSession = cleanup.release();
      return s;
    } catch (e) {
      cleanup.disposeAll();
      throw e;
    }
  };

  const modelNames = [
    ...new Set([...TILE_CATALOG.map((t) => t.model), `raceCar${config.car.colour}`]),
  ];
  let modelsLoaded = false;
  /** Loads every model the game needs once, with the full-screen loading bar. */
  const ensureModels = async (): Promise<void> => {
    if (modelsLoaded) return;
    hud.setLoading(0, modelNames.length);
    try {
      await preloadModels(modelNames, (done, total) => hud.setLoading(done, total));
    } catch (e) {
      hud.setLoadingError(`${errorMessage(e)} — press N to retry`);
      throw e;
    }
    modelsLoaded = true;
    hud.hideLoading();
  };

  /** Disposes the current session and builds a new one for `newSeed`. */
  const rebuild = async (newSeed: number): Promise<void> => {
    if (building || disposed) return;
    building = true;
    try {
      hud.unbind();
      session?.dispose();
      session = null;
      seed = newSeed;
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(newSeed));
      window.history.replaceState(null, '', url);
      await ensureModels();
      if (disposed) return;
      hud.showToast('Generating track…');
      const s = await buildSession(newSeed);
      if (disposed) {
        s.dispose();
        return;
      }
      session = s;
      hud.bind({
        race: s.race,
        layout: s.track.layout,
        worldScale: S,
        seed: s.seed,
        controller: s.controller.name,
        decisionLog: s.log,
      });
      hud.hideToast();
    } catch (e) {
      // A dispose() during the build frees the world under it; that failure is expected.
      if (!disposed) {
        console.error(e);
        // Keep the game usable: no session, and N (or Enter) tries again.
        if (modelsLoaded) {
          hud.showToast(
            `Could not build the track: ${errorMessage(e)} — press N to retry`,
            'error',
          );
        }
      }
    } finally {
      building = false;
    }
  };

  /** Saves the session's decision log as `decisions-<seed>-<controller>.jsonl` (if it has entries). */
  const downloadLog = (): void => {
    const s = session;
    if (!s?.log || s.log.size === 0) return;
    const blob = new Blob([s.log.toJSONL()], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decisions-${s.seed}-${s.controller.name}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const removeKeys = installGameKeys({
    reset: () => session?.race.requestReset('manual'),
    pause: () => session?.race.togglePause(),
    restart: () => void rebuild(seed),
    newTrack: () => void rebuild(Math.floor(Math.random() * 1e9)),
    cycleCamera: () => session?.chase.cycle(),
    toggleHelp: () => hud.toggleHelp(),
    toggleSensors: () => {
      sensorOverlayOn = !sensorOverlayOn;
      session?.overlay.setVisible(sensorOverlayOn);
    },
    downloadLog,
  });

  let panel: HTMLDivElement | null = null;
  if (config.debug) {
    panel = document.createElement('div');
    panel.className = 'ar-debug';
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
  let lastOverlayText = -Infinity;
  const snapshot: HudSnapshot = {
    time: 0,
    speed: 0,
    surface: null,
    accelerator: 0,
    steering: 0,
    lap: 1,
    laps: 1,
    checkpointsPassed: 0,
    checkpointCount: 0,
    x: 0,
    z: 0,
    heading: 0,
  };
  const loop = new GameLoop({
    hz: config.physicsHz,
    maxSubSteps: config.maxSubSteps,
    shouldUpdate: () =>
      session !== null && !session.host.blocking && session.race.state !== 'paused',
    update: (dt) => {
      const s = session;
      if (!s) return;
      const { host, car, race } = s;
      host.step(s.simTime, () => {
        const st = car.getState();
        return observe(s, st, s.sensor.sense(st));
      });
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
        const cs = s.car.getState();
        s.dust.update(
          frameDt,
          s.race.state === 'racing',
          {
            position: cs.position,
            heading: cs.heading,
            speed: cs.speed,
            wheelSurfaces: cs.wheelSurfaces,
          },
          renderer.domElement.height,
        );
        const r = s.race;
        snapshot.time = r.time;
        snapshot.speed = cs.speed;
        snapshot.surface = cs.surface;
        snapshot.accelerator = cs.input.accelerator;
        snapshot.steering = cs.input.steering;
        snapshot.lap = r.lap;
        snapshot.laps = r.laps;
        snapshot.checkpointsPassed = r.checkpointsPassed;
        snapshot.checkpointCount = r.checkpointCount;
        snapshot.x = cs.position.x;
        snapshot.z = cs.position.z;
        snapshot.heading = cs.heading;
        hud.update(snapshot, now);
        if (s.overlay.isVisible) {
          // The overlay senses on its own every frame; its text updates at most 10 Hz.
          const rays = s.sensor.sense(cs);
          s.overlay.update(cs, rays);
          if (now - lastOverlayText >= OVERLAY_TEXT_MS) {
            lastOverlayText = now;
            s.overlay.setText(formatObservation(observe(s, cs, rays)));
          }
        }
      }
      renderer.render(scene, camera);
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
          `draw calls ${renderer.info.render.calls}   dust ${s.dust.pool.aliveCount}/${s.dust.pool.capacity}\n` +
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
    get dust() {
      return session?.dust;
    },
    get sensor() {
      return session?.sensor;
    },
    get overlay() {
      return session?.overlay;
    },
    /** The decision log as JSONL text (empty when there is none). */
    decisionLogText: () => session?.log?.toJSONL() ?? '',
    downloadLog,
    /** The observation a controller would get right now. */
    observe: () => {
      const s = session;
      if (!s) return null;
      const st = s.car.getState();
      return observe(s, st, s.sensor.sense(st));
    },
    hud,
    renderer,
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
      hud.dispose();
      panel?.remove();
      renderer.dispose();
      world.free();
      if ((window as unknown as Record<string, unknown>).__game === debugHook) {
        delete (window as unknown as Record<string, unknown>).__game;
      }
    },
  };
}
