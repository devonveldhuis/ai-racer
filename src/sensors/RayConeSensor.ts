/**
 * The ray-cone sensor: for every ray of a cone fixed to the car's heading it classifies the
 * ground at the configured distances (from the track layout) and finds the first obstacle
 * with a horizontal Rapier ray cast.
 *
 * Obstacle cast: from the car position raised by `heightOffset`, along the ray, up to
 * `maxRange`. The car's own body and the builder's `ground` / `safetyFloor` colliders are
 * ignored. A hit collider whose handle is in `wallColliders` is reported as `wall`, any other
 * as `obstacle`. (The game has no walls or obstacles yet, so there it is always `null`.)
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { CarState } from '../car/types';
import type { SensorConfig } from '../core/config';
import type { RaySample } from '../control/types';
import type { BuiltTrack } from '../track/builder';
import { classifyGround, rayAngles, rayDirection } from './ground';

export interface RayConeSensorOptions {
  world: RAPIER.World;
  track: Pick<BuiltTrack, 'layout' | 'worldScale' | 'surfaceAt' | 'colliderKind'>;
  config: SensorConfig;
  /** The car's body, excluded from the obstacle cast. */
  ownBody?: RAPIER.RigidBody;
}

export class RayConeSensor {
  /** Ray angles in degrees, left to right. */
  readonly angles: readonly number[];
  /** Handles of colliders that count as walls (everything else that is hit is an obstacle). */
  readonly wallColliders = new Set<number>();
  private readonly world: RAPIER.World;
  private readonly track: RayConeSensorOptions['track'];
  private readonly cfg: SensorConfig;
  private readonly ownBody: RAPIER.RigidBody | undefined;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  private readonly origin = this.ray.origin;
  private readonly dir = this.ray.dir;
  private readonly predicate = (c: RAPIER.Collider): boolean =>
    this.track.colliderKind(c.handle) === undefined;

  constructor(opts: RayConeSensorOptions) {
    this.world = opts.world;
    this.track = opts.track;
    this.cfg = opts.config;
    this.ownBody = opts.ownBody;
    this.angles = rayAngles(opts.config.fovDeg, opts.config.rayCount);
  }

  /** One `RaySample` per ray, left to right. Values are unrounded (see `buildObservation`). */
  sense(car: CarState): RaySample[] {
    const { layout } = this.track;
    const { sampleDistances, maxRange, heightOffset } = this.cfg;
    const px = car.position.x;
    const pz = car.position.z;
    this.origin.x = px;
    this.origin.y = car.position.y + heightOffset;
    this.origin.z = pz;
    const out: RaySample[] = [];
    for (const angleDeg of this.angles) {
      const d = rayDirection(car.heading, angleDeg);
      const samples: RaySample['samples'] = [];
      for (const distance of sampleDistances) {
        samples.push({
          distance,
          class: classifyGround(layout, this.track, px + distance * d.x, pz + distance * d.z),
        });
      }
      this.dir.x = d.x;
      this.dir.y = 0;
      this.dir.z = d.z;
      const hit = this.world.castRay(
        this.ray,
        maxRange,
        true,
        undefined,
        undefined,
        undefined,
        this.ownBody,
        this.predicate,
      );
      out.push({
        angleDeg,
        samples,
        obstacleDistance: hit ? hit.timeOfImpact : null,
        obstacleClass: hit
          ? this.wallColliders.has(hit.collider.handle)
            ? 'wall'
            : 'obstacle'
          : null,
      });
    }
    return out;
  }

  /** Forgets the wall tags. The sensor owns no Rapier objects, so there is nothing else to free. */
  dispose(): void {
    this.wallColliders.clear();
  }
}
