/**
 * Minimap: a north-up 2D canvas. The track (a thick centreline stroke and the start/finish
 * line) is drawn once per layout into an offscreen canvas; each frame only the car and the
 * next checkpoint are drawn on top, and only if something moved by about a pixel.
 */
import type { TrackLayout } from '../track/layout';
import { createMinimapMapping, type MinimapMapping } from './minimapMapping';

const SIZE = 440; // internal resolution; CSS scales it (about 150-220 px on screen)
const ACCENT = '#ffd23f';

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private layout: TrackLayout | null = null;
  private worldScale = 1;
  private map: MinimapMapping | null = null;
  private readonly px = { x: 0, y: 0 };
  private readonly pa = { x: 0, y: 0 };
  private readonly pb = { x: 0, y: 0 };
  private last = { x: NaN, y: NaN, heading: NaN, cp: -1 };

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ar-minimap';
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.base = document.createElement('canvas');
    this.base.width = SIZE;
    this.base.height = SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    parent.appendChild(this.canvas);
  }

  /** Draws the track of `layout` (metres = grid units x `worldScale`) into the offscreen canvas. */
  setLayout(layout: TrackLayout | null, worldScale: number): void {
    this.layout = layout;
    this.worldScale = worldScale;
    this.map = layout ? createMinimapMapping(layout.bounds, worldScale, SIZE, SIZE, 14) : null;
    this.last = { x: NaN, y: NaN, heading: NaN, cp: -1 };
    const g = this.base.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, SIZE, SIZE);
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    if (!layout || !this.map) return;
    const map = this.map;
    const S = worldScale;
    const pts = layout.centreline.points;
    const roadW = Math.max(6, Math.min(18, map.scale * S * 0.6));
    const path = () => {
      g.beginPath();
      pts.forEach((p, i) => {
        const q = map.toPixel(p.x * S, p.z * S, this.px);
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
      g.closePath();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    path();
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.lineWidth = roadW + 5;
    g.stroke();
    path();
    g.strokeStyle = '#c9ced6';
    g.lineWidth = roadW;
    g.stroke();
    // Start/finish: the last checkpoint.
    const fin = layout.checkpoints[layout.checkpoints.length - 1];
    if (fin) {
      g.beginPath();
      const a = map.toPixel(fin.a.x * S, fin.a.z * S, this.pa);
      g.moveTo(a.x, a.y);
      const b = map.toPixel(fin.b.x * S, fin.b.z * S, this.pb);
      g.lineTo(b.x, b.y);
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      g.lineCap = 'butt';
      g.stroke();
      g.strokeStyle = '#111';
      g.setLineDash([4, 4]);
      g.lineWidth = 5;
      g.stroke();
      g.setLineDash([]);
    }
    this.canvas.dataset.ready = '1';
  }

  /** Per frame. `x`/`z` in metres, `heading` in radians, `nextCheckpoint` an index. */
  update(x: number, z: number, heading: number, nextCheckpoint: number): void {
    const map = this.map;
    const layout = this.layout;
    if (!map || !layout) return;
    const p = map.toPixel(x, z, this.px);
    const l = this.last;
    if (
      Math.abs(p.x - l.x) < 1 &&
      Math.abs(p.y - l.y) < 1 &&
      Math.abs(heading - l.heading) < 0.05 &&
      nextCheckpoint === l.cp
    ) {
      return;
    }
    l.x = p.x;
    l.y = p.y;
    l.heading = heading;
    l.cp = nextCheckpoint;

    const g = this.ctx;
    g.clearRect(0, 0, SIZE, SIZE);
    g.drawImage(this.base, 0, 0);
    const S = this.worldScale;
    const cp = layout.checkpoints[nextCheckpoint];
    if (cp) {
      const a = map.toPixel(cp.a.x * S, cp.a.z * S, this.pa);
      const ax = a.x;
      const ay = a.y;
      const b = map.toPixel(cp.b.x * S, cp.b.z * S, this.pb);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(b.x, b.y);
      g.strokeStyle = ACCENT;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.stroke();
    }
    // The car: a dot with a heading tick (direction (sin h, -cos h) in x/z = same on screen).
    const cx = p.x;
    const cy = p.y;
    const dx = Math.sin(heading);
    const dy = -Math.cos(heading);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + dx * 22, cy + dy * 22);
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 8, 0, Math.PI * 2);
    g.fillStyle = '#ff4136';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#fff';
    g.stroke();
  }

  dispose(): void {
    this.canvas.remove();
    this.layout = null;
    this.map = null;
  }
}
