/**
 * Procedural closed-loop track generator. Pure data and math, fully deterministic.
 *
 * Main straight: the start piece is flanked by a pre-placed run of straights (15-20 cells
 * in total by default); the search only has to connect the end of that run to its start
 * with corners. Elsewhere, straights come in runs: after a corner a straight starts a run
 * of a drawn length (`straightRunCells`) that is finished before the next corner.
 *
 * Algorithm: randomised depth-first search ("random walk with backtracking") on the cell
 * grid. Piece 0 is the start/finish straight at the origin with a random orientation; the
 * search then chains pieces with `placementToJoin` (each piece is a catalog tile or its
 * `reverseTile`, so left and right corners come from the same models), tracking cell
 * occupancy. A candidate is rejected when it overlaps a cell, comes within `clearance`
 * (manhattan) of any piece other than its predecessor, or can no longer be closed within
 * `maxPieces`. A candidate whose exit meets the start piece's entry closes the loop; it
 * must be a straight and keep the piece count within [minPieces, maxPieces], which also
 * guarantees the piece before the start is a straight. Candidate order is a weighted
 * random draw (tile weights x kind weights), steered towards the closing cell with a
 * pressure that grows with the piece count, so the walk tends to come home before
 * `maxPieces`. Each attempt gets a node budget; when it is exhausted (or the search space
 * is) the next attempt continues with the same RNG stream. After `maxAttempts` failures an
 * error naming the seed and options is thrown.
 */
import {
  connectorsMatch,
  DIR_VECTORS,
  getTile,
  neighbourCell,
  oppositeDir,
  placedCells,
  placedCentreline,
  placedConnectors,
  placementToJoin,
  reverseTile,
  TILE_CATALOG,
  type Connector,
  type Placement,
  type Rotation,
  type TileDef,
  type Vec2,
} from '../assets/tiles';
import { Rng } from '../core/rng';
import {
  cellKey,
  DEFAULT_TRACK_OPTIONS,
  dirHeading,
  pieceDef,
  TrackLayout,
  type Bounds,
  type Centreline,
  type Checkpoint,
  type ResolvedTrackOptions,
  type TrackOptions,
  type TrackPiece,
} from './layout';

/** Target spacing of centreline samples, in cells. */
const CENTRELINE_STEP = 0.2;
/** Along-track position of the start pose on the start piece (the rear painted grid slot). */
const START_POSE_T = 0.375;
/** Search nodes (candidate expansions) per attempt, per allowed piece of `maxPieces`. */
const NODE_BUDGET_PER_PIECE = 3;
/** Strength of the steering towards the closing cell. */
const STEER = 1.5;
/** Upper bound on how far (manhattan, cells) a single piece can move the road head. */
const MAX_ADVANCE = 5;
/** Selection weight of "start a straight run" relative to the plain tile weights. */
const RUN_WEIGHT = 1;
/** Pieces of the main straight are put in this index range in the occupancy map (the
 * approach before the start piece), so they can be told apart from the searched pieces. */
const TAIL_INDEX = 100000;

export interface PieceSpec {
  tileId: string;
  reversed: boolean;
}

export function resolveTrackOptions(options: TrackOptions = {}): ResolvedTrackOptions {
  const d = DEFAULT_TRACK_OPTIONS;
  const r: ResolvedTrackOptions = {
    minPieces: options.minPieces ?? d.minPieces,
    maxPieces: options.maxPieces ?? d.maxPieces,
    allowedTiles: [...(options.allowedTiles ?? d.allowedTiles)],
    kindWeights: { ...d.kindWeights, ...options.kindWeights },
    tileWeights: { ...d.tileWeights, ...options.tileWeights },
    checkpointEvery: options.checkpointEvery ?? d.checkpointEvery,
    clearance: options.clearance ?? d.clearance,
    maxAttempts: options.maxAttempts ?? d.maxAttempts,
    mainStraightCells: [...(options.mainStraightCells ?? d.mainStraightCells)] as [number, number],
    minCorners: options.minCorners ?? d.minCorners,
    straightRunCells: [...(options.straightRunCells ?? d.straightRunCells)] as [number, number],
  };
  if (!Number.isInteger(r.minPieces) || r.minPieces < 2) throw new Error('minPieces must be >= 2');
  if (!Number.isInteger(r.maxPieces) || r.maxPieces < r.minPieces)
    throw new Error('maxPieces must be an integer >= minPieces');
  if (!Number.isInteger(r.checkpointEvery) || r.checkpointEvery < 1)
    throw new Error('checkpointEvery must be an integer >= 1');
  if (!Number.isInteger(r.clearance) || r.clearance < 0)
    throw new Error('clearance must be an integer >= 0');
  if (!Number.isInteger(r.maxAttempts) || r.maxAttempts < 1)
    throw new Error('maxAttempts must be an integer >= 1');
  const [mLo, mHi] = r.mainStraightCells;
  if (!Number.isInteger(mLo) || !Number.isInteger(mHi) || mLo < 3 || mHi < mLo)
    throw new Error('mainStraightCells must be integers [min, max] with 3 <= min <= max');
  if (!Number.isInteger(r.minCorners) || r.minCorners < 0)
    throw new Error('minCorners must be an integer >= 0');
  const [rLo, rHi] = r.straightRunCells;
  if (!Number.isInteger(rLo) || !Number.isInteger(rHi) || rLo < 1 || rHi < rLo)
    throw new Error('straightRunCells must be integers [min, max] with 1 <= min <= max');
  return r;
}

function startTile(): TileDef {
  const t = TILE_CATALOG.find((d) => d.kind === 'start_finish');
  if (!t) throw new Error('Tile catalog has no start/finish tile');
  return t;
}

interface Candidate {
  spec: PieceSpec;
  def: TileDef;
  weight: number;
}

function buildCandidates(opts: ResolvedTrackOptions): Candidate[] {
  const out: Candidate[] = [];
  for (const id of opts.allowedTiles) {
    const def = getTile(id);
    if (def.kind === 'start_finish') continue; // always used exactly once, never as a filler
    if (def.kind !== 'straight' && def.kind !== 'corner')
      throw new Error(`Tile ${id} is not a road tile`);
    const weight = (opts.tileWeights[id] ?? 1) * (opts.kindWeights[def.kind] ?? 1);
    if (!(weight > 0)) continue;
    out.push({ spec: { tileId: id, reversed: false }, def, weight });
    if (def.kind === 'corner')
      out.push({ spec: { tileId: id, reversed: true }, def: reverseTile(def), weight });
  }
  if (!out.some((c) => c.def.kind === 'straight'))
    throw new Error('allowedTiles must contain at least one straight with a positive weight');
  return out;
}

const manhattan = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

interface SearchResult {
  specs: PieceSpec[];
  startRotation: Rotation;
}

/** A chain of straight pieces totalling `cells` cells, or null if the tiles cannot make it. */
function fillStraights(
  rng: Rng,
  straights: readonly Candidate[],
  cells: number,
): Candidate[] | null {
  const out: Candidate[] = [];
  let left = cells;
  while (left > 0) {
    const fit = straights.filter((c) => c.def.length <= left);
    if (fit.length === 0) return null;
    let total = 0;
    for (const c of fit) total += c.weight;
    let r = rng.next() * total;
    let k = 0;
    while (k < fit.length - 1 && r >= (fit[k] as Candidate).weight) {
      r -= (fit[k] as Candidate).weight;
      k++;
    }
    const c = fit[k] as Candidate;
    out.push(c);
    left -= c.def.length;
  }
  return out;
}

/** One search attempt; returns the piece specs (start piece excluded) or null. */
function searchOnce(rng: Rng, opts: ResolvedTrackOptions, cands: Candidate[]): SearchResult | null {
  const start = startTile();
  const startRotation = rng.pick([0, 90, 180, 270] as const);
  const startPlacement: Placement = { cell: { x: 0, z: 0 }, rotation: startRotation };
  const startConn = placedConnectors(start, startPlacement);
  if (!startConn) return null;

  const { minPieces, maxPieces, clearance, minCorners } = opts;
  const straights = cands.filter((c) => c.def.kind === 'straight');
  const maxLen = Math.max(...straights.map((c) => c.def.length));

  const occupancy = new Map<string, number>();
  for (const c of placedCells(start, startPlacement)) occupancy.set(cellKey(c), 0);

  // Main straight: the start piece plus `post` cells of straights after it and `pre` cells
  // before it (`pre` >= 1 so the piece before the start is a straight). They are placed up
  // front; the search only has to find a path from the end of the post run to the start of
  // the pre run, beginning and ending with a corner.
  const main = rng.int(opts.mainStraightCells[0], opts.mainStraightCells[1]);
  const rest = main - start.length;
  if (rest < 1) return null;
  let post = rng.int(Math.floor(rest * 0.3), Math.ceil(rest * 0.7));
  post = Math.min(post, rest - 1);
  const pre = rest - post;
  const postPieces = fillStraights(rng, straights, post);
  const prePieces = fillStraights(rng, straights, pre);
  if (!postPieces || !prePieces) return null;

  const postSpecs: PieceSpec[] = [];
  let exit = startConn.exit;
  postPieces.forEach((c, i) => {
    const placement = placementToJoin(exit, c.def) as Placement;
    exit = (placedConnectors(c.def, placement) as { exit: Connector }).exit;
    for (const cell of placedCells(c.def, placement)) occupancy.set(cellKey(cell), i + 1);
    postSpecs.push(c.spec);
  });
  const postExit = exit;
  const count0 = 1 + postPieces.length;

  // The approach is built forwards from a virtual exit `pre` cells behind the start piece.
  const behind = DIR_VECTORS[startConn.entry.edge];
  exit = {
    cell: {
      x: startConn.entry.cell.x + behind.x * (pre + 1),
      z: startConn.entry.cell.z + behind.z * (pre + 1),
    },
    edge: oppositeDir(startConn.entry.edge),
  };
  const preSpecs: PieceSpec[] = [];
  let preEntry: Connector | null = null;
  for (let i = 0; i < prePieces.length; i++) {
    const c = prePieces[i] as Candidate;
    const placement = placementToJoin(exit, c.def);
    const conns = placement && placedConnectors(c.def, placement);
    if (!placement || !conns) return null;
    preEntry ??= conns.entry;
    exit = conns.exit;
    for (const cell of placedCells(c.def, placement)) occupancy.set(cellKey(cell), TAIL_INDEX + i);
    preSpecs.push(c.spec);
  }
  if (!preEntry || !connectorsMatch(exit, startConn.entry)) return null;
  const closeEntry = preEntry;
  const target = neighbourCell(closeEntry.cell, closeEntry.edge);
  const preCount = preSpecs.length;

  const specs: PieceSpec[] = [];
  let nodes = 0;
  const budget = NODE_BUDGET_PER_PIECE * maxPieces;
  // Piece count the walk aims to close at; steering towards the closing cell gets stronger
  // as the count approaches it.
  const aim = rng.int(minPieces, maxPieces);
  const [runLo, runHi] = opts.straightRunCells;

  const isFree = (cells: Vec2[], prev: number, closes: boolean): boolean => {
    for (const c of cells) if (occupancy.has(cellKey(c))) return false;
    if (clearance <= 0) return true;
    for (const c of cells) {
      for (let dx = -clearance; dx <= clearance; dx++) {
        const rest = clearance - Math.abs(dx);
        for (let dz = -rest; dz <= rest; dz++) {
          const j = occupancy.get(cellKey({ x: c.x + dx, z: c.z + dz }));
          if (j === undefined || j === prev) continue;
          if (closes && j === TAIL_INDEX) continue;
          return false;
        }
      }
    }
    return true;
  };

  interface Option {
    cand: Candidate;
    placement: Placement;
    cells: Vec2[];
    exit: Connector;
    closes: boolean;
    weight: number;
    /** Cells of the straight run still to be laid after this piece. */
    runAfter: number;
  }

  /**
   * `runLeft` > 0: a straight run was started and must be completed with straights.
   * `runLeft` = 0 after a straight: only a corner may follow (runs end in corners).
   * After a corner: another corner, or a straight that starts a run of drawn length.
   */
  const extend = (
    exit: Connector,
    count: number,
    runLeft: number,
    lastStraight: boolean,
    corners: number,
  ): boolean => {
    if (++nodes > budget) return false;
    const head = neighbourCell(exit.cell, exit.edge);
    const dir = DIR_VECTORS[exit.edge];
    const dist0 = manhattan(head, target);
    const pressure = Math.min(1, (count + preCount) / aim) ** 2;
    const options: Option[] = [];
    for (const cand of cands) {
      const isCorner = cand.def.kind === 'corner';
      if (runLeft > 0 ? isCorner || cand.def.length > runLeft : lastStraight && !isCorner) continue;
      const placement = placementToJoin(exit, cand.def);
      if (!placement) continue;
      const conns = placedConnectors(cand.def, placement);
      if (!conns) continue;
      const own = placedCells(cand.def, placement);
      const n = count + 1 + preCount;
      const closes = isCorner && connectorsMatch(conns.exit, closeEntry);
      if (closes) {
        if (n < minPieces || n > maxPieces || corners + 1 < minCorners) continue;
        if (!isFree(own, count - 1, true)) continue;
        options.push({
          cand,
          placement,
          cells: own,
          exit: conns.exit,
          closes,
          weight: cand.weight,
          runAfter: 0,
        });
        continue;
      }
      // Run lengths this piece can start (new run), or just its continuation.
      const starts =
        !isCorner && runLeft === 0
          ? Array.from({ length: runHi - runLo + 1 }, (_, i) => runLo + i).filter(
              (r) => r >= cand.def.length,
            )
          : [0];
      for (const r of starts) {
        const runAfter = isCorner ? 0 : r > 0 ? r - cand.def.length : runLeft - cand.def.length;
        if (n + Math.ceil(runAfter / maxLen) >= maxPieces) continue;
        // For a new run, the whole line must be free so it cannot dead-end halfway.
        const line: Vec2[] =
          r > 0
            ? Array.from({ length: r }, (_, k) => ({
                x: head.x + dir.x * k,
                z: head.z + dir.z * k,
              }))
            : own;
        if (!isFree(line, count - 1, false)) continue;
        let weight = cand.weight;
        if (r > 0) weight *= RUN_WEIGHT / starts.length;
        const out = neighbourCell(conns.exit.cell, conns.exit.edge);
        const next = manhattan(
          { x: out.x + dir.x * runAfter, z: out.z + dir.z * runAfter },
          target,
        );
        if (next > MAX_ADVANCE * (maxPieces - n - Math.ceil(runAfter / maxLen))) continue;
        weight *= Math.exp(-pressure * STEER * (next - dist0));
        options.push({
          cand,
          placement,
          cells: own,
          exit: conns.exit,
          closes: false,
          weight,
          runAfter,
        });
      }
    }
    while (options.length > 0) {
      let total = 0;
      for (const o of options) total += o.weight;
      let r = rng.next() * total;
      let k = 0;
      while (k < options.length - 1 && r >= (options[k] as Option).weight) {
        r -= (options[k] as Option).weight;
        k++;
      }
      const o = options.splice(k, 1)[0] as Option;
      specs.push(o.cand.spec);
      if (o.closes) return true;
      for (const c of o.cells) occupancy.set(cellKey(c), count);
      const isCorner = o.cand.def.kind === 'corner';
      if (extend(o.exit, count + 1, o.runAfter, !isCorner, corners + (isCorner ? 1 : 0)))
        return true;
      for (const c of o.cells) occupancy.delete(cellKey(c));
      specs.pop();
      if (nodes > budget) return false;
    }
    return false;
  };

  // After the main straight's post run the next piece must be a corner.
  return extend(postExit, count0, 0, true, 0)
    ? { specs: [...postSpecs, ...specs, ...preSpecs], startRotation }
    : null;
}

/**
 * Generate a closed-loop track. Same `seed` and `options` always give a deep-equal layout.
 * Throws if no valid loop is found within `maxAttempts`.
 */
export function generateTrack(seed: number, options: TrackOptions = {}): TrackLayout {
  const opts = resolveTrackOptions(options);
  const cands = buildCandidates(opts);
  const rng = new Rng(seed);
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const found = searchOnce(rng, opts, cands);
    if (found) return assembleLayout(seed, opts, attempt, found.specs, found.startRotation);
  }
  throw new Error(
    `generateTrack: no valid loop found for seed ${seed} after ${opts.maxAttempts} attempts ` +
      `(options: ${JSON.stringify(opts)})`,
  );
}

/**
 * Build a layout from an explicit piece list (start piece excluded), chained from the start
 * piece at the origin. The loop must close exactly. Used by the generator and by tests with
 * hand-made loops; it does not check the count or clearance rules (see `validateLayout`).
 */
export function layoutFromPieces(
  seed: number,
  options: TrackOptions,
  specs: readonly PieceSpec[],
  startRotation: Rotation = 0,
): TrackLayout {
  return assembleLayout(seed, resolveTrackOptions(options), 1, specs, startRotation);
}

function assembleLayout(
  seed: number,
  options: ResolvedTrackOptions,
  attempts: number,
  specs: readonly PieceSpec[],
  startRotation: Rotation,
): TrackLayout {
  const start = startTile();
  const all: PieceSpec[] = [{ tileId: start.id, reversed: false }, ...specs];
  const pieces: TrackPiece[] = [];
  const occupancy = new Map<string, number>();
  const defs: TileDef[] = [];
  let exit: Connector | null = null;
  let firstEntry: Connector | null = null;

  all.forEach((spec, index) => {
    const def = pieceDef(spec);
    const placement =
      index === 0
        ? ({ cell: { x: 0, z: 0 }, rotation: startRotation } as Placement)
        : placementToJoin(exit as Connector, def);
    const conns = placement && placedConnectors(def, placement);
    if (!placement || !conns) throw new Error(`Cannot place piece ${index} (${spec.tileId})`);
    const cells = placedCells(def, placement);
    for (const c of cells) {
      if (occupancy.has(cellKey(c))) throw new Error(`Piece ${index} overlaps at ${cellKey(c)}`);
      occupancy.set(cellKey(c), index);
    }
    pieces.push({
      index,
      tileId: spec.tileId,
      placement,
      reversed: spec.reversed,
      entryDir: oppositeDir(conns.entry.edge),
      exitDir: conns.exit.edge,
      cells,
      kind: def.kind,
      turn: def.kind === 'corner' ? (def.turn ?? null) : null,
    });
    defs.push(def);
    if (index === 0) firstEntry = conns.entry;
    exit = conns.exit;
  });
  if (!connectorsMatch(exit as unknown as Connector, firstEntry as unknown as Connector))
    throw new Error('Pieces do not form a closed loop');

  const bounds = computeBounds(pieces);
  const centreline = buildCentreline(pieces, defs);
  const checkpoints = buildCheckpoints(pieces, defs, options.checkpointEvery);
  const startDef = defs[0] as TileDef;
  const startPiece = pieces[0] as TrackPiece;
  const position = placedCentreline(startDef, startPiece.placement, START_POSE_T) as Vec2;
  return new TrackLayout({
    seed,
    options,
    attempts,
    pieces,
    occupancy,
    bounds,
    centreline,
    checkpoints,
    startPose: { position, heading: dirHeading(startPiece.entryDir) },
  });
}

function computeBounds(pieces: readonly TrackPiece[]): Bounds {
  const min = { x: Infinity, z: Infinity };
  const max = { x: -Infinity, z: -Infinity };
  for (const p of pieces)
    for (const c of p.cells) {
      min.x = Math.min(min.x, c.x);
      min.z = Math.min(min.z, c.z);
      max.x = Math.max(max.x, c.x);
      max.z = Math.max(max.z, c.z);
    }
  return { min, max };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.z - a.z);

function buildCentreline(pieces: readonly TrackPiece[], defs: readonly TileDef[]): Centreline {
  const points: Vec2[] = [];
  const tangent: Vec2[] = [];
  const pieceIndex: number[] = [];
  const EPS = 1e-4;
  pieces.forEach((piece, i) => {
    const def = defs[i] as TileDef;
    const steps = Math.max(2, Math.ceil(def.length / CENTRELINE_STEP));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      points.push(placedCentreline(def, piece.placement, t) as Vec2);
      // Tangent from the tile's own curve (not the polyline), so it is exact at piece
      // boundaries where straights meet arcs (the curve is C1 there).
      const p0 = placedCentreline(def, piece.placement, Math.max(0, t - EPS)) as Vec2;
      const p1 = placedCentreline(def, piece.placement, Math.min(1, t + EPS)) as Vec2;
      const len = dist(p0, p1);
      tangent.push({ x: (p1.x - p0.x) / len, z: (p1.z - p0.z) / len });
      pieceIndex.push(i);
    }
  });
  const n = points.length;
  const distance: number[] = [0];
  for (let i = 1; i < n; i++)
    distance.push((distance[i - 1] as number) + dist(points[i - 1] as Vec2, points[i] as Vec2));
  const totalLength = (distance[n - 1] as number) + dist(points[n - 1] as Vec2, points[0] as Vec2);
  return { points, distance, tangent, pieceIndex, totalLength };
}

function buildCheckpoints(
  pieces: readonly TrackPiece[],
  defs: readonly TileDef[],
  every: number,
): Checkpoint[] {
  // Interior checkpoints at the start of pieces every, 2*every, ... then the finish line at
  // the start of piece 0 (last in driving order).
  const at: number[] = [];
  for (let i = every; i < pieces.length; i += every) at.push(i);
  at.push(0);
  return at.map((pieceIndex, index) => {
    const piece = pieces[pieceIndex] as TrackPiece;
    const position = placedCentreline(defs[pieceIndex] as TileDef, piece.placement, 0) as Vec2;
    const h = dirHeading(piece.entryDir);
    const normal = { x: Math.round(Math.sin(h)), z: -Math.round(Math.cos(h)) };
    // Driver's right-hand side in this frame (x east, z south): (-dz, dx).
    const right = { x: -normal.z, z: normal.x };
    return {
      index,
      pieceIndex,
      a: { x: position.x - 0.5 * right.x, z: position.z - 0.5 * right.z },
      b: { x: position.x + 0.5 * right.x, z: position.z + 0.5 * right.z },
      position,
      normal,
    };
  });
}
