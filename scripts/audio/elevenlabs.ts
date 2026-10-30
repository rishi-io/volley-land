/* What the audio scripts share: the ElevenLabs client, recipe hashing and paths. */
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.elevenlabs.io';
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
/** Voice samples to listen to locally; never shipped (gitignored). */
export const PREVIEWS = join(ROOT, 'scripts/audio/previews');

export function requireApiKey(): void {
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    fail('ELEVENLABS_API_KEY is not set. Copy .env.example to .env.local and add your key.');
  }
}

/** Calls the API; on an error response it exits, or returns null when `allowFailure` is set. */
export async function request(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  allowFailure = false,
): Promise<Buffer | null> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY?.trim() ?? '', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = Buffer.from(await res.arrayBuffer());
  if (res.ok) return data;
  if (allowFailure) return null;
  fail(`${method} ${path.split('?')[0]} failed (${res.status}): ${data.toString('utf8').slice(0, 500)}`);
}

export async function post(path: string, body: unknown): Promise<Buffer> {
  return (await request('POST', path, body)) as Buffer;
}

export function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}
