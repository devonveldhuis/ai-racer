import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTrack, type LoadModelFn } from './builder';
import { generateTrack } from './generator';

beforeAll(async () => {
  await RAPIER.init();
});

/** Stub loader: a cached box geometry/material shared by all clones, like the real loader. */
function stubLoader() {
  const geometry = new THREE.BoxGeometry(1, 0.01, 1);
  const material = new THREE.MeshBasicMaterial();
  let disposedGeometry = 0;
  let disposedMaterial = 0;
  geometry.addEventListener('dispose', () => disposedGeometry++);
  material.addEventListener('dispose', () => disposedMaterial++);
  const loadModel: LoadModelFn = async (_name, scale) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geometry, material));
    g.scale.setScalar(scale);
    return g;
  };
  return {
    loadModel,
    disposed: () => ({ geometry: disposedGeometry, material: disposedMaterial }),
  };
}

const sceneAndWorld = () => ({
  scene: new THREE.Scene(),
  world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }),
});

describe('buildTrack', () => {
  it('builds and disposes 20 seeds without leaking scene children, colliders or bodies', async () => {
    const { scene, world } = sceneAndWorld();
    scene.add(new THREE.Group()); // something that was already there
    const stub = stubLoader();
    const before = {
      children: scene.children.length,
      colliders: world.colliders.len(),
      bodies: world.bodies.len(),
    };
    for (let seed = 100; seed < 120; seed++) {
      const built = await buildTrack(generateTrack(seed), scene, world, {
        loadModel: stub.loadModel,
      });
      expect(scene.children.length).toBe(before.children + 1);
      expect(world.colliders.len()).toBe(before.colliders + 2);
      built.dispose();
      expect(scene.children.length).toBe(before.children);
      expect(world.colliders.len()).toBe(before.colliders);
      expect(world.bodies.len()).toBe(before.bodies);
      built.dispose(); // idempotent
    }
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
    // Shared geometry and materials from the loader are never disposed by the builder.
    expect(stub.disposed()).toEqual({ geometry: 0, material: 0 });
  });

  it('creates a ground and a safety floor collider and tags them', async () => {
    const { scene, world } = sceneAndWorld();
    const layout = generateTrack(3);
    const built = await buildTrack(layout, scene, world, {
      loadModel: stubLoader().loadModel,
      margin: 2,
      worldScale: 4,
    });
    const kinds: Record<string, number> = {};
    world.colliders.forEach((c) => {
      const k = built.colliderKind(c.handle) ?? 'none';
      kinds[k] = (kinds[k] ?? 0) + 1;
    });
    expect(kinds).toEqual({ ground: 1, safetyFloor: 1 });
    expect(built.colliderKind(123456)).toBeUndefined();

    // The ground's top is at y = 0 and covers the bounds + margin rectangle.
    world.step();
    const { min, max } = layout.bounds;
    const hit = (x: number, z: number) =>
      world.castRay(new RAPIER.Ray({ x, y: 5, z }, { x: 0, y: -1, z: 0 }), 50, true);
    const cx = ((min.x + max.x + 1) / 2) * 4;
    const cz = ((min.z + max.z + 1) / 2) * 4;
    const h = hit(cx, cz);
    expect(h?.timeOfImpact).toBeCloseTo(5, 5);
    expect(built.colliderKind(h?.collider.handle ?? -1)).toBe('ground');
    expect(hit((min.x - 2) * 4 + 0.1, cz)?.timeOfImpact).toBeCloseTo(5, 5);
    // Beyond the margin there is no ground, only the safety floor far below.
    const off = hit((min.x - 2) * 4 - 0.1, cz);
    expect(built.colliderKind(off?.collider.handle ?? -1)).toBe('safetyFloor');
    expect(off?.timeOfImpact).toBeCloseTo(35, 5);
    built.dispose();
  });

  it('answers surface queries in metres', async () => {
    const { scene, world } = sceneAndWorld();
    const layout = generateTrack(3);
    const built = await buildTrack(layout, scene, world, {
      loadModel: stubLoader().loadModel,
      worldScale: 4,
    });
    const p = layout.startPose.position;
    expect(built.surfaceAt(p.x * 4, p.z * 4)).toBe('road');
    expect(built.surfaceAt(-1000, -1000)).toBeNull();
    built.dispose();
  });

  it('isOutOfBounds is true only below the threshold', async () => {
    const { scene, world } = sceneAndWorld();
    const built = await buildTrack(generateTrack(4), scene, world, {
      loadModel: stubLoader().loadModel,
      outOfBoundsY: -5,
    });
    expect(built.isOutOfBounds({ x: 0, y: -4.99, z: 0 })).toBe(false);
    expect(built.isOutOfBounds({ x: 0, y: -5, z: 0 })).toBe(false);
    expect(built.isOutOfBounds({ x: 0, y: -5.01, z: 0 })).toBe(true);
    // Far away from the track but not falling: still in bounds.
    expect(built.isOutOfBounds({ x: 9999, y: 1, z: -9999 })).toBe(false);
    built.dispose();
  });

  it('uses the default out-of-bounds height of -5 m', async () => {
    const { scene, world } = sceneAndWorld();
    const built = await buildTrack(generateTrack(4), scene, world, {
      loadModel: stubLoader().loadModel,
    });
    expect(built.isOutOfBounds({ x: 0, y: -6, z: 0 })).toBe(true);
    expect(built.isOutOfBounds({ x: 0, y: 0, z: 0 })).toBe(false);
    built.dispose();
  });
});
