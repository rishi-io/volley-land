import type { Metadata } from 'next';
import { PlayClient } from './PlayClient';

export const metadata: Metadata = { title: 'Play · Volleyland' };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const { room } = await searchParams;
  const roomCode = (room ?? 'DEV').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'DEV';
  return <PlayClient roomCode={roomCode} />;
}
