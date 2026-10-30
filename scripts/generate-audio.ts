/*
 * Generates the game's audio with ElevenLabs from scripts/audio/recipes.ts into
 * apps/web/public/audio/, and writes the client's manifest of what exists
 * (apps/web/src/game-client/audio/manifest.ts). Runs on a developer machine only; players never
 * call ElevenLabs.
 *
 *   yarn audio:generate                    every kind
 *   yarn audio:generate sfx voices         only these kinds (sfx, voices, music)
 *   yarn audio:generate --force            regenerate even when the recipe is unchanged
 *   yarn audio:generate --dry-run          list what would change, spend nothing
 *
 * A file is regenerated only when its recipe changed (tracked in scripts/audio/state.json), and
 * a file whose recipe was removed is deleted. Library voices are added to the ElevenLabs account
 * once (the state file keeps their IDs); a voice removed from the recipes is removed from the
 * account.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fail, hashOf, post, request, requireApiKey, ROOT } from './audio/elevenlabs.ts';
import { type BarkEvent, LINES, MUSIC, SFX, VOICES, type VoiceRecipe } from './audio/recipes.ts';

const OUT = join(ROOT, 'apps/web/public/audio');
const MANIFEST = join(ROOT, 'apps/web/src/game-client/audio/manifest.ts');
const STATE_FILE = join(ROOT, 'scripts/audio/state.json');
const KINDS = ['sfx', 'voices', 'music'] as const;
type Kind = (typeof KINDS)[number];

interface State {
  /** Persona ID → the voice in the ElevenLabs account and the recipe hash it was added from. */
  voices: Record<string, { voiceId: string; hash: string }>;
  /** Output path (relative to audio/) → hash of the recipe that made it. */
  files: Record<string, string>;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const unknown = args.filter((a) => !a.startsWith('--') && !(KINDS as readonly string[]).includes(a));
if (unknown.length > 0) fail(`Unknown kind: ${unknown.join(', ')} (expected ${KINDS.join(', ')})`);
const picked = args.filter((a): a is Kind => (KINDS as readonly string[]).includes(a));
const kinds = new Set<Kind>(picked.length > 0 ? picked : KINDS);
if (!dryRun) requireApiKey();

const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(await readFile(STATE_FILE, 'utf8')) as State)
  : { voices: {}, files: {} };
let generated = 0;
let skipped = 0;

const sfxPath = (id: string) => `sfx/${id}.mp3`;
const musicPath = (theme: string) => `music/${theme}.mp3`;
/** Lines are numbered per persona and event: voices/cowboy/hit-1.mp3, hit-2.mp3, … */
const linePaths = LINES.map((line, i) => {
  const n = LINES.slice(0, i + 1).filter((l) => l.voice === line.voice && l.event === line.event).length;
  return `voices/${line.voice}/${line.event}-${n}.mp3`;
});

await removeStale();

if (kinds.has('sfx')) {
  for (const sfx of SFX) {
    await produce(sfxPath(sfx.id), sfx, () =>
      post('/v1/sound-generation?output_format=mp3_44100_128', {
        text: sfx.prompt,
        duration_seconds: sfx.seconds,
        loop: sfx.loop ?? false,
        prompt_influence: sfx.influence,
        model_id: 'eleven_text_to_sound_v2',
      }),
    );
  }
}

if (kinds.has('voices')) {
  for (const [i, line] of LINES.entries()) {
    const voice = VOICES.find((v) => v.id === line.voice);
    if (!voice) fail(`Line "${line.text}" uses unknown voice "${line.voice}"`);
    const voiceId = dryRun ? (state.voices[voice.id]?.voiceId ?? `new ${voice.id}`) : await ensureVoice(voice);
    await produce(linePaths[i]!, { line, voiceId }, () =>
      post(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        text: line.text,
        model_id: 'eleven_v3',
        seed: line.seed,
      }),
    );
  }
}

if (kinds.has('music')) {
  for (const track of MUSIC) {
    await produce(musicPath(track.theme), track, () =>
      post('/v1/music?output_format=mp3_44100_128', {
        prompt: track.prompt,
        music_length_ms: track.lengthMs,
        force_instrumental: true,
      }),
    );
  }
}

if (!dryRun) await writeManifest();
console.log(`\n${dryRun ? 'Would generate' : 'Generated'} ${generated}, unchanged ${skipped}.`);

/** Writes one file from `make()` unless it exists and was made from the same recipe. */
async function produce(path: string, recipe: unknown, make: () => Promise<Buffer>): Promise<void> {
  const hash = hashOf(recipe);
  const file = join(OUT, path);
  if (!force && state.files[path] === hash && existsSync(file)) {
    skipped++;
    return;
  }
  generated++;
  if (dryRun) {
    console.log(`would generate ${path}`);
    return;
  }
  process.stdout.write(`generating ${path} … `);
  const audio = await make();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, audio);
  state.files[path] = hash;
  await saveState();
  console.log(`${(audio.length / 1024).toFixed(0)} KB`);
}

/** Returns the account's copy of a persona's library voice, adding it first if needed. */
async function ensureVoice(voice: VoiceRecipe): Promise<string> {
  const hash = hashOf(voice.library);
  const saved = state.voices[voice.id];
  if (saved && saved.hash === hash) return saved.voiceId;

  process.stdout.write(`adding library voice ${voice.id} … `);
  const { voiceId, ownerId } = voice.library;
  const added = await request('POST', `/v1/voices/add/${ownerId}/${voiceId}`, { new_name: voice.name }, true);
  // Adding fails when the voice is already in the account; it is usable by its library ID then.
  const id = added ? (JSON.parse(added.toString('utf8')) as { voice_id: string }).voice_id : voiceId;
  if (saved && saved.voiceId !== id) await request('DELETE', `/v1/voices/${saved.voiceId}`, undefined, true);
  state.voices[voice.id] = { voiceId: id, hash };
  await saveState();
  console.log(added ? `added as ${id}` : 'already in the account');
  return id;
}

/** Deletes files no recipe makes any more, and removes voices no recipe uses from the account. */
async function removeStale(): Promise<void> {
  const wanted = new Set([...SFX.map((s) => sfxPath(s.id)), ...linePaths, ...MUSIC.map((m) => musicPath(m.theme))]);
  for (const path of Object.keys(state.files)) {
    if (wanted.has(path)) continue;
    console.log(`${dryRun ? 'would remove' : 'removing'} ${path}`);
    if (dryRun) continue;
    await rm(join(OUT, path), { force: true });
    delete state.files[path];
  }
  for (const [persona, { voiceId }] of Object.entries(state.voices)) {
    if (VOICES.some((v) => v.id === persona)) continue;
    console.log(`${dryRun ? 'would remove' : 'removing'} voice ${persona} from the account`);
    if (dryRun) continue;
    await request('DELETE', `/v1/voices/${voiceId}`, undefined, true);
    await rm(join(OUT, 'voices', persona), { recursive: true, force: true });
    delete state.voices[persona];
  }
  if (!dryRun) await saveState();
}

/** The client's list of every sound that exists, with a version so a regenerated file is refetched. */
async function writeManifest(): Promise<void> {
  const url = (path: string) => (existsSync(join(OUT, path)) ? `/audio/${path}?v=${state.files[path]}` : null);
  const sfx: Record<string, string> = {};
  for (const s of SFX) {
    const u = url(sfxPath(s.id));
    if (u) sfx[s.id] = u;
  }
  const voices: Record<string, Partial<Record<BarkEvent, string[]>>> = {};
  for (const [i, line] of LINES.entries()) {
    const u = url(linePaths[i]!);
    if (!u) continue;
    ((voices[line.voice] ??= {})[line.event] ??= []).push(u);
  }
  const music: Record<string, string> = {};
  for (const m of MUSIC) {
    const u = url(musicPath(m.theme));
    if (u) music[m.theme] = u;
  }
  const body = JSON.stringify({ sfx, voices, music }, null, 2);
  await mkdir(dirname(MANIFEST), { recursive: true });
  await writeFile(
    MANIFEST,
    `// Generated by \`yarn audio:generate\` (scripts/generate-audio.ts) from the files in public/audio. Do not edit.\n` +
      `import type { AudioManifest } from './audio-manifest';\n\n` +
      `export const AUDIO_MANIFEST: AudioManifest = ${body};\n`,
  );
}

async function saveState(): Promise<void> {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}
