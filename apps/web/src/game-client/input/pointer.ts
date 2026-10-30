import { MAX_THROW_PITCH } from '@volleyland/game-core';

/** Look sensitivity: radians turned per pixel of mouse movement at 1×. */
const RADIANS_PER_PIXEL = 0.0022;
/** First-person look stops short of straight up or down. */
const MAX_LOOK_PITCH = Math.min(1.45, MAX_THROW_PITCH + 0.25);

/**
 * The mouse over the game canvas. In third person it tracks where the pointer is (the game loop
 * turns that into an aim point on the ground) and a click throws. In first person a click
 * captures the pointer (pointer lock), mouse movement turns the view, and while captured a
 * click throws; Esc (the browser) or an open question lets it go.
 */
export class PointerInput {
  /** Pointer position in normalised device coordinates (−1…1), while it is over the canvas. */
  readonly ndc = { x: 0, y: 0, over: false };
  /** First-person view direction: yaw 0 looks along +z; pitch is up from level. */
  readonly look = { yaw: 0, pitch: 0 };
  /** Multiplies the look speed (the player's own setting). */
  sensitivity = 1;
  /** First person: mouse movement turns the view and clicks capture the pointer. */
  firstPerson = false;
  /** Set on a throwing click; consumed by the game loop. */
  throwRequested = false;
  /** The throwing button is held down (the blaster keeps firing while it is). */
  firing = false;
  /** Told when the pointer is captured or let go (the HUD shows a "click to play" prompt). */
  onLockChange: ((locked: boolean) => void) | null = null;
  private element: HTMLElement | null = null;

  get locked(): boolean {
    return typeof document !== 'undefined' && this.element !== null && document.pointerLockElement === this.element;
  }

  attach(element: HTMLElement): () => void {
    this.element = element;
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      this.ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.ndc.over = true;
      if (this.firstPerson && this.locked) this.turn(event.movementX, event.movementY);
    };
    const onLeave = () => {
      this.ndc.over = false;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (this.firstPerson && !this.locked) {
        this.capture();
        return;
      }
      this.throwRequested = true;
      this.firing = true;
    };
    const onUp = (event: PointerEvent) => {
      if (event.button === 0) this.firing = false;
    };
    const onLockChange = () => {
      if (!this.locked) this.firing = false;
      this.onLockChange?.(this.locked);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      this.release();
      this.element = null;
    };
  }

  /** Capture the pointer for mouse look (needs a click: browsers only allow it after one). */
  capture(): void {
    const element = this.element;
    if (!element || this.locked) return;
    try {
      // Raw input skips the OS pointer acceleration where the browser supports it.
      const request = element.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      request?.catch(() => element.requestPointerLock()?.catch(() => undefined));
    } catch {
      element.requestPointerLock();
    }
  }

  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Turn the first-person view by a mouse movement in pixels (right turns right, up looks up). */
  turn(dx: number, dy: number): void {
    const k = RADIANS_PER_PIXEL * this.sensitivity;
    // Turning right moves the view from +z towards −x (the screen's right from behind the player).
    this.look.yaw = wrapAngle(this.look.yaw - dx * k);
    this.look.pitch = Math.max(-MAX_LOOK_PITCH, Math.min(MAX_LOOK_PITCH, this.look.pitch - dy * k));
  }
}

function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  return ((((a + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}
