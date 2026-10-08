import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { parseUrlOverrides } from './core/config';
import { GameLoop } from './core/loop';

async function main(): Promise<void> {
  const config = parseUrlOverrides(window.location.search);
  await RAPIER.init();

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 1, 0);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 10, 4);
  sun.castShadow = true;
  scene.add(sun);

  // Ground: three.js mesh + Rapier fixed collider.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a7d44 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / config.physicsHz;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, -0.1, 0));

  // Falling cube: Rapier dynamic body + three.js mesh.
  const half = 0.5;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 6, 0)
      .setRotation({ x: 0.2, y: 0.1, z: 0.3, w: 0.93 }),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setRestitution(0.3), body);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(half * 2, half * 2, half * 2),
    new THREE.MeshStandardMaterial({ color: 0xd62828 }),
  );
  cube.castShadow = true;
  scene.add(cube);

  const prevPos = new THREE.Vector3().copy(body.translation());
  const prevQuat = new THREE.Quaternion().copy(body.rotation());
  const curPos = new THREE.Vector3();
  const curQuat = new THREE.Quaternion();

  const loop = new GameLoop({
    hz: config.physicsHz,
    maxSubSteps: config.maxSubSteps,
    update: () => {
      prevPos.copy(body.translation());
      prevQuat.copy(body.rotation());
      world.step();
    },
    render: (alpha) => {
      curPos.copy(body.translation());
      curQuat.copy(body.rotation());
      cube.position.lerpVectors(prevPos, curPos, alpha);
      cube.quaternion.slerpQuaternions(prevQuat, curQuat, alpha);
      renderer.render(scene, camera);
    },
  });
  loop.start();

  if (config.debug) {
    const ui = document.getElementById('ui');
    if (ui) ui.textContent = `seed=${config.seed} controller=${config.controller}`;
  }
}

main().catch((err) => {
  console.error(err);
});
