import type { Observation } from '../control/types';

/**
 * The debug panel text: the observation as compact JSON with one ray per line. This is a
 * display format: the ground samples are written as `[class, distance]` pairs and the
 * obstacle fields as one `obstacle` entry to keep the lines short (the real observation uses
 * the full `RaySample` shape).
 */
export function formatObservation(o: Observation): string {
  const lines: string[] = [];
  lines.push(`{"t":${o.t},"progress":${JSON.stringify(o.progress)},`);
  lines.push(` "car":${JSON.stringify(o.car)},`);
  lines.push(' "rays":[');
  o.rays.forEach((r, i) => {
    const samples = r.samples.map((s) => `["${s.class}",${s.distance}]`).join(',');
    const obstacle =
      r.obstacleDistance === null ? 'null' : `["${r.obstacleClass}",${r.obstacleDistance}]`;
    lines.push(
      `  {"angleDeg":${r.angleDeg},"samples":[${samples}],"obstacle":${obstacle}}${i < o.rays.length - 1 ? ',' : ''}`,
    );
  });
  lines.push(' ]}');
  return lines.join('\n');
}
