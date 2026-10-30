'use client';

import type { QuestionPoolDto } from '@volleyland/contracts';
import { type IdListKind, sectionSpec } from './catalog';
import styles from './admin.module.css';

/** The curricula, levels and subjects a question pool can pick from (from the question bank). */
export type ContentChoices = Record<IdListKind, { id: string; label: string }[]>;

/** Check boxes for a list of question-bank IDs. None picked means all of them. */
export function PickList({
  id,
  label,
  choices,
  picked,
  onChange,
}: {
  id: string;
  label: string;
  choices: { id: string; label: string }[];
  picked: string[];
  onChange: (picked: string[]) => void;
}) {
  // Picked IDs that no longer exist stay visible, so they can be removed.
  const missing = picked.filter((p) => !choices.some((c) => c.id === p)).map((p) => ({ id: p, label: `${p} (deleted)` }));
  return (
    <div className={styles.pickList} role="group" aria-label={label} aria-describedby={`${id}-help`}>
      {[...choices, ...missing].map((c, i) => (
        <label key={c.id}>
          <input
            id={i === 0 ? id : undefined}
            type="checkbox"
            checked={picked.includes(c.id)}
            onChange={(e) => onChange(e.target.checked ? [...picked, c.id] : picked.filter((p) => p !== c.id))}
          />
          {c.label}
        </label>
      ))}
      <span className={styles.fieldMeta}>{picked.length === 0 ? 'None picked: all of them' : `${picked.length} picked`}</span>
    </div>
  );
}

const LISTS: { key: 'curriculumIds' | 'levelIds' | 'subjectIds'; kind: IdListKind }[] = [
  { key: 'curriculumIds', kind: 'curricula' },
  { key: 'levelIds', kind: 'levels' },
  { key: 'subjectIds', kind: 'subjects' },
];

const LEVELS = [1, 2, 3, 4, 5];

/**
 * A world's own question pool, in the world builder's inspector. The labels and help are the
 * room-wide questions section's (both are the contracts' QuestionPoolSchema).
 */
export function QuestionPoolFields({
  pool,
  roomPool,
  content,
  onChange,
}: {
  pool: QuestionPoolDto | undefined;
  /** The room-wide pool, which a world without its own asks from (and its starting point when it gets one). */
  roomPool: QuestionPoolDto;
  content: ContentChoices;
  onChange: (pool: QuestionPoolDto | undefined) => void;
}) {
  const spec = sectionSpec('questions');
  const text = (key: string) => spec.fields.find((f) => f.key === key)!;
  const difficulty = text('difficulty');
  return (
    <fieldset>
      <legend>Questions</legend>
      <label className={styles.toggle}>
        <input type="checkbox" role="switch" checked={pool !== undefined} onChange={(e) => onChange(e.target.checked ? structuredClone(roomPool) : undefined)} />
        <span>{pool ? 'This world’s own questions' : 'Room-wide questions'}</span>
      </label>
      {!pool ? (
        <p className={styles.inspectorHint}>Players here are asked from the room-wide pool (Rooms and bots → {spec.title}). Turn this on to pick question banks, classes and subjects for this world.</p>
      ) : (
        <>
          {LISTS.map(({ key, kind }) => {
            const field = text(key);
            const id = `world-questions-${key}`;
            return (
              <div key={key} className={styles.stackField}>
                <span>{field.label}</span>
                <PickList id={id} label={field.label} choices={content[kind]} picked={pool[key]} onChange={(picked) => onChange({ ...pool, [key]: picked })} />
                <small id={`${id}-help`}>{field.help}</small>
              </div>
            );
          })}
          <div className={styles.stackField}>
            <span>{difficulty.label}</span>
            <span className={styles.rangeInputs}>
              {([0, 1] as const).map((end) => (
                <select
                  key={end}
                  className={styles.input}
                  aria-label={`${difficulty.label}, ${end === 0 ? 'from' : 'to'}`}
                  value={pool.difficulty[end]}
                  onChange={(e) => {
                    const next: [number, number] = [...pool.difficulty];
                    next[end] = Number(e.target.value);
                    onChange({ ...pool, difficulty: next });
                  }}
                >
                  {LEVELS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ))}
            </span>
            <small>{difficulty.help}</small>
          </div>
        </>
      )}
    </fieldset>
  );
}
