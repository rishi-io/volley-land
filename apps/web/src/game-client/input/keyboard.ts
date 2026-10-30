/** Held-key tracker for movement; reads `event.code` so it works on any keyboard layout. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Set when the throw key goes down; consumed by the game loop. */
  throwRequested = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat && event.code === 'Space') return;
    if (event.code === 'Space') {
      this.throwRequested = true;
      event.preventDefault();
    }
    this.held.add(event.code);
  };
  /** The throw key is held down (the blaster keeps firing while it is). */
  get firing(): boolean {
    return this.held.has('Space');
  }

  private readonly onKeyUp = (event: KeyboardEvent) => this.held.delete(event.code);
  private readonly onBlur = () => this.held.clear();

  attach(target: Window): () => void {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    return () => {
      target.removeEventListener('keydown', this.onKeyDown);
      target.removeEventListener('keyup', this.onKeyUp);
      target.removeEventListener('blur', this.onBlur);
    };
  }

  /**
   * Movement on the ground plane relative to where the camera faces (`yaw`; 0 looks along +z, as
   * the third-person camera always does): up/W is forward, right/D is the screen's right. Never
   * longer than 1, so each axis stays within what the server accepts.
   */
  movement(yaw = 0): { moveX: number; moveZ: number } {
    const h = this.held;
    const forward = (h.has('KeyW') || h.has('ArrowUp') ? 1 : 0) - (h.has('KeyS') || h.has('ArrowDown') ? 1 : 0);
    const right = (h.has('KeyD') || h.has('ArrowRight') ? 1 : 0) - (h.has('KeyA') || h.has('ArrowLeft') ? 1 : 0);
    return moveFrom(forward, right, yaw);
  }
}

/** Forward/right input turned to face `yaw` (forward = (sin, cos), right = (−cos, sin)), at most length 1. */
export function moveFrom(forward: number, right: number, yaw: number): { moveX: number; moveZ: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  let moveX = forward * s - right * c;
  let moveZ = forward * c + right * s;
  const length = Math.hypot(moveX, moveZ);
  if (length > 1) {
    moveX /= length;
    moveZ /= length;
  }
  // Tidy the rounding so a key held at yaw 0 sends exactly ±1 and 0.
  return { moveX: Math.abs(moveX) < 1e-9 ? 0 : moveX, moveZ: Math.abs(moveZ) < 1e-9 ? 0 : moveZ };
}
