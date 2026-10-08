/**
 * Dust puffs behind wheels on grass or sand: a `DustPool` drawn as one `THREE.Points`. Purely
 * visual and driven by render-time `dt`. The pool, geometry and material belong to the session
 * and are freed by `dispose()`.
 */
import * as THREE from 'three';
import type { SurfaceType } from '../assets/surfaces';
import type { CarConfig } from '../core/config';
import { DustPool } from './DustPool';

export const DUST_CAPACITY = 256;
const MIN_SPEED = 2; // m/s
const FULL_SPEED = 25; // m/s: the emission rate is at its maximum from here
const MAX_RATE = 45; // particles per second per wheel
const LIFE_MIN = 0.6;
const LIFE_MAX = 1.0;
const LIFT = 0.04; // m above the ground

const COLORS: Partial<Record<SurfaceType, [number, number, number]>> = {
  grass: [0.72, 0.68, 0.48],
  sand: [0.85, 0.74, 0.5],
};

const VERT = /* glsl */ `
  attribute float aAge;
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uViewportH;
  varying float vAge;
  varying vec3 vColor;
  void main() {
    vAge = aAge;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float grow = 0.6 + 1.2 * aAge;
    gl_PointSize = uSize * grow * uViewportH * 0.5 * projectionMatrix[1][1] / max(0.1, -mv.z);
  }
`;
const FRAG = /* glsl */ `
  varying float vAge;
  varying vec3 vColor;
  void main() {
    if (vAge >= 1.0) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = smoothstep(1.0, 0.2, d);
    gl_FragColor = vec4(vColor, soft * (1.0 - vAge) * 0.55);
  }
`;

export class Dust {
  readonly pool = new DustPool(DUST_CAPACITY);
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly carConfig: Pick<CarConfig, 'wheelX' | 'frontAxleZ' | 'rearAxleZ'>;
  private readonly carry = [0, 0, 0, 0];

  constructor(carConfig: Pick<CarConfig, 'wheelX' | 'frontAxleZ' | 'rearAxleZ'>) {
    this.carConfig = carConfig;
    const p = this.pool;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(p.colors, 3));
    this.geometry.setAttribute('aAge', new THREE.BufferAttribute(p.age, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uSize: { value: 0.5 }, uViewportH: { value: 720 } },
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'dust';
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /**
   * Per rendered frame. `emit` false only ages the existing puffs (paused, finished, ...).
   * `heading`/`position` are the car's (metres, `layout.ts` heading), `wheelSurfaces` as in
   * `CarState` (front left, front right, rear left, rear right).
   */
  update(
    dt: number,
    emit: boolean,
    car: {
      position: { x: number; z: number };
      heading: number;
      speed: number;
      wheelSurfaces: readonly (SurfaceType | null)[];
    },
    viewportHeightPx: number,
  ): void {
    if (emit) this.emitFrom(dt, car);
    this.pool.update(dt);
    this.material.uniforms.uViewportH!.value = viewportHeightPx;
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }

  private emitFrom(
    dt: number,
    car: {
      position: { x: number; z: number };
      heading: number;
      speed: number;
      wheelSurfaces: readonly (SurfaceType | null)[];
    },
  ): void {
    const speed = Math.abs(car.speed);
    const k = Math.min(1, Math.max(0, (speed - MIN_SPEED) / (FULL_SPEED - MIN_SPEED)));
    const c = this.carConfig;
    const fx = Math.sin(car.heading);
    const fz = -Math.cos(car.heading);
    // Right-hand vector on the ground; the left wheels (even index) are at -right.
    const rx = Math.cos(car.heading);
    const rz = Math.sin(car.heading);
    for (let i = 0; i < 4; i++) {
      const surf = car.wheelSurfaces[i];
      const col = surf ? COLORS[surf] : undefined;
      if (!col || speed <= MIN_SPEED) {
        this.carry[i] = 0;
        continue;
      }
      this.carry[i] = (this.carry[i] as number) + MAX_RATE * k * dt;
      const side = i % 2 === 0 ? -c.wheelX : c.wheelX;
      const along = i < 2 ? c.frontAxleZ : c.rearAxleZ;
      const wx = car.position.x + fx * along + rx * side;
      const wz = car.position.z + fz * along + rz * side;
      const sign = car.speed >= 0 ? 1 : -1;
      while ((this.carry[i] as number) >= 1) {
        this.carry[i] = (this.carry[i] as number) - 1;
        const j = () => Math.random() - 0.5;
        this.pool.spawn(
          wx + j() * 0.3,
          LIFT,
          wz + j() * 0.3,
          -fx * speed * 0.1 * sign + j() * 1.2,
          0.8 + Math.random() * 0.9,
          -fz * speed * 0.1 * sign + j() * 1.2,
          LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN),
          col[0],
          col[1],
          col[2],
        );
      }
    }
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
