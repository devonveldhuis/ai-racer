/**
 * Debug view of the ray sensor (`F1`): in 3D a line per ray, a point per ground sample
 * coloured by `SensorClass` (palette in `src/sensors/palette.ts`) and a marker at every
 * obstacle hit; on the page a panel with the current observation as compact JSON.
 *
 * All 3D objects are pooled: fixed-size buffers allocated once, updated in place (the cone
 * never changes size within a session). `dispose()` removes everything from scene and page.
 */
import * as THREE from 'three';
import type { CarState } from '../car/types';
import type { RaySample } from '../control/types';
import { SENSOR_CLASSES } from '../control/types';
import { cssColor, SENSOR_COLORS } from '../sensors/palette';
import { rayDirection } from '../sensors/ground';

export interface SensorOverlayOptions {
  scene: THREE.Scene;
  rayCount: number;
  sampleCount: number;
  maxRange: number;
  /** Where the panel goes. Default `document.body`. */
  parent?: HTMLElement;
}

/** Height (m) above the car's position at which lines and markers are drawn. */
const DRAW_HEIGHT = 0.3;
const SAMPLE_PX = 9;
const HIT_PX = 16;

const COLOR_CACHE = new Map<number, THREE.Color>();
function colorOf(hex: number): THREE.Color {
  let c = COLOR_CACHE.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    COLOR_CACHE.set(hex, c);
  }
  return c;
}

export class SensorOverlay {
  readonly group = new THREE.Group();
  readonly panel: HTMLElement;
  private readonly text: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly maxRange: number;
  private readonly lines: THREE.LineSegments;
  private readonly samples: THREE.Points;
  private readonly hits: THREE.Points;
  private readonly linePos: THREE.BufferAttribute;
  private readonly samplePos: THREE.BufferAttribute;
  private readonly sampleCol: THREE.BufferAttribute;
  private readonly hitPos: THREE.BufferAttribute;
  private readonly hitCol: THREE.BufferAttribute;
  private readonly disposables: { dispose(): void }[] = [];
  private visible = true;
  private disposed = false;

  constructor(opts: SensorOverlayOptions) {
    this.scene = opts.scene;
    this.maxRange = opts.maxRange;
    this.group.name = 'sensor-overlay';

    const { rayCount, sampleCount } = opts;
    this.linePos = new THREE.BufferAttribute(new Float32Array(rayCount * 2 * 3), 3);
    this.samplePos = new THREE.BufferAttribute(new Float32Array(rayCount * sampleCount * 3), 3);
    this.sampleCol = new THREE.BufferAttribute(new Float32Array(rayCount * sampleCount * 3), 3);
    this.hitPos = new THREE.BufferAttribute(new Float32Array(rayCount * 3), 3);
    this.hitCol = new THREE.BufferAttribute(new Float32Array(rayCount * 3), 3);
    for (const a of [this.linePos, this.samplePos, this.sampleCol, this.hitPos, this.hitCol]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', this.linePos);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    });
    this.lines = new THREE.LineSegments(lineGeo, lineMat);

    const sampleGeo = new THREE.BufferGeometry();
    sampleGeo.setAttribute('position', this.samplePos);
    sampleGeo.setAttribute('color', this.sampleCol);
    const sampleMat = new THREE.PointsMaterial({
      size: SAMPLE_PX,
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
    });
    this.samples = new THREE.Points(sampleGeo, sampleMat);

    const hitGeo = new THREE.BufferGeometry();
    hitGeo.setAttribute('position', this.hitPos);
    hitGeo.setAttribute('color', this.hitCol);
    const hitMat = new THREE.PointsMaterial({
      size: HIT_PX,
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
    });
    this.hits = new THREE.Points(hitGeo, hitMat);
    this.hits.geometry.setDrawRange(0, 0);

    for (const o of [this.lines, this.samples, this.hits]) {
      o.frustumCulled = false;
      o.renderOrder = 999;
      this.group.add(o);
    }
    this.disposables.push(lineGeo, lineMat, sampleGeo, sampleMat, hitGeo, hitMat);
    this.scene.add(this.group);

    this.panel = document.createElement('div');
    this.panel.className = 'ar-sensor';
    const legend = document.createElement('div');
    legend.className = 'ar-sensor-legend';
    for (const c of SENSOR_CLASSES) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = cssColor(c);
      item.append(swatch, c);
      legend.appendChild(item);
    }
    this.text = document.createElement('pre');
    this.panel.append(legend, this.text);
    (opts.parent ?? document.body).appendChild(this.panel);
    this.setVisible(true);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
    this.panel.style.display = v ? '' : 'none';
  }

  /** Updates the 3D objects in place from the car pose and the latest rays. No allocation. */
  update(car: CarState, rays: readonly RaySample[]): void {
    if (!this.visible || this.disposed) return;
    const lp = this.linePos.array as Float32Array;
    const sp = this.samplePos.array as Float32Array;
    const sc = this.sampleCol.array as Float32Array;
    const hp = this.hitPos.array as Float32Array;
    const hc = this.hitCol.array as Float32Array;
    const y = car.position.y + DRAW_HEIGHT;
    const px = car.position.x;
    const pz = car.position.z;
    let si = 0;
    let hi = 0;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i] as RaySample;
      const d = rayDirection(car.heading, r.angleDeg);
      const len = r.obstacleDistance ?? this.maxRange;
      lp[i * 6] = px;
      lp[i * 6 + 1] = y;
      lp[i * 6 + 2] = pz;
      lp[i * 6 + 3] = px + d.x * len;
      lp[i * 6 + 4] = y;
      lp[i * 6 + 5] = pz + d.z * len;
      for (const s of r.samples) {
        sp[si * 3] = px + d.x * s.distance;
        sp[si * 3 + 1] = y;
        sp[si * 3 + 2] = pz + d.z * s.distance;
        const c = colorOf(SENSOR_COLORS[s.class]);
        sc[si * 3] = c.r;
        sc[si * 3 + 1] = c.g;
        sc[si * 3 + 2] = c.b;
        si++;
      }
      if (r.obstacleDistance !== null && r.obstacleClass !== null) {
        hp[hi * 3] = px + d.x * r.obstacleDistance;
        hp[hi * 3 + 1] = y;
        hp[hi * 3 + 2] = pz + d.z * r.obstacleDistance;
        const c = colorOf(SENSOR_COLORS[r.obstacleClass]);
        hc[hi * 3] = c.r;
        hc[hi * 3 + 1] = c.g;
        hc[hi * 3 + 2] = c.b;
        hi++;
      }
    }
    this.lines.geometry.setDrawRange(0, rays.length * 2);
    this.samples.geometry.setDrawRange(0, si);
    this.hits.geometry.setDrawRange(0, hi);
    for (const a of [this.linePos, this.samplePos, this.sampleCol, this.hitPos, this.hitCol]) {
      a.needsUpdate = true;
    }
  }

  setText(text: string): void {
    if (this.visible && !this.disposed) this.text.textContent = text;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.panel.remove();
  }
}
