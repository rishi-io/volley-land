import { SECTION_SCHEMAS, SettingsSection } from '@volleyland/contracts';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from './catalog';
import { fromDraft, toDraft, validateSection } from './form';

const sample: Record<SettingsSection, Record<string, unknown>> = {
  simulation: { tickRate: 20, inputStepMs: 50, maxInputCredits: 4 },
  combat: { startingHealth: 100, wrongAnswerDamage: 25, answerTimeMs: 10000, freezeMaxMs: 10000, correctAnswerShieldMs: 2000, respawnMs: 4000, spawnProtectionMs: 2000 },
  movement: { playerSpeed: 6, playerRadius: 0.5, playerHeight: 1.8, maxSlopeDeg: 40 },
  projectiles: { projectileSpeed: 18, projectileRadius: 0.25, projectileLifetimeMs: 1500, projectileCooldownMs: 500, projectileHeight: 1.2 },
  weapons: {
    weaponSwitchMs: 250, blasterEnabled: true, blasterSpeed: 32, blasterRadius: 0.12, blasterLifetimeMs: 650, blasterCooldownMs: 220,
    scatterEnabled: true, scatterSpeed: 24, scatterRadius: 0.14, scatterLifetimeMs: 450, scatterCooldownMs: 900, scatterPellets: 5, scatterSpreadDeg: 24,
    railEnabled: false, railSpeed: 70, railRadius: 0.1, railLifetimeMs: 700, railCooldownMs: 2200,
  },
  rooms: { maxPlayers: 4, worldId: 'prototype-court' },
  questions: { curriculumIds: ['in-cbse'], levelIds: ['in-cbse-class-10'], subjectIds: [], difficulty: [2, 4] },
  bots: {
    fillRoomTo: 2, moveSpeedFactor: 0.7, wanderChangeMs: [800, 2000], preferredRange: [6, 14], aimErrorDeg: 20, reactionMs: 350, leadTarget: false,
    fireIntervalMs: [1200, 2200], maxRangeFactor: 0.8, missesBeforeSureShot: 4, sureShotWindupMs: 600, answerCorrectChance: 0.6, answerDelayMs: [2000, 6000],
  },
  appearance: {
    palette: ['#56b4e9', '#e69f00', '#2ec4a0', '#f0e442'], accessories: true, botMarker: true, nameTags: true, healthBars: 'opponents', blobShadows: true, animation: 1,
  },
  camera: { defaultView: 'first-person', playerChoice: false, firstPersonFov: 80 },
};

describe('admin catalog', () => {
  it('has one editor section per settings section, covering every setting exactly once', () => {
    expect(SECTIONS.map((s) => s.id).sort()).toEqual([...SettingsSection.options].sort());
    for (const spec of SECTIONS) {
      const schemaKeys = Object.keys(SECTION_SCHEMAS[spec.id].shape).sort();
      expect(spec.fields.map((f) => f.key).sort(), spec.id).toEqual(schemaKeys);
      // Labels and help come from the contracts schemas.
      for (const field of spec.fields) expect(field.label !== field.key && field.help !== '', `${spec.id}.${field.key}`).toBe(true);
    }
  });

  it('round-trips values through drafts and reports bad input per field', () => {
    for (const spec of SECTIONS) {
      expect(fromDraft(spec, toDraft(spec, sample[spec.id])), spec.id).toEqual(sample[spec.id]);
      expect(validateSection(spec.id, sample[spec.id]), spec.id).toEqual({});
    }
    const combat = SECTIONS.find((s) => s.id === 'combat')!;
    const blank = { ...toDraft(combat, sample.combat), startingHealth: '' };
    expect(Object.keys(validateSection('combat', fromDraft(combat, blank)))).toEqual(['startingHealth']);
    // Checks across fields run once each field is valid on its own.
    const tooLong = { ...toDraft(combat, sample.combat), answerTimeMs: '20000' };
    expect(Object.keys(validateSection('combat', fromDraft(combat, tooLong)))).toEqual(['answerTimeMs']);
  });
});
