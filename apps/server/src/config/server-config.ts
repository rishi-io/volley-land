/*
 * Deployment-level server settings from env. Game rules, rooms, bots and worlds are not here:
 * they are admin-managed (see settings/), seeded from code defaults on first start.
 */
export const ROOM_SETTINGS = Symbol('ROOM_SETTINGS');
export const ADMIN_AUTH = Symbol('ADMIN_AUTH');

export interface RoomSettings {
  /** Phase 0 has no accounts: clients join the one dev room by this code. */
  devRoomCode: string;
}

export function loadRoomSettings(env: NodeJS.ProcessEnv = process.env): RoomSettings {
  const devRoomCode = (env.DEV_ROOM_CODE ?? 'DEV').toUpperCase();
  if (!/^[A-Z0-9-]{3,16}$/.test(devRoomCode)) throw new Error('DEV_ROOM_CODE must be 3–16 of A–Z, 0–9 or -');
  return { devRoomCode };
}

export interface AdminAuth {
  /** Bearer token the admin API requires, or null when none is configured. */
  token: string | null;
  /** Without a token the admin API is open in development and disabled in production. */
  openWithoutToken: boolean;
}

export function loadAdminAuth(env: NodeJS.ProcessEnv = process.env): AdminAuth {
  const token = env.ADMIN_TOKEN?.trim() || null;
  if (token !== null && token.length < 16) throw new Error('ADMIN_TOKEN must be at least 16 characters');
  return { token, openWithoutToken: env.NODE_ENV !== 'production' };
}

/** Origins allowed to call the server from a browser (WEB_ORIGIN, comma-separated). */
export const allowedOrigins = (env: NodeJS.ProcessEnv = process.env): string[] =>
  (env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
