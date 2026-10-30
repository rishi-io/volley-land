import type { WeaponId } from '@volleyland/game-core';

/** What a character shows this frame: where it is and what is happening to it. */
export interface CharacterFrame {
  x: number;
  /** Ground height under the character (0 on a flat world). */
  y: number;
  z: number;
  yaw: number;
  status: 'alive' | 'frozen' | 'dead';
  protected: boolean;
  health: number;
  /** performance.now() of the latest throw / hit; far in the past when none. */
  throwAt: number;
  hitAt: number;
  /** The weapon in hand (a blaster is drawn at the character's side); absent in previews, empty-handed. */
  weapon?: WeaponId;
}

/** Per-character memory between frames (kept in a ref, never React state). */
export interface MotionState {
  started: boolean;
  px: number;
  pz: number;
  vx: number;
  vz: number;
  phase: number;
  frost: number;
  lastStatus: CharacterFrame['status'];
  statusAt: number;
}

/** Transform offsets for the character rig this frame. All zero/one at rest. */
export interface Pose {
  bob: number;
  leanX: number;
  leanZ: number;
  spin: number;
  lunge: number;
  scaleY: number;
  scaleXZ: number;
  /** Overall size: shrinks on knock-out, pops on respawn. */
  size: number;
  /** 0–1 white flash after a hit. */
  flash: number;
  /** 0–1 icy tint while frozen. */
  frost: number;
  visible: boolean;
}

export const newMotionState = (): MotionState => ({
  started: false,
  px: 0,
  pz: 0,
  vx: 0,
  vz: 0,
  phase: 0,
  frost: 0,
  lastStatus: 'alive',
  statusAt: Number.NEGATIVE_INFINITY,
});

const THROW_MS = 250;
const HIT_MS = 500;
const FLASH_MS = 220;
const KO_MS = 300;
const RESPAWN_MS = 380;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

/**
 * Advance one frame of procedural animation: run bob, squash and stretch, lean into movement,
 * idle breathing, throw lunge, hit wobble and flash, frost, knock-out shrink and respawn pop.
 * `strength` scales every motion (0 = still); the flash and frost are not motion and stay.
 */
export function stepPose(m: MotionState, f: CharacterFrame, dtSeconds: number, now: number, strength: number, runSpeed: number): Pose {
  const dt = Math.max(dtSeconds, 1e-3);
  if (!m.started) {
    Object.assign(m, { started: true, px: f.x, pz: f.z, lastStatus: f.status });
  }
  if (f.status !== m.lastStatus) {
    m.lastStatus = f.status;
    m.statusAt = now;
  }

  // Velocity from drawn positions, smoothed so interpolation steps do not jitter the gait.
  const k = 1 - Math.exp(-dt * 12);
  m.vx += ((f.x - m.px) / dt - m.vx) * k;
  m.vz += ((f.z - m.pz) / dt - m.vz) * k;
  m.px = f.x;
  m.pz = f.z;

  const moving = f.status === 'alive';
  const speed = moving ? Math.hypot(m.vx, m.vz) : 0;
  const s = clamp(speed / runSpeed, 0, 1);
  if (moving) m.phase += dt * speed * 5.5;

  const forward = moving ? (m.vx * Math.sin(f.yaw) + m.vz * Math.cos(f.yaw)) / runSpeed : 0;
  const side = moving ? (m.vx * Math.cos(f.yaw) - m.vz * Math.sin(f.yaw)) / runSpeed : 0;

  const breathe = Math.sin((now / 1000) * 2.2) * 0.02 * (1 - s);
  const stretch = 0.05 * s * Math.sin(2 * m.phase);
  const scaleY = 1 + (breathe + stretch) * strength;
  let leanX = clamp(forward, -1, 1) * 0.2 * strength;
  const leanZ0 = -clamp(side, -1, 1) * 0.2 * strength;

  const sinceThrow = now - f.throwAt;
  let lunge = 0;
  if (sinceThrow >= 0 && sinceThrow < THROW_MS) {
    lunge = Math.sin((sinceThrow / THROW_MS) * Math.PI) * 0.3 * strength;
    leanX += lunge * 0.6;
  }

  const sinceHit = (now - f.hitAt) / 1000;
  const wobble = sinceHit >= 0 && sinceHit < HIT_MS / 1000 ? Math.sin(sinceHit * 40) * Math.exp(-sinceHit * 7) * 0.35 * strength : 0;
  const flash = sinceHit >= 0 ? clamp(1 - (sinceHit * 1000) / FLASH_MS, 0, 1) : 0;

  m.frost += ((f.status === 'frozen' ? 1 : 0) - m.frost) * (1 - Math.exp(-dt * 10));

  let size = 1;
  let spin = 0;
  const sinceStatus = now - m.statusAt;
  if (f.status === 'dead') {
    const t = strength > 0 ? clamp(sinceStatus / KO_MS, 0, 1) : 1;
    size = 1 - t;
    spin = t * Math.PI * 1.5;
  } else if (sinceStatus < RESPAWN_MS && strength > 0) {
    size = easeOutBack(clamp(sinceStatus / RESPAWN_MS, 0, 1));
  }

  return {
    bob: Math.abs(Math.sin(m.phase)) * 0.14 * s * strength,
    leanX,
    leanZ: leanZ0 + wobble,
    spin,
    lunge,
    scaleY,
    scaleXZ: 1 / Math.sqrt(scaleY),
    size,
    flash,
    frost: m.frost,
    visible: size > 0.01,
  };
}
