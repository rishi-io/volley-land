import { createContext, useContext } from 'react';
import {
  type AppearanceSettings,
  type Arena,
  type CameraSettings,
  type CameraView,
  DEFAULT_APPEARANCE,
  DEFAULT_CAMERA,
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  DEFAULT_WEAPON,
  PROTOTYPE_WORLD,
  type WeaponId,
  type WorldLayout,
  arenaFromLayout,
} from '@volleyland/game-core';
import type { GameAudio } from './audio/game-audio';
import { EntityIndex } from './ecs/sync';
import { KeyboardInput } from './input/keyboard';
import { PointerInput } from './input/pointer';
import { MetricsAccumulator } from './metrics';
import type { GameConnection } from './net/connection';
import type { LocalPredictor } from './net/prediction';

/**
 * Mutable per-session game objects shared by the scene and the loop. Deliberately not React
 * state: the frame loop reads and writes these 60 times a second without re-rendering anything.
 */
export interface GameRuntime {
  connection: GameConnection | null;
  predictor: LocalPredictor | null;
  /** The game's sound; set by the session. */
  audio: GameAudio | null;
  config: GameConfig;
  /** The world being played, as authored: what the scene draws (from the room.join ack; the prototype court until then). */
  layout: WorldLayout;
  /** Built from the layout: what prediction collides with. */
  arena: Arena;
  /** How characters look in this match (from the room.join ack). */
  appearance: AppearanceSettings;
  /** How the game may be seen (from the room.join ack). */
  camera: CameraSettings;
  /** The view this player sees now: the admin's default, or their own choice when allowed. */
  view: CameraView;
  keyboard: KeyboardInput;
  pointer: PointerInput;
  index: EntityIndex;
  metrics: MetricsAccumulator;
  /** Third person: the ground point under the pointer. */
  aim: { x: number; y: number; z: number; valid: boolean };
  localYaw: number;
  /** The weapon in hand (the server is told on every switch; it checks the same reloads). */
  weapon: WeaponId;
  /** performance.now() when the weapon in hand can fire after a switch. */
  weaponReadyAt: number;
  /** performance.now() of each weapon's last shot, for the reload shown and to skip shots the server would refuse. */
  lastShotAt: Partial<Record<WeaponId, number>>;
  inputAccumulatorMs: number;
  lastReconciledTick: number;
  dpr: number;
  gpu: string;
  /** Camera distance multiplier: the mouse wheel and +/- zoom out to see more of a big world. */
  zoom: number;
  /** A scripted camera for capturing footage (dev builds only, see `exposeForCapture`); replaces the rig while set. */
  director: Director | null;
}

/** What a scripted camera sees each frame: the clock and where every player is drawn. */
export interface DirectorFrame {
  now: number;
  players: { id: string; x: number; y: number; z: number; yaw: number; bot: boolean; local: boolean; status: string }[];
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

/** Returns the camera for this frame, or null to let the normal rig run. */
export type Director = (frame: DirectorFrame) => CameraPose | null;

export function createRuntime(): GameRuntime {
  return {
    connection: null,
    predictor: null,
    audio: null,
    config: DEFAULT_GAME_CONFIG,
    layout: PROTOTYPE_WORLD.layout,
    arena: arenaFromLayout(PROTOTYPE_WORLD.layout),
    appearance: DEFAULT_APPEARANCE,
    camera: DEFAULT_CAMERA,
    view: DEFAULT_CAMERA.defaultView,
    keyboard: new KeyboardInput(),
    pointer: new PointerInput(),
    index: new EntityIndex(),
    metrics: new MetricsAccumulator(),
    aim: { x: 0, y: 0, z: 0, valid: false },
    localYaw: 0,
    weapon: DEFAULT_WEAPON,
    weaponReadyAt: 0,
    lastShotAt: {},
    inputAccumulatorMs: 0,
    lastReconciledTick: -1,
    dpr: 1,
    gpu: 'unknown',
    zoom: 1,
    director: null,
  };
}

export const RuntimeContext = createContext<GameRuntime | null>(null);

export function useRuntime(): GameRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside RuntimeContext');
  return runtime;
}
