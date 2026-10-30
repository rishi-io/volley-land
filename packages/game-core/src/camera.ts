/** How the game is seen: from behind and above the player, or through their eyes. */
export type CameraView = 'third-person' | 'first-person';
export const CAMERA_VIEWS: readonly CameraView[] = ['third-person', 'first-person'];

/**
 * How players see the game. Presentation only: both views play by the same rules, and the server
 * decides every hit the same way. The server owns the live values (admin-managed) and sends them
 * on join, like the appearance.
 */
export interface CameraSettings {
  /** The view players start in. */
  defaultView: CameraView;
  /** Players may switch view themselves (V); off keeps everyone in the default view. */
  playerChoice: boolean;
  /** Field of view in first person, in degrees (vertical). */
  firstPersonFov: number;
}

export const DEFAULT_CAMERA: Readonly<CameraSettings> = Object.freeze({
  defaultView: 'third-person',
  playerChoice: true,
  firstPersonFov: 75,
});

/** The view a player gets: their own choice when players may choose, else the default. */
export const viewFor = (camera: CameraSettings, choice: CameraView | null): CameraView => (camera.playerChoice && choice ? choice : camera.defaultView);
