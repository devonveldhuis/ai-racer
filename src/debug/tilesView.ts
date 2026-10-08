import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { loadModel } from '../assets/loader';
import {
  DIR_VECTORS,
  TILE_CATALOG,
  placedCentreline,
  placedConnectors,
  placementToJoin,
  reverseTile,
  rotateTile,
  tileTransform,
  connectorsMatch,
  getTile,
  type Connector,
  type Placement,
  type TileDef,
} from '../assets/tiles';
import { DEFAULT_CONFIG } from '../core/config';

/**
 * `?view=tiles` debug page: every catalogued tile on a visible grid with labels, connector
 * arrows (green = entry, red = exit, pointing along the direction of travel) and the
 * centreline (yellow). A second block ("chain") places tiles edge-to-edge using the same
 * helpers the generator will use. Extra params: `cam=top|close|iso` (default top).
 */
export async function runTilesView(search: URLSearchParams): Promise<void> {
  const S = DEFAULT_CONFIG.worldScale;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const labels = new CSS2DRenderer();
  labels.domElement.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
  document.body.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20252b);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-3, 10, 6);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;

  const lineMat = (color: number) => new THREE.LineBasicMaterial({ color, depthTest: false });
  const overlay = new THREE.Group();
  scene.add(overlay);
  const Y = 0.25 * S; // overlay height above the road
  const toWorld = (x: number, z: number, y = Y) => new THREE.Vector3(x * S, y, z * S);

  const addLabel = (text: string, x: number, z: number, color = '#fff') => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `font:12px/1.2 system-ui,sans-serif;color:${color};background:rgba(0,0,0,.6);padding:1px 4px;border-radius:3px;white-space:nowrap;`;
    const obj = new CSS2DObject(el);
    obj.position.copy(toWorld(x, z, 0));
    overlay.add(obj);
  };

  const addLine = (points: THREE.Vector3[], color: number) => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat(color));
    line.renderOrder = 10;
    overlay.add(line);
  };

  const addRectOutline = (x: number, z: number, w: number, d: number, color: number) => {
    const y = 0.05 * S;
    addLine(
      [
        toWorld(x, z, y),
        toWorld(x + w, z, y),
        toWorld(x + w, z + d, y),
        toWorld(x, z + d, y),
        toWorld(x, z, y),
      ],
      color,
    );
  };

  /** Arrow at the middle of a connector's edge, pointing along travel (out for exit). */
  const addConnector = (c: Connector, isExit: boolean, color: number) => {
    const v = DIR_VECTORS[c.edge];
    const mid = { x: c.cell.x + 0.5 + v.x * 0.5, z: c.cell.z + 0.5 + v.z * 0.5 };
    const travel = isExit ? v : { x: -v.x, z: -v.z };
    const dir = new THREE.Vector3(travel.x, 0, travel.z);
    const len = 0.45 * S;
    const origin = toWorld(mid.x, mid.z).addScaledVector(dir, -len / 2);
    const arrow = new THREE.ArrowHelper(dir, origin, len, color, 0.18 * S, 0.12 * S);
    arrow.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.depthTest = false;
      o.renderOrder = 11;
    });
    overlay.add(arrow);
  };

  const placed: { def: TileDef; placement: Placement }[] = [];

  const placeTile = async (def: TileDef, placement: Placement, label?: string) => {
    const model = await loadModel(def.model, S);
    const t = tileTransform(def, placement);
    model.position.set(t.x * S, 0, t.z * S);
    model.rotation.y = t.rotationY;
    scene.add(model);
    const fp = rotateTile(def, placement.rotation).footprint;
    addRectOutline(placement.cell.x, placement.cell.z, fp.w, fp.d, 0xff00ff);
    addLabel(label ?? def.id, placement.cell.x + fp.w / 2, placement.cell.z + fp.d / 2, '#fff');
    const conns = placedConnectors(def, placement);
    if (conns) {
      addConnector(conns.entry, false, 0x33ff66);
      addConnector(conns.exit, true, 0xff3333);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const p = placedCentreline(def, placement, i / 48);
        if (p) pts.push(toWorld(p.x, p.z));
      }
      addLine(pts, 0xffee00);
    }
    placed.push({ def, placement });
  };

  // Block 1: the catalog, one tile per slot, 4-cell pitch, rotated 0 deg.
  const PITCH = 5;
  const COLS = 4;
  const catalogTop = 0;
  for (const [i, def] of TILE_CATALOG.entries()) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    await placeTile(def, { cell: { x: col * PITCH, z: catalogTop + row * PITCH }, rotation: 0 });
  }

  // Block 2: a rotated copy of each corner, to eyeball rotation.
  const rotRow = Math.ceil(TILE_CATALOG.length / COLS) * PITCH;
  const corners = TILE_CATALOG.filter((d) => d.kind === 'corner');
  for (const [i, def] of corners.entries()) {
    await placeTile(def, { cell: { x: i * PITCH, z: rotRow }, rotation: 90 }, `${def.id} @90`);
  }

  // Block 3: chain placed edge-to-edge with placementToJoin (same code the generator uses).
  const chainIds: [string, boolean][] = [
    ['roadStartPositions', false],
    ['roadStraight', false],
    ['roadCornerLarge', false],
    ['roadStraightLong', false],
    ['roadCornerSmall', true],
    ['roadCornerLarge', true],
    ['roadStraight', false],
    ['roadCornerLarger', false],
  ];
  let first = true;
  let prevExit: Connector | null = null;
  let closeFocus: { x: number; z: number } | null = null;
  for (const [id, rev] of chainIds) {
    const base = getTile(id);
    const def = rev ? reverseTile(base) : base;
    // Start bottom-right, heading north.
    const placement: Placement | null = first
      ? { cell: { x: 24, z: 20 }, rotation: 0 }
      : prevExit && placementToJoin(prevExit, def);
    if (!placement) throw new Error(`chain: cannot join ${def.id}`);
    const conns = placedConnectors(def, placement);
    if (!first && prevExit && conns && !connectorsMatch(prevExit, conns.entry)) {
      throw new Error(`chain: connectors do not match at ${def.id}`);
    }
    await placeTile(def, placement, `${def.id}${rev ? ' (left)' : ''}`);
    prevExit = conns ? conns.exit : null;
    if (id === 'roadStraight' && first === false && !closeFocus) {
      const fp = rotateTile(base, placement.rotation).footprint;
      closeFocus = { x: placement.cell.x + fp.w / 2, z: placement.cell.z + fp.d / 2 };
    }
    first = false;
  }

  // Grid (1 tile per square) covering everything.
  const gridCells = 40;
  const grid = new THREE.GridHelper(gridCells * S, gridCells, 0x8899aa, 0x445566);
  grid.position.set((gridCells / 2) * S - 2 * S, -0.02 * S, (gridCells / 2) * S - 2 * S);
  scene.add(grid);

  // Camera.
  const cam = search.get('cam') ?? 'top';
  const cx = 17 * S;
  const cz = 11 * S;
  if (cam === 'close' && closeFocus) {
    const f = closeFocus;
    controls.target.set(f.x * S, 0, f.z * S);
    camera.position.set(f.x * S + 0.01, 7 * S, f.z * S + 0.5 * S);
  } else if (cam === 'iso') {
    controls.target.set(cx, 0, cz);
    camera.position.set(cx - 20 * S, 30 * S, cz + 28 * S);
  } else {
    controls.target.set(cx, 0, cz);
    camera.position.set(cx + 0.01, 34 * S, cz + 0.5 * S);
  }
  controls.update();

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    labels.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
  (window as unknown as { __tilesReady?: boolean }).__tilesReady = true;
}
