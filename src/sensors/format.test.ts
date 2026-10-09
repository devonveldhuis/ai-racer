import { describe, expect, it } from 'vitest';
import { blankObservation } from '../control/testObservation';
import { formatObservation } from './format';
import { SENSOR_CLASSES } from '../control/types';
import { SENSOR_COLORS, cssColor } from './palette';

describe('formatObservation', () => {
  it('writes one ray per line', () => {
    const o = blankObservation(1.5);
    o.rays = [
      {
        angleDeg: -45,
        samples: [
          { distance: 5, class: 'straight' },
          { distance: 10, class: 'grass' },
        ],
        obstacleDistance: null,
        obstacleClass: null,
      },
      {
        angleDeg: 45,
        samples: [{ distance: 5, class: 'void' }],
        obstacleDistance: 12.5,
        obstacleClass: 'wall',
      },
    ];
    const lines = formatObservation(o).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[3]).toBe(
      '  {"angleDeg":-45,"samples":[["straight",5],["grass",10]],"obstacle":null},',
    );
    expect(lines[4]).toBe('  {"angleDeg":45,"samples":[["void",5]],"obstacle":["wall",12.5]}');
  });
});

describe('palette', () => {
  it('has a distinct colour for every class', () => {
    const colours = SENSOR_CLASSES.map((c) => SENSOR_COLORS[c]);
    expect(new Set(colours).size).toBe(SENSOR_CLASSES.length);
    expect(cssColor('left_curve')).toBe('#38bdf8');
    expect(cssColor('void')).toBe('#000000');
  });
});
