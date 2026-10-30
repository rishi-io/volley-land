import type { ThemeId } from '@volleyland/game-core';
import { Look, Transform } from '../ecs/traits';
import { useHud } from '../hud/hud-store';
import type { EntityIndex } from '../ecs/sync';
import type { BarkEvent } from './audio-manifest';
import { type At, AudioEngine } from './audio-engine';
import { BarkPolicy, voiceFor } from './bark-policy';
import { AUDIO_MANIFEST } from './manifest';
import { saveSoundSettings } from './sound-settings';

export type SfxId = 'throw' | 'blaster' | 'scatter' | 'rail' | 'switch' | 'hit' | 'freeze' | 'correct' | 'wrong' | 'knockout' | 'respawn';

/** Sounds that stand in for one not generated yet (a blaster shot whooshes like a throw until it has its own). */
const FALLBACK: Partial<Record<SfxId, SfxId>> = { blaster: 'throw', scatter: 'throw', rail: 'throw' };

const VOICES = Object.keys(AUDIO_MANIFEST.voices).sort();

/**
 * The game's sound: effects for what happens, lines from bots near the player, and music for the
 * world. The session calls it with server events (it never touches the socket); it reads player
 * positions and looks from the entity index, and the player's volume settings from the HUD store.
 */
export class GameAudio {
  private readonly engine: AudioEngine;
  private readonly barks = new BarkPolicy();
  private readonly unsubscribe: () => void;

  constructor(private readonly index: EntityIndex) {
    const hud = useHud.getState();
    this.engine = new AudioEngine(hud.sound);
    this.engine.preload(Object.values(AUDIO_MANIFEST.sfx));
    this.engine.preload(Object.values(AUDIO_MANIFEST.voices).flatMap((lines) => Object.values(lines).flat()));
    this.unsubscribe = useHud.subscribe((state, prev) => {
      if (state.sound !== prev.sound) {
        this.engine.setSettings(state.sound);
        saveSoundSettings(state.sound);
      }
      // Quieter music while answering, so the player can think.
      if (state.question !== prev.question) this.engine.setDucked(state.question !== null);
    });
  }

  /** Call from any user gesture; browsers keep audio silent until one. */
  unlock(): void {
    this.engine.unlock();
  }

  setTheme(theme: ThemeId): void {
    this.engine.setMusic(AUDIO_MANIFEST.music[theme] ?? AUDIO_MANIFEST.music.park ?? null);
  }

  /** Every frame: the listener is the local player. */
  setListener(x: number, z: number, yaw = 0): void {
    this.engine.setListener(x, z, yaw);
  }

  /** A sound effect, placed at a player when given (else heard as the player's own). */
  sfx(id: SfxId, playerId?: string): void {
    const url = AUDIO_MANIFEST.sfx[id] ?? AUDIO_MANIFEST.sfx[FALLBACK[id] ?? id];
    if (url) this.engine.play(url, 'sfx', playerId === undefined ? undefined : this.positionOf(playerId));
  }

  /** A bot's line for a game moment, if it is a bot, near enough, and not talking too much. */
  bark(playerId: string, event: BarkEvent): void {
    const entity = this.index.players.get(playerId);
    const look = entity?.get(Look);
    const at = this.positionOf(playerId);
    if (!look?.bot || !at) return;
    const voice = voiceFor(look.look, VOICES);
    const takes = voice ? AUDIO_MANIFEST.voices[voice]?.[event] : undefined;
    if (!voice || !takes?.length) return;
    const now = performance.now();
    if (!this.barks.admit(playerId, event, this.engine.distanceTo(at), now)) return;
    const take = this.barks.pickTake(voice, event, takes);
    const durationMs = take ? this.engine.play(take, 'voice', at) : null;
    if (durationMs !== null) this.barks.speaking(now, durationMs);
  }

  isBot(playerId: string): boolean {
    return this.index.players.get(playerId)?.get(Look)?.bot ?? false;
  }

  dispose(): void {
    this.unsubscribe();
    this.engine.dispose();
  }

  private positionOf(playerId: string): At | undefined {
    const t = this.index.players.get(playerId)?.get(Transform);
    return t ? { x: t.x, z: t.z } : undefined;
  }
}
