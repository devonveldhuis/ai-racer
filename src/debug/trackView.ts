import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_CONFIG } from '../core/config';
import { buildTrack, type BuiltTrack } from '../track/builder';
import { generateTrack } from '../track/generator';
import { headingVector } from '../track/layout';

/**
 * `?view=track&seed=N` debug page: the generated track as the builder renders it.
 *
 * Overlays: centreline (yellow), checkpoints (magenta, start/finish in white), arrow at the
 * start pose (green). Keys: `S` toggles the surface overlay (points every 0.1 cell coloured
 * by `surfaceAt`: road cyan, kerb orange, grass green, no ground red), `N` / `P` next /
 * previous seed (dispose + rebuild, URL updated). Extra params: `cam=top|close` (close
 * focuses piece `focus=<index>`), `surface=1` starts with the surface overlay on.
 * The text panel shows counters that reveal leaks. `window.__trackView` exposes the state
 * for scripted checks.
 */
export async function runTrackView(search: URLSearchParams): Promise<void> {
  await RAPIER.init();
  const S = DEFAULT_CONFIG.worldScale;
  const margin = DEFAULT_CONFIG.trackMargin;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:8px;left:8px;padding:6px 8px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.4 monospace;white-space:pre;pointer-events:none;';
  document.body.appendChild(panel);

  let seed = Number(search.get('seed') ?? '1');
  if (!Number.isSafeInteger(seed)) seed = DEFAULT_CONFIG.seed;
  let built: BuiltTrack | null = null;
  let debugGroup: THREE.Group | null = null;
  let surfaceGroup: THREE.Group | null = null;
  let showSurface = search.get('surface') === '1';
  let busy = false;

  const disposeGroup = (g: THREE.Group | null) => {
    if (!g) return;
    scene.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  };

  const basic = (color: number) => new THREE.LineBasicMaterial({ color, depthTest: false });
  const v = (x: number, z: number, y: number) => new THREE.Vector3(x * S, y, z * S);

  const makeDebugOverlay = (track: BuiltTrack): THREE.Group => {
    const g = new THREE.Group();
    const y = 0.35;
    const layout = track.layout;
    const pts = layout.centreline.points.map((p) => v(p.x, p.z, y));
    pts.push(pts[0] as THREE.Vector3);
    const center = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), basic(0xffee00));
    center.renderOrder = 10;
    g.add(center);
    layout.checkpoints.forEach((cp, i) => {
      const last = i === layout.checkpoints.length - 1;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([v(cp.a.x, cp.a.z, y), v(cp.b.x, cp.b.z, y)]),
        basic(last ? 0xffffff : 0xff00ff),
      );
      line.renderOrder = 10;
      g.add(line);
    });
    const sp = layout.startPose;
    const h = headingVector(sp.heading);
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(h.x, 0, h.z),
      v(sp.position.x, sp.position.z, y),
      0.9 * S,
      0x33ff66,
      0.3 * S,
      0.2 * S,
    );
    arrow.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.depthTest = false;
      o.renderOrder = 11;
    });
    g.add(arrow);
    return g;
  };

  const SURFACE_COLORS: Record<string, THREE.Color> = {
    road: new THREE.Color(0x00aaff),
    kerb: new THREE.Color(0xff8800),
    grass: new THREE.Color(0x00cc00),
    null: new THREE.Color(0xff0000),
  };

  const makeSurfaceOverlay = (track: BuiltTrack): THREE.Group => {
    const { min, max } = track.layout.bounds;
    const step = 0.1;
    const x0 = min.x - margin - 1;
    const x1 = max.x + 1 + margin + 1;
    const z0 = min.z - margin - 1;
    const z1 = max.z + 1 + margin + 1;
    const positions: number[] = [];
    const colors: number[] = [];
    for (let z = z0 + step / 2; z < z1; z += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        const s = track.surfaceAt(x * S, z * S);
        const c = SURFACE_COLORS[String(s)] as THREE.Color;
        positions.push(x * S, 0.15, z * S);
        colors.push(c.r, c.g, c.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const pointsMesh = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true }),
    );
    const g = new THREE.Group();
    g.add(pointsMesh);
    return g;
  };

  const frame = (track: BuiltTrack) => {
    const { min, max } = track.layout.bounds;
    const cx = ((min.x + max.x + 1) / 2) * S;
    const cz = ((min.z + max.z + 1) / 2) * S;
    const cam = search.get('cam') ?? 'top';
    const focus = Number(search.get('focus') ?? '0');
    const piece = track.layout.pieces[focus];
    if (cam === 'close' && piece) {
      const xs = piece.cells.map((c) => c.x);
      const zs = piece.cells.map((c) => c.z);
      const fx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * S;
      const fz = ((Math.min(...zs) + Math.max(...zs) + 1) / 2) * S;
      const size =
        Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1;
      controls.target.set(fx, 0, fz);
      camera.position.set(fx + 0.01, size * S * 2, fz + 0.3 * S);
    } else {
      const ext = Math.max(max.x - min.x + 1, max.z - min.z + 1) + 2 * margin;
      const dist = ((ext * S) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.1;
      controls.target.set(cx, 0, cz);
      camera.position.set(cx + 0.01, dist, cz + 0.5 * S);
    }
    controls.update();
  };

  const load = async (newSeed: number, reframe: boolean) => {
    if (busy) return;
    busy = true;
    try {
      built?.dispose();
      disposeGroup(debugGroup);
      disposeGroup(surfaceGroup);
      built = null;
      debugGroup = null;
      surfaceGroup = null;
      seed = newSeed;
      const layout = generateTrack(seed);
      built = await buildTrack(layout, scene, world);
      debugGroup = makeDebugOverlay(built);
      scene.add(debugGroup);
      if (showSurface) {
        surfaceGroup = makeSurfaceOverlay(built);
        scene.add(surfaceGroup);
      }
      if (reframe) frame(built);
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(seed));
      history.replaceState(null, '', url);
    } finally {
      busy = false;
    }
  };

  const toggleSurface = () => {
    showSurface = !showSurface;
    disposeGroup(surfaceGroup);
    surfaceGroup = null;
    if (showSurface && built) {
      surfaceGroup = makeSurfaceOverlay(built);
      scene.add(surfaceGroup);
    }
  };

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 's') toggleSurface();
    else if (k === 'n') void load(seed + 1, false);
    else if (k === 'p') void load(seed - 1, false);
  });

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  await load(seed, true);

  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    const info = renderer.info;
    panel.textContent =
      `seed ${seed}   pieces ${built?.layout.pieces.length ?? 0}\n` +
      `draw calls ${info.render.calls}   geometries ${info.memory.geometries}\n` +
      `colliders ${world.colliders.len()}   bodies ${world.bodies.len()}\n` +
      `scene children ${scene.children.length}   [S] surface  [N]/[P] seed`;
    requestAnimationFrame(tick);
  };
  tick();

  (window as unknown as Record<string, unknown>).__trackView = {
    next: () => load(seed + 1, false),
    prev: () => load(seed - 1, false),
    toggleSurface,
    stats: () => ({
      seed,
      calls: renderer.info.render.calls,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      colliders: world.colliders.len(),
      bodies: world.bodies.len(),
      children: scene.children.length,
    }),
  };
}
