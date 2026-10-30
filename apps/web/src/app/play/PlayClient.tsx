'use client';

import dynamic from 'next/dynamic';

// WebGL and sockets are browser-only: never render the game on the server.
const Game = dynamic(() => import('@/game-client/Game'), { ssr: false, loading: () => <p className="loading">Loading arena…</p> });

export function PlayClient({ roomCode }: { roomCode: string }) {
  return <Game roomCode={roomCode} />;
}
