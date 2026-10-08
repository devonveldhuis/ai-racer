import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_CONFIG } from '../core/config';

/**
 * Every Racing Kit GLB has its root node translated by this (an export artefact).
 * We add the opposite so a tile's footprint corner sits at the local origin
 * (mesh spans x in [0,w], z in [-d,0], y = 0 at the road surface).
 */
export const ROOT_OFFSET = new THREE.Vector3(-0.35, -0.01, -0.65);

export const MODELS_URL = '/models/';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

async function fetchAndParse(name: string): Promise<THREE.Object3D> {
  const url = `${MODELS_URL}${encodeURIComponent(name)}.glb`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to load model "${name}" (${url}): ${String(err)}`, { cause: err });
  }
  if (!res.ok) {
    throw new Error(`Failed to load model "${name}" (${url}): HTTP ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  let gltf;
  try {
    gltf = await loader.parseAsync(buffer, MODELS_URL);
  } catch (err) {
    throw new Error(`Model "${name}" (${url}) is not a valid GLB: ${String(err)}`, { cause: err });
  }
  const holder = new THREE.Group();
  holder.name = name;
  gltf.scene.position.sub(ROOT_OFFSET);
  gltf.scene.updateMatrix();
  holder.add(gltf.scene);
  return holder;
}

/**
 * Load `Models/<name>.glb` (cached). Resolves to a fresh clone every call, with the root
 * offset cancelled and uniformly scaled by `worldScale` (metres per model unit). Geometry
 * and materials are shared between clones. Rejects with an error naming the model.
 */
export async function loadModel(
  name: string,
  worldScale: number = DEFAULT_CONFIG.worldScale,
): Promise<THREE.Object3D> {
  let pending = cache.get(name);
  if (!pending) {
    pending = fetchAndParse(name);
    cache.set(name, pending);
    // Do not cache failures: a later retry may succeed.
    pending.catch(() => cache.delete(name));
  }
  const clone = (await pending).clone(true);
  clone.scale.setScalar(worldScale);
  return clone;
}

/** Load several models in parallel; `onProgress(done, total, name)` fires as each finishes. */
export async function preloadModels(
  names: readonly string[],
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<void> {
  const unique = [...new Set(names)];
  let done = 0;
  await Promise.all(
    unique.map(async (name) => {
      await loadModel(name);
      done++;
      onProgress?.(done, unique.length, name);
    }),
  );
}
