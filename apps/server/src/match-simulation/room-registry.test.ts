import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentServiceWith } from '../content-workflow/testing.js';
import type { QuestionHistory } from '../question-selection/question-history.js';
import { QuestionSelectionService } from '../question-selection/question-selection.service.js';
import type { QuestionSelector } from '../question-selection/question-selector.js';
import { DEFAULT_SECTIONS, DEFAULT_SEED } from '../settings/defaults.js';
import { InMemorySettingsStore } from '../settings/in-memory-settings-store.js';
import { SettingsService } from '../settings/settings.service.js';
import { RoomRegistry } from './room-registry.service.js';

let registry: RoomRegistry | null = null;
afterEach(() => {
  registry?.onModuleDestroy();
  registry = null;
});

async function setup() {
  const content = await contentServiceWith();
  const settings = new SettingsService(new InMemorySettingsStore(), DEFAULT_SEED, { devRoomCode: 'DEV' }, content);
  await settings.load();
  const selection = new QuestionSelectionService(content);
  const matches: { pool: unknown; history: QuestionHistory; selector: QuestionSelector }[] = [];
  const forMatch = selection.forMatch.bind(selection);
  vi.spyOn(selection, 'forMatch').mockImplementation((matchId, pool, history) => {
    const selector = forMatch(matchId, pool, history);
    matches.push({ pool, history, selector });
    return selector;
  });
  registry = new RoomRegistry(settings, selection);
  registry.useSinkFactory(() => ({ toRoom: () => {}, toPlayer: () => {} }));
  registry.onModuleInit();
  return { settings, registry, matches };
}

describe('RoomRegistry questions', () => {
  it("asks from the world's own pool", async () => {
    const { settings, registry, matches } = await setup();
    registry.join('DEV', 'h1');
    expect(matches[0]!.pool).toEqual(settings.live().world.questions);
  });

  it('keeps what each player was asked across a new match, and forgets a player who leaves', async () => {
    const { settings, registry, matches } = await setup();
    registry.join('DEV', 'h1');
    registry.join('DEV', 'h2');
    const asked = new Set(Array.from({ length: 10 }, () => matches[0]!.selector.select('h1').questionId));

    // A rules change replaces the match; the players' sessions go on.
    await settings.updateSection('combat', { ...DEFAULT_SECTIONS.combat, startingHealth: 90 }, 1);
    expect(matches).toHaveLength(2);
    expect(matches[1]!.history).toBe(matches[0]!.history);
    const next = Array.from({ length: 5 }, () => matches[1]!.selector.select('h1').questionId);
    expect(next.filter((id) => asked.has(id))).toEqual([]);

    registry.leave('DEV', 'h1');
    expect(matches[1]!.history.askedCount('h1')).toBe(0);
  });
});
