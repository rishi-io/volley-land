import { DEFAULT_WEAPON, WEAPON_IDS, type WeaponId, enabledWeapons, weaponStats } from '@volleyland/game-core';
import { useHud } from './hud/hud-store';
import type { GameRuntime } from './runtime';

/** What players call each weapon, in slot order (keys 1–4). */
export const WEAPON_NAMES: Readonly<Record<WeaponId, string>> = Object.freeze({
  ball: 'Ball',
  blaster: 'Blaster',
  scatter: 'Scatter',
  rail: 'Rail',
});

/** Bolt and gun colours, so a shot's weapon can be told at a glance. */
export const WEAPON_COLORS: Readonly<Record<WeaponId, string>> = Object.freeze({
  ball: '#ffb703',
  blaster: '#4cc9f0',
  scatter: '#ff7b00',
  rail: '#f72585',
});

/**
 * Put a weapon in hand: at once here (the HUD, the viewmodel and the shot prediction use it), and
 * on the server, which checks the same switch time and reloads. A weapon the match has turned off
 * is ignored. If the server refuses, the hand goes back to what it says.
 */
export function selectWeapon(runtime: GameRuntime, weapon: WeaponId): void {
  if (weapon === runtime.weapon || !weaponStats(runtime.config, weapon).enabled) return;
  const previous = runtime.weapon;
  runtime.weapon = weapon;
  runtime.weaponReadyAt = performance.now() + runtime.config.weaponSwitchMs;
  useHud.getState().set({ weapon });
  runtime.audio?.sfx('switch');
  runtime.connection?.selectWeapon(weapon).then(
    (ack) => {
      if (ack.ok || runtime.weapon !== weapon) return;
      runtime.weapon = previous;
      useHud.getState().set({ weapon: previous });
    },
    () => undefined,
  );
}

/** Q: the next weapon the match allows, round to the first. */
export function cycleWeapon(runtime: GameRuntime): void {
  const weapons = enabledWeapons(runtime.config);
  selectWeapon(runtime, weapons[(weapons.indexOf(runtime.weapon) + 1) % weapons.length]!);
}

/** Keys 1–4 pick the weapon in that slot of the full list (a turned-off one does nothing). */
export function weaponForKey(code: string): WeaponId | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  const slot = match ? Number(match[1]) - 1 : -1;
  return WEAPON_IDS[slot] ?? null;
}

/** 0 just after a shot (or a switch), 1 when the weapon in hand can fire again. */
export function readiness(runtime: GameRuntime, now: number): number {
  const stats = weaponStats(runtime.config, runtime.weapon);
  const sinceShot = now - (runtime.lastShotAt[runtime.weapon] ?? -1e9);
  const reload = Math.min(1, sinceShot / Math.max(1, stats.cooldownMs));
  const switching = runtime.config.weaponSwitchMs > 0 ? Math.min(1, 1 - (runtime.weaponReadyAt - now) / runtime.config.weaponSwitchMs) : 1;
  return Math.max(0, Math.min(reload, switching));
}

/** A new match starts everyone with the ball and fresh reloads, as the server does. */
export function resetWeapons(runtime: GameRuntime): void {
  runtime.weapon = DEFAULT_WEAPON;
  runtime.weaponReadyAt = 0;
  runtime.lastShotAt = {};
  useHud.getState().set({ weapon: DEFAULT_WEAPON, weapons: enabledWeapons(runtime.config) });
}
