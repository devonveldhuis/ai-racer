export type ControllerKind = 'keyboard' | 'bot' | 'remote';

export interface GameConfig {
  /** Track / RNG seed. */
  seed: number;
  /** Which driver controls the car. */
  controller: ControllerKind;
  /** Show debug overlays. */
  debug: boolean;
  /** Fixed physics rate in Hz. */
  physicsHz: number;
  /** Max physics substeps per rendered frame (spiral-of-death guard). */
  maxSubSteps: number;
  /** Metres per model unit: converts GLB units (1 tile = 1 unit) into physics metres. */
  worldScale: number;
  /** Empty grass cells added around the track bounds (the ground ends there). */
  trackMargin: number;
  /** Bodies below this world y (metres) count as out of bounds. */
  outOfBoundsY: number;
}

export const CONTROLLER_KINDS: readonly ControllerKind[] = ['keyboard', 'bot', 'remote'];

export const DEFAULT_CONFIG: Readonly<GameConfig> = {
  seed: 1,
  controller: 'keyboard',
  debug: false,
  physicsHz: 60,
  maxSubSteps: 5,
  worldScale: 4,
  trackMargin: 3,
  outOfBoundsY: -5,
};

function parseBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (s === '' || s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return undefined;
}

/**
 * Reads `seed`, `controller` and `debug` query params over the defaults.
 * Invalid values are ignored (the default is kept).
 */
export function parseUrlOverrides(
  search: string | URLSearchParams,
  base: Readonly<GameConfig> = DEFAULT_CONFIG,
): GameConfig {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const config: GameConfig = { ...base };

  const seed = params.get('seed');
  if (seed !== null && /^-?\d+$/.test(seed.trim())) {
    const n = Number(seed.trim());
    if (Number.isSafeInteger(n)) config.seed = n;
  }

  const controller = params.get('controller');
  if (controller !== null) {
    const c = controller.trim().toLowerCase() as ControllerKind;
    if (CONTROLLER_KINDS.includes(c)) config.controller = c;
  }

  const debug = params.get('debug');
  if (debug !== null) {
    const b = parseBool(debug);
    if (b !== undefined) config.debug = b;
  }

  return config;
}
