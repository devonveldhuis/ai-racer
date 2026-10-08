/** What a piece of geometry means to the physics / game rules. */
export type SurfaceType = 'road' | 'kerb' | 'grass' | 'sand' | 'wall';

/**
 * GLB material name -> surface. Materials found by inspecting every file in `Models/`:
 *
 * - `road`      dark asphalt (0.27 grey). Drivable.
 * - `grey`      light grey raised (+0.02) rim on both sides of the road. Kerb.
 * - `grass`     green ground plane of a tile. Off-road.
 * - `sand`      sand run-off variants (`roadCorner*Sand*`). Off-road, high drag.
 * - `wall`      cream-coloured vertical walls on `*Wall*` / `*Bridge*` tiles. Solid.
 * - `_defaultMat` white. On `roadCornerLarger` it takes the place of `grey` for the kerb
 *   (verified: same vertices as the kerb ring on the sibling corner tiles), so it is a kerb
 *   here. Elsewhere (props such as flags/banners) it is just unnamed white paint.
 * - `white`     white rim of the `*Border*` / `*Wall*` corner variants. UNCLEAR: treated as
 *   kerb since it sits where `grey` sits on the plain tiles; revisit if those tiles are used.
 * - `red`       red paint on barriers and stands (`barrierRed`, `grandStand*`). UNCLEAR:
 *   prop colour, not a surface; mapped to `wall` because it only occurs on solid props.
 *
 * Prop-only materials (`bark`, `tankco`, `net`, `checkers`, `glass`, `pylon`, `carTire`) have
 * no surface meaning and are intentionally absent: `surfaceForMaterial` returns `undefined`.
 */
export const MATERIAL_SURFACES: Readonly<Record<string, SurfaceType>> = {
  road: 'road',
  grey: 'kerb',
  grass: 'grass',
  sand: 'sand',
  wall: 'wall',
  _defaultMat: 'kerb',
  white: 'kerb',
  red: 'wall',
};

export function surfaceForMaterial(name: string): SurfaceType | undefined {
  return Object.prototype.hasOwnProperty.call(MATERIAL_SURFACES, name)
    ? MATERIAL_SURFACES[name]
    : undefined;
}
