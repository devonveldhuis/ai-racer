import { describe, expect, it } from 'vitest';
import { generateTrack } from '../track/generator';
import { createMinimapMapping } from './minimapMapping';

const S = 4;
const bounds = { min: { x: -2, z: 1 }, max: { x: 7, z: 4 } }; // 10 x 4 cells

describe('createMinimapMapping', () => {
  it('is north-up: east is right, south is down', () => {
    const m = createMinimapMapping(bounds, S, 400, 400, 0);
    const o = m.toPixel(0, 0);
    const east = m.toPixel(10, 0);
    const south = m.toPixel(0, 10);
    expect(east.x).toBeGreaterThan(o.x);
    expect(east.y).toBeCloseTo(o.y);
    expect(south.y).toBeGreaterThan(o.y);
    expect(south.x).toBeCloseTo(o.x);
  });

  it('keeps the aspect ratio and centres the shorter axis', () => {
    const m = createMinimapMapping(bounds, S, 400, 400, 0);
    // 40 m x 16 m into 400 x 400: width limits, scale 10 px/m, 160 px tall centred.
    expect(m.scale).toBeCloseTo(10);
    const tl = m.toPixel(bounds.min.x * S, bounds.min.z * S);
    const br = m.toPixel((bounds.max.x + 1) * S, (bounds.max.z + 1) * S);
    expect(tl.x).toBeCloseTo(0);
    expect(br.x).toBeCloseTo(400);
    expect(tl.y).toBeCloseTo(120);
    expect(br.y).toBeCloseTo(280);
  });

  it('honours padding and reuses the output object', () => {
    const m = createMinimapMapping(bounds, S, 400, 200, 10);
    const out = { x: 0, y: 0 };
    const r = m.toPixel(bounds.min.x * S, bounds.min.z * S, out);
    expect(r).toBe(out);
    expect(out.x).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(out.y).toBeGreaterThanOrEqual(10 - 1e-9);
  });

  it('keeps every centreline point and checkpoint of generated tracks inside the map', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const layout = generateTrack(seed);
      const size = 440;
      const pad = 14;
      const m = createMinimapMapping(layout.bounds, S, size, size, pad);
      for (const p of layout.centreline.points) {
        const q = m.toPixel(p.x * S, p.z * S);
        expect(q.x).toBeGreaterThanOrEqual(pad - 1e-6);
        expect(q.x).toBeLessThanOrEqual(size - pad + 1e-6);
        expect(q.y).toBeGreaterThanOrEqual(pad - 1e-6);
        expect(q.y).toBeLessThanOrEqual(size - pad + 1e-6);
      }
      for (const cp of layout.checkpoints) {
        for (const e of [cp.a, cp.b]) {
          const q = m.toPixel(e.x * S, e.z * S);
          expect(q.x).toBeGreaterThanOrEqual(0);
          expect(q.x).toBeLessThanOrEqual(size);
          expect(q.y).toBeGreaterThanOrEqual(0);
          expect(q.y).toBeLessThanOrEqual(size);
        }
      }
    }
  });

  it('moves a driving car the right way: heading north decreases pixel y', () => {
    const layout = generateTrack(1);
    const m = createMinimapMapping(layout.bounds, S, 440, 440, 14);
    const sp = layout.startPose;
    const x = sp.position.x * S;
    const z = sp.position.z * S;
    const ahead = { x: x + Math.sin(sp.heading) * 5, z: z - Math.cos(sp.heading) * 5 };
    const a = m.toPixel(x, z);
    const b = m.toPixel(ahead.x, ahead.z);
    // The on-screen step is the heading vector (east, south) times the scale.
    expect((b.x - a.x) / m.scale).toBeCloseTo(Math.sin(sp.heading) * 5, 6);
    expect((b.y - a.y) / m.scale).toBeCloseTo(-Math.cos(sp.heading) * 5, 6);
  });
});
