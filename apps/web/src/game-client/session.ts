import { arenaFromLayout } from '@volleyland/game-core';
import type { SettingChange } from '@volleyland/contracts';
import type { World } from 'koota';
import { GameAudio } from './audio/game-audio';
import { clearWorld } from './ecs/sync';
import { Anim, PredictedProjectile } from './ecs/traits';
import { useHud } from './hud/hud-store';
import { mergeNotice } from './hud/settings-notice';
import type { GameConnection, JoinedMatch, SetupChange } from './net/connection';
import { LocalPredictor } from './net/prediction';
import type { GameRuntime } from './runtime';
import { applyView, faceCentre } from './view';
import { resetWeapons } from './weapons';

/**
 * Turns what the server says into client state. The layers:
 *   GameConnection (socket, envelopes, match tracking) → GameSession (this) → runtime, Koota world
 *   and HUD store → scene and HUD components.
 * The connection knows nothing about the scene; the React tree knows nothing about sockets.
 */
export class GameSession {
  private readonly unsubscribe: (() => void)[];
  private readonly audio: GameAudio;
  /** The latest shot heard from each other player (a scatter shot reports each of its bolts in the same tick). */
  private readonly lastShotTick = new Map<string, number>();

  constructor(
    private readonly connection: GameConnection,
    private readonly runtime: GameRuntime,
    private readonly world: World,
  ) {
    runtime.connection = connection;
    this.audio = runtime.audio = new GameAudio(runtime.index);
    const { audio } = this;
    connection.onRttSample = (ms) => runtime.metrics.rtt.push(ms);
    connection.onSnapshotSize = (bytes) => runtime.metrics.snapshotBytes.push(bytes);
    this.unsubscribe = [
      connection.onSetup((joined, change, changes) => this.applySetup(joined, change, changes)),
      connection.on('question.presented', (question) => {
        if (!this.isMe(question.targetId)) return;
        // Answering needs the pointer: let go of first-person mouse look.
        runtime.pointer.release();
        useHud.getState().set({ question, answeredOptionId: null, lastResult: null });
      }),
      connection.on('question.resolved', (resolved) => {
        if (!this.isMe(resolved.targetId)) return;
        audio.sfx(resolved.outcome === 'correct' ? 'correct' : 'wrong');
        const current = useHud.getState().question;
        useHud.getState().set({
          question: null,
          answeredOptionId: null,
          lastResult: { ...resolved, options: current?.encounterId === resolved.encounterId ? current.options : [] },
        });
      }),
      connection.on('player.respawned', (respawned) => {
        if (this.isMe(respawned.playerId)) {
          runtime.predictor?.reset(respawned);
          faceCentre(runtime, respawned);
        }
        audio.sfx('respawn', this.isMe(respawned.playerId) ? undefined : respawned.playerId);
        audio.bark(respawned.playerId, 'respawn');
      }),
      connection.on('hit.confirmed', (hit) => {
        this.animate(hit.targetId, 'hitAt');
        audio.sfx('hit', hit.targetId);
        if (this.isMe(hit.targetId)) audio.sfx('freeze');
        // A hit bot complains; otherwise a bot that landed the hit gloats.
        if (audio.isBot(hit.targetId)) audio.bark(hit.targetId, 'ouch');
        else audio.bark(hit.shooterId, 'hit');
      }),
      connection.on('health.changed', (changed) => {
        if (changed.health === 0) audio.sfx('knockout', this.isMe(changed.playerId) ? undefined : changed.playerId);
      }),
      connection.on('bot.windup', (windup) => audio.bark(windup.playerId, 'windup')),
      connection.on('projectile.spawned', (spawned) => {
        // Our own throw animated (and was heard) when it was predicted; others' when the server reports it.
        if (this.isMe(spawned.ownerId)) this.linkPredictedThrow(spawned.projectileId, spawned.tick);
        else if (this.lastShotTick.get(spawned.ownerId) !== spawned.tick) {
          this.lastShotTick.set(spawned.ownerId, spawned.tick);
          this.animate(spawned.ownerId, 'throwAt');
          audio.sfx(spawned.weapon === 'ball' ? 'throw' : spawned.weapon, spawned.ownerId);
          audio.bark(spawned.ownerId, 'throw');
        }
      }),
      connection.onDisconnect(() => useHud.getState().set({ connection: 'disconnected' })),
    ];
  }

  async start(roomCode: string): Promise<void> {
    useHud.getState().set({ connection: 'connecting', error: null });
    try {
      await this.connection.join(roomCode);
    } catch (error) {
      useHud.getState().set({ connection: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  dispose(): void {
    for (const stop of this.unsubscribe) stop();
    this.connection.close();
    this.audio.dispose();
    this.runtime.audio = null;
    this.runtime.connection = null;
    this.runtime.predictor = null;
  }

  /**
   * Put a match setup into effect. A joined or new match rebuilds the arena and prediction and
   * clears the scene; an update to the running match (appearance, camera) only swaps what is drawn.
   * Admin changes are never silent: the player is told what changed.
   */
  private applySetup({ playerId, setup }: JoinedMatch, change: SetupChange, changes: SettingChange[]): void {
    const { runtime } = this;
    runtime.config = setup.config;
    runtime.appearance = setup.appearance;
    runtime.camera = setup.camera;
    if (change !== 'updated') {
      runtime.layout = setup.world.layout;
      this.audio.setTheme(setup.world.layout.theme);
      runtime.arena = arenaFromLayout(setup.world.layout);
      runtime.predictor = new LocalPredictor(setup.config, runtime.arena);
      runtime.lastReconciledTick = -1;
      runtime.inputAccumulatorMs = 0;
      clearWorld(this.world, runtime.index);
      this.lastShotTick.clear();
      resetWeapons(runtime);
    }
    const hud = useHud.getState();
    hud.set({
      connection: 'connected',
      playerId,
      world: { id: setup.world.id, name: setup.world.name },
      maxHealth: setup.config.startingHealth,
      setupRevision: hud.setupRevision + 1,
      // An open question belonged to the match that just ended.
      ...(change === 'new-match' && { question: null, answeredOptionId: null, lastResult: null }),
      ...(changes.length > 0 && { settingsNotice: mergeNotice(hud.settingsNotice, change === 'new-match', changes) }),
      camera: setup.camera,
    });
    applyView(runtime);
  }

  private isMe(playerId: string): boolean {
    return playerId === this.connection.joined?.playerId;
  }

  private animate(playerId: string, key: 'throwAt' | 'hitAt'): void {
    this.runtime.index.players.get(playerId)?.set(Anim, (anim) => ({ ...anim, [key]: performance.now() }));
  }

  /** Link the oldest unlinked predicted throw to its server projectile. */
  private linkPredictedThrow(projectileId: string, tick: number): void {
    for (const entity of this.world.query(PredictedProjectile)) {
      const predicted = entity.get(PredictedProjectile);
      if (predicted && predicted.serverId === '') {
        entity.set(PredictedProjectile, { ...predicted, serverId: projectileId, serverTick: tick });
        break;
      }
    }
  }
}
