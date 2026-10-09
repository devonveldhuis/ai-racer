import type { SurfaceType } from '../assets/surfaces';

export type ControllerKind = 'keyboard' | 'bot' | 'remote';

/** How the sim treats a controller that is still thinking: keep running, or wait for it. */
export type ControlMode = 'realtime' | 'lockstep';

export type CarColour = 'Red' | 'Green' | 'Orange' | 'White';

/**
 * Car tuning. Lengths in metres, forces in N, angles in radians. The car frame is x right,
 * y up, z forward (the model faces +z); the body origin sits at the axle height, halfway
 * between the axles. Dimensions are the Racing Kit car (0.55 x 1.35 model units) x `modelScale` 2.
 */
export interface CarConfig {
  /** `raceCar<Colour>.glb`. */
  colour: CarColour;
  /** Metres per GLB unit for the car model (the track uses `worldScale`). */
  modelScale: number;
  mass: number;
  /** Chassis cuboid half extents and its centre height above the body origin. */
  halfExtents: { x: number; y: number; z: number };
  colliderY: number;
  /** Centre of mass height above the body origin (negative = low). */
  comY: number;
  /** Principal inertia multiplier on top of the solid box value (bigger = lazier rotation). */
  inertiaScale: number;
  angularDamping: number;
  /** Wheel centre x offset from the centre line, and the axle z positions. */
  wheelX: number;
  frontAxleZ: number;
  rearAxleZ: number;
  wheelRadius: number;
  /** Hard point height above the body origin. */
  connectionY: number;
  suspension: {
    restLength: number;
    maxTravel: number;
    stiffness: number;
    compression: number;
    relaxation: number;
    maxForce: number;
  };
  /** Lateral grip stiffness of the tyres (Rapier `sideFrictionStiffness`). */
  sideFrictionStiffness: number;
  /** Anti-roll: torque (N m per rad) about the car's forward axis that levels the body. */
  antiRoll: number;
  /** Total engine force (N) over the four driven wheels at accelerator 1, and total brake at
   * accelerator 0 in Rapier brake units (about 0.09 m/s2 of deceleration per unit). */
  maxEngineForce: number;
  /** The engine force fades linearly to zero at this forward speed (m/s), like a power curve. */
  engineTopSpeed: number;
  maxBrakeForce: number;
  /** Accelerator value that means "coast"; below brakes, above drives. */
  neutral: number;
  /** Max steer angle: `steerAngleLow` at 0 m/s blending linearly to `steerAngleHigh` at
   * `steerFalloffSpeed` and above. */
  steerAngleLow: number;
  steerAngleHigh: number;
  steerFalloffSpeed: number;
  /** Max rate of change of the wheel angle (rad/s). */
  steerRate: number;
  /** Height above the ground (m) a reset places the body origin at. */
  resetHeight: number;
}

/** Grip and drag per surface. `drag` is a linear velocity damping (1/s) on the chassis,
 * weighted by the share of wheels on the surface. */
export interface SurfaceParams {
  frictionSlip: number;
  drag: number;
}

export interface KeyboardConfig {
  /** Accelerator change per second towards throttle, brake and back to neutral. */
  accelRate: number;
  brakeRate: number;
  accelReturnRate: number;
  /** Steering change per second towards a held key, and back to centre when released. */
  steerRate: number;
  steerReturnRate: number;
}

export interface ChaseCameraConfig {
  /** Metres behind the car, metres above it and metres ahead of it that the camera looks at. */
  distance: number;
  height: number;
  lookAhead: number;
  /** Exponential smoothing rate (1/s): the fraction closed per second is 1 - exp(-stiffness). */
  stiffness: number;
  /** Height (m) of the top-down camera. */
  topDownHeight: number;
  fov: number;
}

export interface RaceConfig {
  /** Laps to finish. */
  laps: number;
  /** Seconds per countdown tick (3, 2, 1, GO). */
  countdownStepSeconds: number;
  /** Seconds added to the race time for every reset. */
  resetPenaltySeconds: number;
  /** A car upside down (chassis up y < 0.3) for this long is reset. */
  flipResetSeconds: number;
}

/** The ray-cone sensor (see `src/sensors/RayConeSensor.ts`). */
export interface SensorConfig {
  /** Total opening angle of the cone in degrees; rays span -fov/2 ... +fov/2. */
  fovDeg: number;
  /** Number of rays, ordered left to right. With 1 there is a single ray at 0 degrees. */
  rayCount: number;
  /** Distances (m) along each ray at which the ground is classified. */
  sampleDistances: number[];
  /** Length (m) of the obstacle cast. */
  maxRange: number;
  /** Height (m) above the car's position at which the obstacle cast starts. */
  heightOffset: number;
}

/** The remote controller (`?controller=remote&url=...`). */
export interface RemoteConfig {
  /** http(s) endpoint that takes `{ observation }` and returns an action; `null` = not set. */
  url: string | null;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
}

export interface GameConfig {
  /** Track / RNG seed. */
  seed: number;
  /** Which driver controls the car. */
  controller: ControllerKind;
  /** `realtime`: the sim runs while a decision is pending; `lockstep`: it waits for it. */
  controlMode: ControlMode;
  /** Decisions per simulated second, per controller kind. */
  decisionHz: Record<ControllerKind, number>;
  /** Keyboard ramp rates (units per second) and chase camera tuning. */
  keyboard: KeyboardConfig;
  camera: ChaseCameraConfig;
  race: RaceConfig;
  sensor: SensorConfig;
  remote: RemoteConfig;
  /** Capacity of the decision log (entries; oldest dropped first). Used for non-keyboard controllers. */
  decisionLogCapacity: number;
  /** Show debug overlays (the sensor overlay starts visible; `F1` toggles it). */
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
  car: CarConfig;
  surfaces: Record<SurfaceType, SurfaceParams>;
}

export const CONTROLLER_KINDS: readonly ControllerKind[] = ['keyboard', 'bot', 'remote'];

export const DEFAULT_CONFIG: Readonly<GameConfig> = {
  seed: 1,
  controller: 'keyboard',
  controlMode: 'realtime',
  decisionHz: { keyboard: 60, bot: 10, remote: 10 },
  keyboard: {
    accelRate: 2.4,
    brakeRate: 4,
    accelReturnRate: 4,
    steerRate: 3.3,
    steerReturnRate: 6.7,
  },
  camera: {
    distance: 7,
    height: 3.2,
    lookAhead: 3,
    stiffness: 6,
    topDownHeight: 45,
    fov: 60,
  },
  race: { laps: 1, countdownStepSeconds: 1, resetPenaltySeconds: 2, flipResetSeconds: 2 },
  sensor: {
    fovDeg: 90,
    rayCount: 9,
    sampleDistances: [5, 10, 20, 35],
    maxRange: 40,
    heightOffset: 0.5,
  },
  remote: { url: null, timeoutMs: 2000 },
  decisionLogCapacity: 20_000,
  debug: false,
  physicsHz: 60,
  maxSubSteps: 5,
  worldScale: 4,
  trackMargin: 3,
  outOfBoundsY: -5,
  car: {
    colour: 'Red',
    modelScale: 2,
    mass: 400,
    halfExtents: { x: 0.55, y: 0.25, z: 1.35 },
    colliderY: 0.225,
    comY: -0.15,
    inertiaScale: 1.5,
    angularDamping: 2,
    wheelX: 0.57,
    frontAxleZ: 0.8,
    rearAxleZ: -0.8,
    wheelRadius: 0.282,
    connectionY: 0.15,
    suspension: {
      restLength: 0.15,
      maxTravel: 0.125,
      stiffness: 60,
      compression: 5.7,
      relaxation: 8.5,
      maxForce: 12000,
    },
    sideFrictionStiffness: 1,
    antiRoll: 600,
    maxEngineForce: 2800,
    engineTopSpeed: 42,
    maxBrakeForce: 60,
    neutral: 0.5,
    steerAngleLow: 0.8,
    steerAngleHigh: 0.1,
    steerFalloffSpeed: 30,
    steerRate: 4,
    resetHeight: 0.2,
  },
  surfaces: {
    road: { frictionSlip: 3, drag: 0.05 },
    kerb: { frictionSlip: 2.6, drag: 0.07 },
    grass: { frictionSlip: 1.5, drag: 0.6 },
    sand: { frictionSlip: 1.0, drag: 1.6 },
    wall: { frictionSlip: 1.0, drag: 1.0 },
  },
};

function parseBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (s === '' || s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return undefined;
}

/**
 * Reads `seed`, `controller`, `mode` (control mode), `laps`, `debug`, `fov` (degrees, 1 to 360)
 * and `rays` (integer, 1 to 101), `url` (http or https URL of the remote controller) and
 * `timeoutMs` (integer, 1 to 600000) query params over the defaults.
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

  const mode = params.get('mode');
  if (mode !== null) {
    const m = mode.trim().toLowerCase();
    if (m === 'realtime' || m === 'lockstep') config.controlMode = m;
  }

  const laps = params.get('laps');
  if (laps !== null && /^\d+$/.test(laps.trim())) {
    const n = Number(laps.trim());
    if (Number.isSafeInteger(n) && n >= 1) config.race = { ...base.race, laps: n };
  }

  const debug = params.get('debug');
  if (debug !== null) {
    const b = parseBool(debug);
    if (b !== undefined) config.debug = b;
  }

  const fov = params.get('fov');
  if (fov !== null && /^\d+(\.\d+)?$/.test(fov.trim())) {
    const n = Number(fov.trim());
    if (n >= 1 && n <= 360) config.sensor = { ...config.sensor, fovDeg: n };
  }

  const rays = params.get('rays');
  if (rays !== null && /^\d+$/.test(rays.trim())) {
    const n = Number(rays.trim());
    if (n >= 1 && n <= 101) config.sensor = { ...config.sensor, rayCount: n };
  }

  const url = params.get('url');
  if (url !== null) {
    const u = parseHttpUrl(url);
    if (u !== null) config.remote = { ...config.remote, url: u };
  }

  const timeoutMs = params.get('timeoutMs');
  if (timeoutMs !== null && /^\d+$/.test(timeoutMs.trim())) {
    const n = Number(timeoutMs.trim());
    if (n >= 1 && n <= 600_000) config.remote = { ...config.remote, timeoutMs: n };
  }

  return config;
}

/** The trimmed URL if it parses and is http or https; otherwise `null`. */
export function parseHttpUrl(v: string): string | null {
  const s = v.trim();
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}
