import { SECTION_TEXT, type SettingsSection, settingText } from '@volleyland/contracts';

/*
 * The admin panel's form layout for each settings section. The words (section titles and
 * summaries, field labels, help and units) live with the schemas in @volleyland/contracts, so
 * the panel and MCP tool descriptions say the same thing; this file only says how to edit.
 */

/** How a setting is edited. Validation stays in the contracts schemas; these only shape the inputs. */
export type FieldKind = 'number' | 'integer' | 'boolean' | 'range' | 'world' | 'colors' | 'choice' | 'curricula' | 'levels' | 'subjects';

/** Kinds edited as a list of question-bank IDs, picked from the bank. */
export type IdListKind = 'curricula' | 'levels' | 'subjects';
export const isIdList = (kind: FieldKind): kind is IdListKind => kind === 'curricula' || kind === 'levels' || kind === 'subjects';

interface FieldLayout {
  key: string;
  kind: FieldKind;
  /** Spinner increment. Limits live in the contracts schemas, not here. */
  step?: number;
  /** Subheading inside a long section. */
  group?: string;
  /** For 'choice': the options, in order. */
  choices?: { value: string; label: string }[];
}

interface SectionLayout {
  id: SettingsSection;
  nav: 'Game rules' | 'Rooms and bots' | 'Look and feel';
  /** Shown above the fields when a section needs a caution. */
  note?: string;
  fields: FieldLayout[];
}

export interface FieldSpec extends FieldLayout {
  label: string;
  help: string;
  unit?: string;
}

export interface SectionSpec extends Omit<SectionLayout, 'fields'> {
  title: string;
  summary: string;
  fields: FieldSpec[];
}

const LAYOUT: SectionLayout[] = [
  {
    id: 'combat',
    nav: 'Game rules',
    fields: [
      { key: 'startingHealth', kind: 'integer' },
      { key: 'wrongAnswerDamage', kind: 'integer' },
      { key: 'answerTimeMs', kind: 'integer', step: 500 },
      { key: 'freezeMaxMs', kind: 'integer', step: 500 },
      { key: 'correctAnswerShieldMs', kind: 'integer', step: 250 },
      { key: 'respawnMs', kind: 'integer', step: 500 },
      { key: 'spawnProtectionMs', kind: 'integer', step: 250 },
    ],
  },
  {
    id: 'movement',
    nav: 'Game rules',
    fields: [
      { key: 'playerSpeed', kind: 'number', step: 0.5 },
      { key: 'playerRadius', kind: 'number', step: 0.05 },
      { key: 'playerHeight', kind: 'number', step: 0.1 },
      { key: 'maxSlopeDeg', kind: 'number', step: 1 },
    ],
  },
  {
    id: 'projectiles',
    nav: 'Game rules',
    fields: [
      { key: 'projectileSpeed', kind: 'number', step: 1 },
      { key: 'projectileRadius', kind: 'number', step: 0.05 },
      { key: 'projectileLifetimeMs', kind: 'integer', step: 100 },
      { key: 'projectileCooldownMs', kind: 'integer', step: 50 },
      { key: 'projectileHeight', kind: 'number', step: 0.1 },
    ],
  },
  {
    id: 'weapons',
    nav: 'Game rules',
    fields: [
      { key: 'weaponSwitchMs', kind: 'integer', step: 50, group: 'Switching' },
      { key: 'blasterEnabled', kind: 'boolean', group: 'Blaster (2)' },
      { key: 'blasterSpeed', kind: 'number', step: 1, group: 'Blaster (2)' },
      { key: 'blasterRadius', kind: 'number', step: 0.02, group: 'Blaster (2)' },
      { key: 'blasterLifetimeMs', kind: 'integer', step: 50, group: 'Blaster (2)' },
      { key: 'blasterCooldownMs', kind: 'integer', step: 10, group: 'Blaster (2)' },
      { key: 'scatterEnabled', kind: 'boolean', group: 'Scatter (3)' },
      { key: 'scatterSpeed', kind: 'number', step: 1, group: 'Scatter (3)' },
      { key: 'scatterRadius', kind: 'number', step: 0.02, group: 'Scatter (3)' },
      { key: 'scatterLifetimeMs', kind: 'integer', step: 50, group: 'Scatter (3)' },
      { key: 'scatterCooldownMs', kind: 'integer', step: 50, group: 'Scatter (3)' },
      { key: 'scatterPellets', kind: 'integer', group: 'Scatter (3)' },
      { key: 'scatterSpreadDeg', kind: 'number', step: 1, group: 'Scatter (3)' },
      { key: 'railEnabled', kind: 'boolean', group: 'Rail (4)' },
      { key: 'railSpeed', kind: 'number', step: 5, group: 'Rail (4)' },
      { key: 'railRadius', kind: 'number', step: 0.02, group: 'Rail (4)' },
      { key: 'railLifetimeMs', kind: 'integer', step: 50, group: 'Rail (4)' },
      { key: 'railCooldownMs', kind: 'integer', step: 100, group: 'Rail (4)' },
    ],
  },
  {
    id: 'simulation',
    nav: 'Game rules',
    note: 'Change tick rate and input step together: one input step must last exactly one tick (input step = 1000 ÷ tick rate).',
    fields: [
      { key: 'tickRate', kind: 'number', step: 1 },
      { key: 'inputStepMs', kind: 'integer' },
      { key: 'maxInputCredits', kind: 'integer' },
    ],
  },
  {
    id: 'rooms',
    nav: 'Rooms and bots',
    fields: [
      { key: 'maxPlayers', kind: 'integer' },
      { key: 'worldId', kind: 'world' },
    ],
  },
  {
    id: 'questions',
    nav: 'Rooms and bots',
    note: 'This pool applies in worlds without their own (each built-in world but the prototype court has one; set it in the world builder). Questions are written and published under Question bank: a question published, edited or retired there is asked (or not) from the next hit on. Changing this pool starts a new match in rooms it applies to.',
    fields: [
      { key: 'curriculumIds', kind: 'curricula' },
      { key: 'levelIds', kind: 'levels' },
      { key: 'subjectIds', kind: 'subjects' },
      { key: 'difficulty', kind: 'range', step: 1 },
    ],
  },
  {
    id: 'bots',
    nav: 'Rooms and bots',
    fields: [
      { key: 'fillRoomTo', kind: 'integer', group: 'Seats' },
      { key: 'moveSpeedFactor', kind: 'number', step: 0.05, group: 'Movement' },
      { key: 'wanderChangeMs', kind: 'range', step: 100, group: 'Movement' },
      { key: 'preferredRange', kind: 'range', step: 0.5, group: 'Movement' },
      { key: 'aimErrorDeg', kind: 'number', step: 1, group: 'Aim' },
      { key: 'reactionMs', kind: 'integer', step: 50, group: 'Aim' },
      { key: 'leadTarget', kind: 'boolean', group: 'Aim' },
      { key: 'fireIntervalMs', kind: 'range', step: 100, group: 'Aim' },
      { key: 'maxRangeFactor', kind: 'number', step: 0.05, group: 'Aim' },
      { key: 'missesBeforeSureShot', kind: 'integer', group: 'Sure shot' },
      { key: 'sureShotWindupMs', kind: 'integer', step: 50, group: 'Sure shot' },
      { key: 'answerCorrectChance', kind: 'number', step: 0.05, group: 'Questions' },
      { key: 'answerDelayMs', kind: 'range', step: 250, group: 'Questions' },
    ],
  },
  {
    id: 'appearance',
    nav: 'Look and feel',
    fields: [
      { key: 'palette', kind: 'colors', group: 'Identity' },
      { key: 'accessories', kind: 'boolean', group: 'Identity' },
      { key: 'botMarker', kind: 'boolean', group: 'Identity' },
      { key: 'nameTags', kind: 'boolean', group: 'Over their heads' },
      {
        key: 'healthBars',
        kind: 'choice',
        group: 'Over their heads',
        choices: [
          { value: 'off', label: 'Off' },
          { value: 'opponents', label: 'Other players' },
          { value: 'everyone', label: 'Everyone' },
        ],
      },
      { key: 'blobShadows', kind: 'boolean', group: 'Motion and effects' },
      { key: 'animation', kind: 'number', step: 0.1, group: 'Motion and effects' },
    ],
  },
  {
    id: 'camera',
    nav: 'Look and feel',
    note: 'Both views play by the same rules: the server decides every hit either way. First person suits a mouse; on a touchpad, third person is easier.',
    fields: [
      {
        key: 'defaultView',
        kind: 'choice',
        choices: [
          { value: 'third-person', label: 'Third person (behind and above)' },
          { value: 'first-person', label: 'First person (through their eyes)' },
        ],
      },
      { key: 'playerChoice', kind: 'boolean' },
      { key: 'firstPersonFov', kind: 'number', step: 5 },
    ],
  },
];


/** Layout plus the words from contracts. A field without words there is a bug the catalog test reports. */
export const SECTIONS: SectionSpec[] = LAYOUT.map((section) => ({
  ...section,
  ...SECTION_TEXT[section.id],
  fields: section.fields.map((field) => {
    const text = settingText(section.id, field.key);
    return { ...field, label: text?.title ?? field.key, help: text?.description ?? '', ...(text?.unit ? { unit: text.unit } : {}) };
  }),
}));

export const sectionSpec = (id: SettingsSection): SectionSpec => SECTIONS.find((s) => s.id === id)!;
