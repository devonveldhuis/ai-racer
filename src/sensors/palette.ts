/**
 * The debug overlay palette: one fixed colour per `SensorClass`, used for the ground sample
 * markers, the obstacle hit markers and the legend in the side panel. Chosen to stay visible
 * on the green ground and the grey road.
 */
import type { SensorClass } from '../control/types';

export const SENSOR_COLORS: Readonly<Record<SensorClass, number>> = {
  straight: 0xffffff, // white
  left_curve: 0x38bdf8, // sky blue
  right_curve: 0xfb923c, // orange
  start_finish: 0xfacc15, // yellow
  kerb: 0xef4444, // red
  grass: 0xd946ef, // magenta
  sand: 0x92400e, // brown
  wall: 0x1e293b, // dark slate
  obstacle: 0xff2d55, // hot pink-red
  void: 0x000000, // black
};

export function cssColor(c: SensorClass): string {
  return `#${SENSOR_COLORS[c].toString(16).padStart(6, '0')}`;
}
