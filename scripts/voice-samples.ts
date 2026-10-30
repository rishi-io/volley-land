/*
 * Downloads preview clips from the ElevenLabs Voice Library, to pick bot voices by ear. Free: only
 * the public previews are fetched, nothing is generated or added to the account.
 *
 *   yarn audio:samples                     30 trending English character/conversational voices
 *   yarn audio:samples --count=50          more of them
 *   yarn audio:samples --search=coach      only voices matching a search term
 *
 * Files land in scripts/audio/previews/library/ (gitignored) with an index.md listing each
 * voice's number, name, labels and ID. Put a voice ID you like on a persona's `voiceId` in
 * scripts/audio/recipes.ts. Needs a key with the Voices: Read permission.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fail, PREVIEWS, requireApiKey, ROOT } from './audio/elevenlabs.ts';

interface SharedVoice {
  voice_id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  descriptive?: string;
  use_case?: string;
  description?: string;
  preview_url?: string;
  notice_period?: number | null;
  cloned_by_count?: number;
}

/** Voices described like this are the shrill or gravelly kind that grate after the tenth line. */
const GRATING = /raspy|gravel|rough|squeak|shrill|nasal|whin|scream|growl|creepy|scary|seductive|asmr|whisper/i;

const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const count = Number(option('count') ?? 30);
if (!Number.isInteger(count) || count < 1 || count > 100) fail('--count must be 1–100');
const search = option('search');
requireApiKey();

const found = new Map<string, SharedVoice>();
for (const useCase of ['characters_animation', 'conversational']) {
  for (let page = 0; page < 5 && found.size < count * 2; page++) {
    const query = new URLSearchParams({ page_size: '100', page: String(page), language: 'en', use_cases: useCase, sort: 'trending' });
    if (search) query.set('search', search);
    const res = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${query}`, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY?.trim() ?? '' },
    });
    const body = (await res.json()) as { voices?: SharedVoice[]; has_more?: boolean };
    if (!res.ok) fail(`Voice Library search failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
    for (const voice of body.voices ?? []) {
      const words = `${voice.name} ${voice.descriptive ?? ''} ${voice.description ?? ''}`;
      // Skip voices that can be withdrawn after a notice period, and the grating kind.
      if (!voice.preview_url || (voice.notice_period ?? 0) > 0 || GRATING.test(words)) continue;
      found.set(voice.voice_id, voice);
    }
    if (!body.has_more) break;
  }
}

// Alternate use cases and genders so the shortlist is a mix rather than thirty of one kind.
const groups = new Map<string, SharedVoice[]>();
for (const voice of found.values()) {
  const key = `${voice.use_case}/${voice.gender}`;
  groups.set(key, [...(groups.get(key) ?? []), voice]);
}
const picked: SharedVoice[] = [];
while (picked.length < count && [...groups.values()].some((g) => g.length > 0)) {
  for (const group of groups.values()) {
    const next = group.shift();
    if (next && picked.length < count) picked.push(next);
  }
}
if (picked.length === 0) fail('No voices matched.');

const dir = join(PREVIEWS, 'library');
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const rows: string[] = [];
for (const [i, voice] of picked.entries()) {
  const n = String(i + 1).padStart(2, '0');
  const slug = voice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const res = await fetch(voice.preview_url!);
  if (!res.ok) continue;
  await writeFile(join(dir, `${n}-${slug}.mp3`), Buffer.from(await res.arrayBuffer()));
  const labels = [voice.gender, voice.age, voice.accent, voice.descriptive, voice.use_case].filter(Boolean).join(', ');
  rows.push(`| ${n} | ${voice.name} | ${labels} | \`${voice.voice_id}\` | ${(voice.description ?? '').replace(/\s+/g, ' ').slice(0, 120)} |`);
  console.log(`${n} ${voice.name} (${labels})`);
}
await writeFile(
  join(dir, 'index.md'),
  `# Voice Library samples\n\n| # | Name | Labels | Voice ID | Description |\n|---|---|---|---|---|\n${rows.join('\n')}\n`,
);
console.log(`\nSaved ${rows.length} samples to ${relative(ROOT, dir)}/ (index.md lists the voice IDs).`);
console.log(`Listen: for f in ${relative(ROOT, dir)}/*.mp3; do echo $f; afplay $f; done`);
