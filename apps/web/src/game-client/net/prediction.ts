import { type Arena, type GameConfig, type MoveInput, type Vec3, distance, groundHeight, stepMovement } from '@volleyland/game-core';

interface PendingInput extends MoveInput {
  seq: number;
}

/**
 * Client-side prediction for the local player: apply each input immediately with the same
 * game-core movement code the server runs, then reconcile against authoritative snapshots by
 * replaying the inputs the server has not yet acknowledged.
 */
export class LocalPredictor {
  private pending: PendingInput[] = [];
  private predicted: Vec3 | null = null;
  /** Where the player was before the latest input step, to draw smoothly between steps. */
  private previous: Vec3 | null = null;

  constructor(
    private readonly config: GameConfig,
    private readonly arena: Arena,
  ) {}

  get position(): Vec3 | null {
    return this.predicted;
  }

  /**
   * Where to draw the player this frame: `alpha` (0–1) of the way from the position before the
   * latest input step to the predicted one. Inputs step 20 times a second; drawing between them
   * keeps the camera smooth at any frame rate (a first-person view would judder otherwise).
   */
  drawn(alpha: number): Vec3 | null {
    const to = this.predicted;
    const from = this.previous;
    if (!to || !from) return to;
    const t = Math.max(0, Math.min(1, alpha));
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
  }

  /** Apply a just-sent input locally. */
  apply(input: PendingInput): void {
    if (!this.predicted) return;
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    this.previous = this.predicted;
    this.predicted = stepMovement(this.predicted, input, this.config.inputStepMs / 1000, this.config, this.arena);
  }

  /**
   * Rebase on the server's position for the last input it applied and replay the rest.
   * Returns how far the prediction was off (the correction distance).
   */
  reconcile(server: { x: number; z: number; lastInputSeq: number }): number {
    const before = this.predicted;
    this.pending = this.pending.filter((input) => input.seq > server.lastInputSeq);
    let position: Vec3 = { x: server.x, y: groundHeight(this.arena, server.x, server.z), z: server.z };
    for (const input of this.pending) {
      position = stepMovement(position, input, this.config.inputStepMs / 1000, this.config, this.arena);
    }
    this.predicted = position;
    // Shift the in-between point by the same correction, so drawing stays continuous.
    if (before && this.previous) {
      this.previous = { x: this.previous.x + position.x - before.x, y: this.previous.y + position.y - before.y, z: this.previous.z + position.z - before.z };
    }
    return before ? distance(before, position) : 0;
  }

  /** Hard reset (respawn, or while frozen/dead when the server owns the position). */
  reset(server: { x: number; z: number }): void {
    this.pending = [];
    this.predicted = { x: server.x, y: groundHeight(this.arena, server.x, server.z), z: server.z };
    this.previous = this.predicted;
  }
}
