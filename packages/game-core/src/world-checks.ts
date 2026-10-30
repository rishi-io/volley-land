import { arenaFromLayout, flightBlocked, groundHeight } from './arena.js';
import type { GameConfig } from './config.js';
import { buildNavGrid, cellCentre, reachability } from './navigation.js';
import { climbLimit, slopeAt } from './terrain.js';
import type { WorldLayout } from './world.js';

export interface PlayRules {
  playerRadius: number;
  /** Steepest climb, in degrees (ground steeper than this can only be walked down). */
  maxSlopeDeg: number;
  projectileHeight: number;
  projectileRadius: number;
  /** How far a throw flies before it drops, in metres. */
  throwRange: number;
  maxPlayers: number;
}

/** Play rules from the live settings: body and throw sizes, and the room's player count. */
export function playRulesOf(
  game: Pick<GameConfig, 'playerRadius' | 'maxSlopeDeg' | 'projectileHeight' | 'projectileRadius' | 'projectileSpeed' | 'projectileLifetimeMs'>,
  maxPlayers: number,
): PlayRules {
  return {
    playerRadius: game.playerRadius,
    maxSlopeDeg: game.maxSlopeDeg,
    projectileHeight: game.projectileHeight,
    projectileRadius: game.projectileRadius,
    throwRange: game.projectileSpeed * (game.projectileLifetimeMs / 1000),
    maxPlayers,
  };
}

export interface WorldCheck {
  level: 'problem' | 'warning' | 'info';
  text: string;
}

export interface CheckResult {
  checks: WorldCheck[];
  /** Floor cells no one can walk to, for the plan overlay (centre and side, in metres). */
  unreachable: { x: number; z: number; size: number }[];
  /** Spawn points that can throw at each other the moment they appear. */
  exposedPairs: [number, number][];
}

/** Below this unreachable area a pocket is a gap between props, not a problem worth showing. */
const MIN_POCKET_M2 = 4;
const ROOMY_M2_PER_PLAYER = 900;
const CROWDED_M2_PER_PLAYER = 40;

const list = (items: number[]) => (items.length === 1 ? `${items[0]}` : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * Play checks for a world, shared by the world builder and the server's check_world operation: places players cannot reach, spawn points in
 * each other's line of fire, and whether the floor suits the room's player count. Advice only;
 * the schema decides what can be saved.
 */
export function checkWorld(layout: WorldLayout, rules: PlayRules): CheckResult {
  const checks: WorldCheck[] = [];
  const arena = arenaFromLayout(layout);
  const grid = buildNavGrid(arena, rules.playerRadius, rules.maxSlopeDeg);
  const reach = reachability(grid, layout.spawnPoints);

  if (reach.cutOffSpawns.length > 0) {
    checks.push({ level: 'problem', text: `Spawn point ${list(reach.cutOffSpawns.map((i) => i + 1))} ${reach.cutOffSpawns.length === 1 ? 'is' : 'are'} walled off from spawn point 1.` });
  }
  const cellArea = grid.cell * grid.cell;
  const unreachableArea = reach.unreachableCells.length * cellArea;
  const unreachable = unreachableArea >= MIN_POCKET_M2 ? reach.unreachableCells.map((c) => ({ ...cellCentre(grid, c), size: grid.cell })) : [];
  if (unreachable.length > 0) {
    const gap = `Open a gap of at least ${(rules.playerRadius * 2 + 0.4).toFixed(1)} m`;
    checks.push({
      level: 'warning',
      text: `About ${Math.round(unreachableArea)} m² of floor cannot be reached (red on the plan). ${arena.ground ? `${gap}, or make slopes gentler than ${rules.maxSlopeDeg}°.` : `${gap}.`}`,
    });
  }

  const exposedPairs: [number, number][] = [];
  layout.spawnPoints.forEach((a, i) => {
    layout.spawnPoints.forEach((b, j) => {
      if (j <= i) return;
      if (Math.hypot(a.x - b.x, a.z - b.z) > rules.throwRange) return;
      const from = { x: a.x, y: groundHeight(arena, a.x, a.z) + rules.projectileHeight, z: a.z };
      const to = { x: b.x, y: groundHeight(arena, b.x, b.z) + rules.projectileHeight, z: b.z };
      if (!flightBlocked(arena, from, to, rules.projectileRadius)) exposedPairs.push([i, j]);
    });
  });
  for (const [i, j] of exposedPairs.slice(0, 4)) {
    checks.push({ level: 'warning', text: `Spawn points ${i + 1} and ${j + 1} are within throwing range with nothing between them.` });
  }
  if (exposedPairs.length > 4) checks.push({ level: 'warning', text: `${exposedPairs.length - 4} more pairs of spawn points can throw at each other.` });

  const area = layout.halfWidth * 2 * layout.halfDepth * 2;
  const perPlayer = area / rules.maxPlayers;
  if (perPlayer > ROOMY_M2_PER_PLAYER) {
    checks.push({
      level: 'warning',
      text: `Roomy for ${rules.maxPlayers} players: about ${Math.round(perPlayer)} m² each, so players may take a while to meet. Bots will find them; a bigger room (Rooms → max players) fills it out.`,
    });
  } else if (perPlayer < CROWDED_M2_PER_PLAYER) {
    checks.push({ level: 'warning', text: `Tight for ${rules.maxPlayers} players: about ${Math.round(perPlayer)} m² each.` });
  }
  if (layout.spawnPoints.length < rules.maxPlayers) {
    checks.push({ level: 'info', text: `${layout.spawnPoints.length} spawn points for up to ${rules.maxPlayers} players: players reuse the point farthest from trouble.` });
  }

  if (arena.ground) {
    const { min, max } = arena.ground;
    const limit = climbLimit(rules.maxSlopeDeg);
    let open = 0;
    let steep = 0;
    for (let i = 0; i < grid.open.length; i++) {
      const p = cellCentre(grid, i);
      if (Math.abs(p.x) > layout.halfWidth || Math.abs(p.z) > layout.halfDepth) continue;
      open++;
      if (slopeAt(arena.ground, p.x, p.z) > limit) steep++;
    }
    const share = open === 0 ? 0 : steep / open;
    checks.push({
      level: 'info',
      text: `Ground from ${min.toFixed(1)} m to ${max.toFixed(1)} m${share > 0.005 ? `; ${Math.round(share * 100)}% is too steep to climb (over ${rules.maxSlopeDeg}°)` : ''}. Hills hide players and stop throws like cover.`,
    });
    if (share > 0.25) checks.push({ level: 'warning', text: 'Much of the ground is too steep to climb: lower the relief or hill heights, or widen them.' });
  }

  const low = layout.props.filter((p) => p.height <= rules.projectileHeight - rules.projectileRadius).length;
  const full = layout.props.length - low;
  checks.push({ level: 'info', text: `${layout.props.length} props: ${full} full cover, ${low} low cover that throws fly over. ${Math.round(area)} m² of floor.` });
  if (layout.props.length > 0 && full === 0) checks.push({ level: 'warning', text: 'No full cover: nothing stops a throw.' });

  return { checks, unreachable, exposedPairs };
}
