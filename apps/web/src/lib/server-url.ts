/** Where the game server lives: an explicit URL, the dev server on :3001, or same origin behind the proxy. */
export function resolveServerUrl(): string {
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (configured) return configured;
  const { protocol, hostname, port, origin } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:3001` : origin;
}
