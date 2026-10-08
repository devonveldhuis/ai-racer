/**
 * Turns a `TrackLayout` into a three.js scene (tile meshes, instanced grass, lighting, sky)
 * and Rapier colliders (one big ground box and a safety floor), and answers surface queries.
 *
 * Units: the layout is in grid units; everything public here is in metres (grid x
 * `worldScale`), with N = -z (see `src/assets/tiles.ts`).
 *
 * Ownership: everything the builder adds to the scene lives under `BuiltTrack.root`. Models
 * come from `loadModel`, whose clones share geometry and materials through a cache, so
 * `dispose()` never disposes those; it disposes only what the builder created itself.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SurfaceType } from '../assets/surfaces';
import { loadModel as defaultLoadModel } from '../assets/loader';
import { getTile, tileTransform } from '../assets/tiles';
import { DEFAULT_CONFIG } from '../core/config';
import type { TrackLayout } from './layout';
import { surfaceAtGrid } from './surface';

export type ColliderKind = 'ground' | 'safetyFloor';

export type LoadModelFn = (name: string, worldScale: number) => Promise<THREE.Object3D>;

export interface BuildTrackOptions {
  /** Metres per grid unit. Default `DEFAULT_CONFIG.worldScale`. */
  worldScale?: number;
  /** Grass cells around the layout bounds. Default `DEFAULT_CONFIG.trackMargin`. */
  margin?: number;
  /** World y (metres) below which `isOutOfBounds` is true. Default `DEFAULT_CONFIG.outOfBoundsY`. */
  outOfBoundsY?: number;
  /** Model loader; defaults to `src/assets/loader.ts`. Tests pass stubs. */
  loadModel?: LoadModelFn;
}

export interface BuiltTrack {
  layout: TrackLayout;
  worldScale: number;
  /** Everything the builder added to the scene. */
  root: THREE.Group;
  /** Surface under the point `(x, z)` in metres; `null` where there is no ground. */
  surfaceAt(x: number, z: number): SurfaceType | null;
  /** True if `pos.y` is below the out-of-bounds threshold (falling only, not distance based). */
  isOutOfBounds(pos: { x: number; y: number; z: number }): boolean;
  /** Kind of a collider created by the builder, keyed by Rapier collider handle. */
  colliderKind(handle: number): ColliderKind | undefined;
  /** Removes the root from the scene and the colliders/bodies from the world. */
  dispose(): void;
}

/** Thickness (m) of the ground and safety floor boxes. */
const SLAB = 1;
/** Top of the safety floor (m) and how far it extends past the ground on each side (m). */
const SAFETY_TOP = -30;
const SAFETY_EXTENT = 100;
/** Grass placed under corner tiles sits this far below y = 0 (m) to avoid z-fighting. */
const UNDERLAY_Y = -0.02;

const SKY_COLOR = 0x87ceeb;

export async function buildTrack(
  layout: TrackLayout,
  scene: THREE.Scene,
  world: RAPIER.World,
  options: BuildTrackOptions = {},
): Promise<BuiltTrack> {
  const S = options.worldScale ?? DEFAULT_CONFIG.worldScale;
  const margin = options.margin ?? DEFAULT_CONFIG.trackMargin;
  const outOfBoundsY = options.outOfBoundsY ?? DEFAULT_CONFIG.outOfBoundsY;
  const load = options.loadModel ?? defaultLoadModel;

  const root = new THREE.Group();
  root.name = 'track';
  const disposables: { dispose(): void }[] = [];
  const colliders: RAPIER.Collider[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const kinds = new Map<number, ColliderKind>();

  const { min, max } = layout.bounds;
  const x0 = min.x - margin;
  const z0 = min.z - margin;
  const x1 = max.x + 1 + margin; // exclusive cell edge
  const z1 = max.z + 1 + margin;

  // Load all models up front, so a failure leaves nothing behind in the scene or world.
  const [grassModel, ...pieceModels] = await Promise.all([
    load('grass', S),
    ...layout.pieces.map((p) => load(getTile(p.tileId).model, S)),
  ]);

  // --- Tile meshes -------------------------------------------------------------------
  const tiles = new THREE.Group();
  tiles.name = 'tiles';
  layout.pieces.forEach((piece, i) => {
    const model = pieceModels[i] as THREE.Object3D;
    // Left corners use the same (unreversed) model, see `TrackPiece.placement`.
    const t = tileTransform(getTile(piece.tileId), piece.placement);
    model.position.set(t.x * S, 0, t.z * S);
    model.rotation.y = t.rotationY;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
    tiles.add(model);
  });
  root.add(tiles);

  // --- Grass (instanced) -------------------------------------------------------------
  // Empty cells in bounds +/- margin, plus an underlay below every corner footprint (the
  // corner tiles' own grass is only a partial ground plane).
  const grassCells: { x: number; z: number; y: number }[] = [];
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const pi = layout.pieceAt({ x, z });
      if (pi === null) grassCells.push({ x, z, y: 0 });
      else if (layout.pieces[pi]?.kind === 'corner') grassCells.push({ x, z, y: UNDERLAY_Y });
    }
  }
  grassModel.updateMatrixWorld(true);
  const grassTile = getTile('grass');
  const instMatrix = new THREE.Matrix4();
  const shift = new THREE.Matrix4();
  const grassMeshes: THREE.Mesh[] = [];
  grassModel.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) grassMeshes.push(o as THREE.Mesh);
  });
  if (grassCells.length > 0) {
    for (const src of grassMeshes) {
      const inst = new THREE.InstancedMesh(src.geometry, src.material, grassCells.length);
      inst.name = 'grass';
      inst.receiveShadow = true;
      grassCells.forEach((c, i) => {
        const t = tileTransform(grassTile, { cell: { x: c.x, z: c.z }, rotation: 0 });
        shift.makeTranslation(t.x * S, c.y, t.z * S);
        instMatrix.multiplyMatrices(shift, src.matrixWorld);
        inst.setMatrixAt(i, instMatrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.frustumCulled = false;
      disposables.push(inst); // frees the instance buffer only, not the shared geometry
      root.add(inst);
    }
  }

  // --- Physics -----------------------------------------------------------------------
  const sx = (x1 - x0) * S;
  const sz = (z1 - z0) * S;
  const cx = ((x0 + x1) / 2) * S;
  const cz = ((z0 + z1) / 2) * S;
  const addBox = (
    hx: number,
    hy: number,
    hz: number,
    x: number,
    y: number,
    z: number,
    k: ColliderKind,
  ) => {
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z),
    );
    colliders.push(collider);
    kinds.set(collider.handle, k);
  };
  addBox(sx / 2, SLAB / 2, sz / 2, cx, -SLAB / 2, cz, 'ground');
  addBox(
    sx / 2 + SAFETY_EXTENT,
    SLAB / 2,
    sz / 2 + SAFETY_EXTENT,
    cx,
    SAFETY_TOP - SLAB / 2,
    cz,
    'safetyFloor',
  );

  // --- Lighting and sky --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 0.8);
  hemi.name = 'hemisphere';
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.name = 'sun';
  const radius = Math.hypot(sx, sz) / 2;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx - radius * 0.5, radius * 1.2, cz + radius * 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 0.5;
  cam.far = radius * 4;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  root.add(hemi, sun, sun.target);
  disposables.push(hemi, sun);

  const prevBackground = scene.background;
  const prevFog = scene.fog;
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, radius * 4, radius * 10);

  scene.add(root);

  let disposed = false;
  return {
    layout,
    worldScale: S,
    root,
    surfaceAt: (x, z) => surfaceAtGrid(layout, x / S, z / S, margin),
    isOutOfBounds: (pos) => pos.y < outOfBoundsY,
    colliderKind: (handle) => kinds.get(handle),
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      for (const c of colliders) world.removeCollider(c, false);
      for (const b of bodies) world.removeRigidBody(b);
      for (const d of disposables) d.dispose();
      colliders.length = 0;
      bodies.length = 0;
      kinds.clear();
      scene.background = prevBackground;
      scene.fog = prevFog;
    },
  };
}
