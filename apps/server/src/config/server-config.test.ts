import { describe, expect, it } from 'vitest';
import { allowedOrigins, loadAdminAuth, loadRoomSettings } from './server-config.js';

describe('loadRoomSettings', () => {
  it('uses DEV by default and validates the code', () => {
    expect(loadRoomSettings({}).devRoomCode).toBe('DEV');
    expect(loadRoomSettings({ DEV_ROOM_CODE: 'abc-1' }).devRoomCode).toBe('ABC-1');
    expect(() => loadRoomSettings({ DEV_ROOM_CODE: 'a' })).toThrow();
  });
});

describe('loadAdminAuth', () => {
  it('is open without a token in development and closed in production', () => {
    expect(loadAdminAuth({ NODE_ENV: 'development' })).toEqual({ token: null, openWithoutToken: true });
    expect(loadAdminAuth({ NODE_ENV: 'production' })).toEqual({ token: null, openWithoutToken: false });
  });

  it('requires a token of at least 16 characters', () => {
    expect(loadAdminAuth({ ADMIN_TOKEN: 'a-long-enough-token' }).token).toBe('a-long-enough-token');
    expect(() => loadAdminAuth({ ADMIN_TOKEN: 'short' })).toThrow();
  });
});

describe('allowedOrigins', () => {
  it('splits WEB_ORIGIN on commas', () => {
    expect(allowedOrigins({ WEB_ORIGIN: 'https://a.test, https://b.test' })).toEqual(['https://a.test', 'https://b.test']);
  });
});
