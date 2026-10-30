import { DEFAULT_GAME_CONFIG, createArena, stepMovement } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import { LocalPredictor } from './prediction.js';

const arena = createArena({ halfWidth: 15, halfDepth: 15 });
const dt = DEFAULT_GAME_CONFIG.inputStepMs / 1000;

describe('LocalPredictor', () => {
  it('reconciles to zero error when the server agrees', () => {
    const predictor = new LocalPredictor(DEFAULT_GAME_CONFIG, arena);
    predictor.reset({ x: 0, z: 0 });
    for (let seq = 0; seq < 5; seq++) predictor.apply({ seq, moveX: 1, moveZ: 0 });
    // Server has applied inputs 0–2.
    let server = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 3; i++) server = stepMovement(server, { moveX: 1, moveZ: 0 }, dt, DEFAULT_GAME_CONFIG, arena);
    expect(predictor.reconcile({ x: server.x, z: server.z, lastInputSeq: 2 })).toBeCloseTo(0);
    expect(predictor.position!.x).toBeCloseTo(5 * DEFAULT_GAME_CONFIG.playerSpeed * dt);
  });

  it('draws between the last two input steps, and stays continuous through a correction', () => {
    const predictor = new LocalPredictor(DEFAULT_GAME_CONFIG, arena);
    predictor.reset({ x: 0, z: 0 });
    predictor.apply({ seq: 0, moveX: 1, moveZ: 0 });
    const step = DEFAULT_GAME_CONFIG.playerSpeed * dt;
    expect(predictor.drawn(0)!.x).toBeCloseTo(0);
    expect(predictor.drawn(0.5)!.x).toBeCloseTo(step / 2);
    expect(predictor.drawn(1)!.x).toBeCloseTo(step);
    predictor.reconcile({ x: 1, z: 0, lastInputSeq: -1 });
    expect(predictor.drawn(0.5)!.x).toBeCloseTo(1 + step / 2);
  });

  it('snaps to the server and replays unacknowledged inputs on disagreement', () => {
    const predictor = new LocalPredictor(DEFAULT_GAME_CONFIG, arena);
    predictor.reset({ x: 0, z: 0 });
    for (let seq = 0; seq < 4; seq++) predictor.apply({ seq, moveX: 1, moveZ: 0 });
    // Server says input 1 left the player at x = -1 (e.g. it was pushed).
    const error = predictor.reconcile({ x: -1, z: 0, lastInputSeq: 1 });
    expect(error).toBeGreaterThan(1);
    expect(predictor.position!.x).toBeCloseTo(-1 + 2 * DEFAULT_GAME_CONFIG.playerSpeed * dt);
  });
});
