import type { EncounterOutcome, PlayerStatus, QuestionPresented } from '@volleyland/contracts';
import { type CameraSettings, type CameraView, DEFAULT_CAMERA, DEFAULT_WEAPON, type WeaponId } from '@volleyland/game-core';
import { create } from 'zustand';
import { type SoundSettings, loadSoundSettings } from '../audio/sound-settings';
import type { SettingsNotice } from './settings-notice';
import { type ViewSettings, loadViewSettings } from './view-settings';

export interface MetricsReport {
  fps: number;
  /** Input round trip: send → snapshot acknowledging it (includes up to one tick of server wait). */
  rttMs: number;
  /** Mean local prediction correction at reconciliation (m). */
  predictionErrorM: number;
  /** Corrections above 1 cm per second. */
  correctionsPerSec: number;
  /** Mean distance between where a remote player is drawn and the latest authoritative position (m). */
  interpolationErrorM: number;
  snapshotBytes: number;
  snapshotsPerSec: number;
  /** Share of frames where render time ran past the newest snapshot. */
  starvedFramePct: number;
  dpr: number;
}

export interface ResolvedQuestion {
  encounterId: string;
  outcome: EncounterOutcome;
  selectedOptionId: string | null;
  correctOptionId: string | null;
  explanation: string | null;
  options: QuestionPresented['options'];
}

interface HudState {
  connection: 'connecting' | 'connected' | 'disconnected' | 'error';
  error: string | null;
  playerId: string | null;
  /** The world this match is played in. */
  world: { id: string; name: string } | null;
  /**
   * Bumped whenever a match setup is applied to the runtime (join, new match, live appearance
   * change). Scene parts that draw from runtime.config, arena or appearance re-render on it.
   */
  setupRevision: number;
  /** What the admin just changed, shown until it times out or is dismissed. */
  settingsNotice: SettingsNotice | null;
  health: number;
  maxHealth: number;
  status: PlayerStatus;
  protectedNow: boolean;
  /** The weapon in hand, and the ones this match allows (slot order). */
  weapon: WeaponId;
  weapons: WeaponId[];
  opponents: { id: string; health: number; status: PlayerStatus }[];
  question: QuestionPresented | null;
  answeredOptionId: string | null;
  lastResult: ResolvedQuestion | null;
  metrics: MetricsReport | null;
  metricsHistory: MetricsReport[];
  showMetrics: boolean;
  showMinimap: boolean;
  /** This player's volume settings (saved in the browser). */
  sound: SoundSettings;
  showSound: boolean;
  /** How the admin lets this match be seen. */
  camera: CameraSettings;
  /** This player's view choice and look speed (saved in the browser). */
  viewSettings: ViewSettings;
  /** The view in use now (derived from camera and viewSettings). */
  view: CameraView;
  /** First person: whether the pointer is captured for mouse look. */
  pointerLocked: boolean;
  set: (partial: Partial<HudState>) => void;
  pushMetrics: (report: MetricsReport) => void;
}

/** HUD, MCQ overlay and settings only. Simulation state lives in the Koota world, never here. */
export const useHud = create<HudState>((set) => ({
  connection: 'connecting',
  error: null,
  playerId: null,
  world: null,
  setupRevision: 0,
  settingsNotice: null,
  health: 100,
  maxHealth: 100,
  status: 'alive',
  protectedNow: false,
  weapon: DEFAULT_WEAPON,
  weapons: [DEFAULT_WEAPON],
  opponents: [],
  question: null,
  answeredOptionId: null,
  lastResult: null,
  metrics: null,
  metricsHistory: [],
  showMetrics: false,
  showMinimap: true,
  sound: loadSoundSettings(),
  showSound: false,
  camera: DEFAULT_CAMERA,
  viewSettings: loadViewSettings(),
  view: DEFAULT_CAMERA.defaultView,
  pointerLocked: false,
  set: (partial) => set(partial),
  pushMetrics: (report) => set((s) => ({ metrics: report, metricsHistory: [...s.metricsHistory.slice(-299), report] })),
}));
