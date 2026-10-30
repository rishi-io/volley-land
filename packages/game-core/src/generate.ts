import { type Symmetry, applySymmetry, ellipse, prop, rect } from './layout-tools.js';
import { createRng } from './rng.js';
import type { TerrainHill, WorldTerrain } from './terrain.js';
import { PROPS, type PropKind, THEME_INFO, type ThemeId, type WorldLayout, type WorldPoint, type WorldProp, propExtent } from './world.js';

export interface GenerateOptions {
  theme: ThemeId;
  /** Floor size in metres. */
  width: number;
  depth: number;
  /** How much cover, 0 (open field) to 1 (packed). */
  density: number;
  symmetry: Symmetry;
  /** Number of spawn points to place round the edge. */
  spawns: number;
  seed: number;
  /** How hilly, 0 (flat) to 1 (rolling ground with hills and hollows). */
  relief?: number;
}

/** Free space kept between props, so every part of a generated world stays walkable. */
const GAP = 1.8;
/** Free space kept round each spawn point. */
const SPAWN_CLEARANCE = 4;
/** Generated props per square metre at full density. */
const PROPS_PER_SQUARE_METRE = 0.02;

/**
 * A starting layout for the world builder: the theme's props scattered with even spacing, paths
 * and patches painted in the theme's surfaces, spawn points round the edge, all mirrored for the
 * chosen symmetry. The same options always give the same layout. Props never touch (there is
 * always at least GAP between them), so nothing is walled off.
 */
export function generateLayout(options: GenerateOptions): WorldLayout {
  const rng = createRng(options.seed);
  const hw = options.width / 2;
  const hd = options.depth / 2;
  const theme = THEME_INFO[options.theme];
  const sym = options.symmetry;

  // The part of the floor props are generated in; the rest is its mirror image.
  const domain = {
    minX: sym === 'mirror-x' || sym === 'quad' ? 0 : -hw,
    minZ: sym === 'mirror-z' || sym === 'quad' ? 0 : -hd,
    maxX: hw,
    maxZ: hd,
  };

  const spawnPoints = edgeSpawns(hw, hd, options.spawns, sym);

  const regions = [];
  const pathWidth = Math.min(4, Math.max(2.5, Math.min(hw, hd) / 8));
  if (sym !== 'mirror-z') regions.push(rect(theme.paths, 0, 0, pathWidth, options.depth));
  if (sym !== 'mirror-x') regions.push(rect(theme.paths, 0, 0, options.width, pathWidth));
  const patchCount = Math.max(1, Math.round((options.width * options.depth) / 1400));
  const patches = [];
  for (let i = 0; i < patchCount; i++) {
    const surface = theme.patches[Math.floor(rng() * theme.patches.length)]!;
    const w = 6 + rng() * 10;
    patches.push(ellipse(surface, lerp(domain.minX, domain.maxX, rng()), lerp(domain.minZ, domain.maxZ, rng()), w, w * (0.5 + rng() * 0.5), Math.round(rng() * 12) * 15));
  }
  regions.unshift(...applySymmetry(patches, sym));
  regions.push(ellipse(theme.paths, 0, 0, pathWidth * 3.5, pathWidth * 3.5));

  const kinds = Object.entries(theme.props) as [PropKind, number][];
  const totalWeight = kinds.reduce((sum, [, w]) => sum + w, 0);
  const pickKind = (): PropKind => {
    let roll = rng() * totalWeight;
    for (const [kind, weight] of kinds) {
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return kinds[kinds.length - 1]![0];
  };

  const placed: WorldProp[] = [];
  const radiusOf = (p: WorldProp) => {
    const e = propExtent(p);
    return PROPS[p.kind].shape === 'circle' ? e.x : Math.hypot(e.x, e.z);
  };
  const fits = (candidate: WorldProp): boolean => {
    const r = radiusOf(candidate);
    const e = propExtent(candidate);
    if (Math.abs(candidate.x) + e.x > hw - GAP || Math.abs(candidate.z) + e.z > hd - GAP) return false;
    if (spawnPoints.some((s) => Math.hypot(s.x - candidate.x, s.z - candidate.z) < r + SPAWN_CLEARANCE)) return false;
    if (Math.abs(candidate.x) < pathWidth / 2 + r * 0.5 && sym !== 'mirror-z') return false; // keep the paths clear
    if (Math.abs(candidate.z) < pathWidth / 2 + r * 0.5 && sym !== 'mirror-x') return false;
    if (Math.hypot(candidate.x, candidate.z) < pathWidth * 1.75 + r) return false; // and the centre
    return placed.every((p) => Math.hypot(p.x - candidate.x, p.z - candidate.z) >= r + radiusOf(p) + GAP);
  };

  const domainArea = (domain.maxX - domain.minX) * (domain.maxZ - domain.minZ);
  const target = Math.round(domainArea * PROPS_PER_SQUARE_METRE * Math.max(0, Math.min(1, options.density)));
  let made = 0;
  for (let attempt = 0; attempt < target * 40 && made < target; attempt++) {
    const kind = pickKind();
    const info = PROPS[kind];
    const scale = 0.8 + rng() * 0.5;
    const rotation = info.shape === 'box' ? Math.floor(rng() * 12) * 15 : Math.floor(rng() * 24) * 15;
    const width = info.stretch && (kind === 'wall' || kind === 'hedge' || kind === 'bookshelf') ? info.size.width * (0.6 + rng() * 0.9) : undefined;
    const candidate = prop(kind, round1(lerp(domain.minX, domain.maxX, rng())), round1(lerp(domain.minZ, domain.maxZ, rng())), { scale, rotation, width });
    const copies = applySymmetry([candidate], sym);
    // Every mirror copy must fit, including against the other copies.
    const ok = copies.every((copy, i) => fits(copy) && copies.slice(0, i).every((other) => Math.hypot(other.x - copy.x, other.z - copy.z) >= radiusOf(copy) * 2 + GAP));
    if (!ok) continue;
    placed.push(...copies);
    made++;
  }

  const layout: WorldLayout = {
    halfWidth: hw,
    halfDepth: hd,
    theme: options.theme,
    floor: theme.floor,
    scatter: 0.5,
    regions,
    props: placed,
    spawnPoints,
  };
  const relief = Math.max(0, Math.min(1, options.relief ?? 0));
  if (relief > 0) {
    // Drawn after everything else, so a flat layout from the same options and seed is unchanged.
    const terrain: WorldTerrain = { relief: round1(relief * 4), scale: round1(Math.max(14, Math.min(48, Math.min(hw, hd) * 0.55))), seed: options.seed, symmetry: sym };
    const hills: TerrainHill[] = [];
    const hillTarget = Math.max(1, Math.round(domainArea * 0.0003 * relief));
    for (let attempt = 0; attempt < hillTarget * 20 && hills.length < hillTarget * copiesPer(sym); attempt++) {
      const size = 10 + rng() * 14;
      const depth = size * (0.6 + rng() * 0.4);
      const plateau = round1(rng() * 0.5);
      // Gentle enough to climb: a mound is steepest at about 1.5 × height ÷ the width of its sloping rim.
      const rim = (Math.min(size, depth) / 2) * (1 - plateau);
      const height = round1((rng() < 0.25 ? -1 : 1) * Math.min(rim * 0.4, 1.2 + rng() * 2.5 * relief));
      const hill: TerrainHill = { x: round1(lerp(domain.minX, domain.maxX, rng())), z: round1(lerp(domain.minZ, domain.maxZ, rng())), width: round1(size), depth: round1(depth), rotation: Math.floor(rng() * 12) * 15, height, plateau };
      if (spawnPoints.some((p) => Math.hypot(p.x - hill.x, p.z - hill.z) < size / 2 + 2)) continue;
      // Hills that overlap add their slopes together: keep them (and their mirror copies) apart.
      const copies = applySymmetry([hill], sym);
      const apart = (a: TerrainHill, b: TerrainHill) => Math.hypot(a.x - b.x, a.z - b.z) >= (Math.max(a.width, a.depth) + Math.max(b.width, b.depth)) / 2;
      if (!copies.every((copy, i) => hills.every((other) => apart(copy, other)) && copies.slice(0, i).every((other) => apart(copy, other)))) continue;
      hills.push(...copies);
    }
    layout.terrain = terrain;
    layout.hills = hills;
  }
  return layout;
}

const copiesPer = (sym: Symmetry) => (sym === 'quad' ? 4 : sym === 'none' ? 1 : 2);

/** The layout a new world starts from: an empty 60 × 60 m floor in a theme, with four spawn points. */
export function blankLayout(theme: ThemeId = 'park'): WorldLayout {
  return generateLayout({ theme, width: 60, depth: 60, density: 0, symmetry: 'quad', spawns: 4, seed: 1 });
}

/**
 * `count` spawn points evenly round the floor, inset from the edge. The count is rounded to suit
 * the symmetry, so the points mirror like the props do.
 */
function edgeSpawns(hw: number, hd: number, count: number, sym: Symmetry): WorldPoint[] {
  const inset = Math.min(5, Math.min(hw, hd) * 0.25);
  const w = hw - inset;
  const d = hd - inset;
  const step = sym === 'quad' ? 4 : sym === 'none' ? 1 : 2;
  const n = Math.max(step, Math.round(count / step) * step);
  const perimeter = 4 * (w + d);
  const out: WorldPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Start at the middle of the right-hand edge so mirrored point sets line up.
    let t = ((i + 0.5) / n) * perimeter;
    let x: number;
    let z: number;
    if (t < d) [x, z] = [w, t];
    else if ((t -= d) < 2 * w) [x, z] = [w - t, d];
    else if ((t -= 2 * w) < 2 * d) [x, z] = [-w, d - t];
    else if ((t -= 2 * d) < 2 * w) [x, z] = [-w + t, -d];
    else [x, z] = [w, -d + (t - 2 * w)];
    out.push({ x: round1(x), z: round1(z) });
  }
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round1 = (v: number) => Math.round(v * 10) / 10;
