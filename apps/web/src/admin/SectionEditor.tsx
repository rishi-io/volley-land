'use client';

import type { Versioned, WorldDto } from '@volleyland/contracts';
import type { AppearanceSettings } from '@volleyland/game-core';
import dynamic from 'next/dynamic';
import { Fragment } from 'react';
import { type FieldSpec, type SectionSpec, isIdList } from './catalog';
import { type ContentChoices, PickList } from './QuestionPoolFields';
import { type DraftValue, type FieldIssues, type SectionDraft, fromDraft, sameValue, toDraft, validateSection } from './form';
import styles from './admin.module.css';

// Three.js loads only when the Characters section is opened.
const CharacterPreview = dynamic(() => import('./CharacterPreview'), {
  ssr: false,
  loading: () => <p className={styles.previewLoading}>Loading preview…</p>,
});

export type { ContentChoices } from './QuestionPoolFields';

export interface SaveMessage {
  kind: 'saved' | 'error' | 'conflict';
  text: string;
}

interface Props {
  spec: SectionSpec;
  record: Versioned<unknown>;
  defaults: Record<string, unknown>;
  draft: SectionDraft | undefined;
  worlds: WorldDto[];
  content: ContentChoices;
  issues: FieldIssues;
  message: SaveMessage | null;
  saving: boolean;
  dirty: boolean;
  onDraft: (draft: SectionDraft) => void;
  onDiscard: () => void;
  onSave: () => void;
  onReloadLatest: () => void;
}

const formatValue = (field: FieldSpec, value: unknown, worlds: WorldDto[], content: ContentChoices): string => {
  if (field.kind === 'boolean') return value ? 'on' : 'off';
  if (isIdList(field.kind)) {
    const choices = content[field.kind];
    const ids = value as string[];
    return ids.length === 0 ? 'all' : ids.map((id) => choices.find((c) => c.id === id)?.label ?? id).join(', ');
  }
  if (field.kind === 'colors') return `${(value as string[]).length} colours`;
  if (field.kind === 'choice') return field.choices?.find((c) => c.value === value)?.label ?? String(value);
  if (field.kind === 'range') return `${(value as number[])[0]}–${(value as number[])[1]}`;
  if (field.kind === 'world') return worlds.find((w) => w.id === value)?.name ?? String(value);
  return String(value);
};

export function SectionEditor({ spec, record, defaults, draft, worlds, content, issues, message, saving, dirty, onDraft, onDiscard, onSave, onReloadLatest }: Props) {
  const saved = record.value as Record<string, unknown>;
  const current = draft ?? toDraft(spec, saved);
  const currentValue = fromDraft(spec, current);
  const atDefaults = sameValue(currentValue, fromDraft(spec, toDraft(spec, defaults)));
  const set = (key: string, value: DraftValue) => onDraft({ ...current, [key]: value });

  let lastGroup: string | undefined;
  return (
    <form
      className={styles.section}
      // The contracts schemas validate (with clearer messages); native min/step checks would block saving silently.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave();
      }}
    >
      <header className={styles.sectionHeader}>
        <div>
          <h1>{spec.title}</h1>
          <p>{spec.summary}</p>
        </div>
        <p className={styles.version} title={`Last saved ${new Date(record.updatedAt).toLocaleString()}`}>
          Version {record.version}
        </p>
      </header>

      {spec.note && <p className={styles.note}>{spec.note}</p>}

      {spec.id === 'appearance' && (
        <figure className={styles.preview}>
          <div className={styles.previewCanvas}>
            {/* Shows the draft while it is valid, so changes can be judged before saving. */}
            <CharacterPreview appearance={(Object.keys(validateSection(spec.id, currentValue)).length === 0 ? currentValue : saved) as unknown as AppearanceSettings} />
          </div>
          <figcaption>Preview: running, throwing, being hit, frozen, knocked out and respawning, and a bot. Unsaved changes show here first.</figcaption>
        </figure>
      )}

      <div className={styles.fields}>
        {spec.fields.map((field) => {
          const heading = field.group && field.group !== lastGroup ? field.group : null;
          lastGroup = field.group;
          const id = `${spec.id}-${field.key}`;
          const changed = !sameValue(currentValue[field.key], saved[field.key]);
          const issue = issues[field.key];
          return (
            <Fragment key={field.key}>
              {heading && <h2 className={styles.fieldGroup}>{heading}</h2>}
              <div className={styles.field} data-changed={changed || undefined} data-invalid={issue ? true : undefined}>
                <div className={styles.fieldText}>
                  <label htmlFor={id}>{field.label}</label>
                  <p id={`${id}-help`}>{field.help}</p>
                </div>
                <div className={styles.fieldControl}>
                  <FieldInput id={id} field={field} value={current[field.key]!} worlds={worlds} content={content} invalid={Boolean(issue)} onChange={(v) => set(field.key, v)} />
                  <p className={styles.fieldMeta}>
                    {issue ? (
                      <span className={styles.errorText} role="alert">
                        {issue}
                      </span>
                    ) : changed ? (
                      <>Saved: {formatValue(field, saved[field.key], worlds, content)}</>
                    ) : (
                      <>Default: {formatValue(field, defaults[field.key], worlds, content)}</>
                    )}
                  </p>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <footer className={styles.saveBar} data-visible={dirty || message !== null || undefined}>
        <div className={styles.saveStatus} role="status">
          {message ? (
            <span className={message.kind === 'saved' ? styles.okText : styles.errorText}>{message.text}</span>
          ) : dirty ? (
            'Unsaved changes'
          ) : null}
          {message?.kind === 'conflict' && (
            <button type="button" className={styles.linkButton} onClick={onReloadLatest}>
              Load the latest version
            </button>
          )}
        </div>
        <div className={styles.saveActions}>
          <button type="button" className={styles.secondary} disabled={atDefaults} onClick={() => onDraft(toDraft(spec, defaults))}>
            Use defaults
          </button>
          <button type="button" className={styles.secondary} disabled={!draft} onClick={onDiscard}>
            Discard changes
          </button>
          <button type="submit" className={styles.primary} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </footer>
    </form>
  );
}

function FieldInput({
  id,
  field,
  value,
  worlds,
  content,
  invalid,
  onChange,
}: {
  id: string;
  field: FieldSpec;
  value: DraftValue;
  worlds: WorldDto[];
  content: ContentChoices;
  invalid: boolean;
  onChange: (value: DraftValue) => void;
}) {
  const common = { 'aria-describedby': `${id}-help`, 'aria-invalid': invalid || undefined };
  // No min/max attributes: they would make the spinner step from min (1, 501, 1001…) instead of the value.
  const numberProps = { type: 'number', inputMode: 'decimal' as const, step: field.step ?? (field.kind === 'integer' ? 1 : 'any') };

  if (field.kind === 'boolean') {
    return (
      <label className={styles.toggle}>
        <input id={id} type="checkbox" role="switch" checked={value as boolean} onChange={(e) => onChange(e.target.checked)} {...common} />
        <span>{value ? 'On' : 'Off'}</span>
      </label>
    );
  }
  if (field.kind === 'colors') {
    const colors = value as string[];
    return (
      <div className={styles.palette} role="group" aria-label={field.label} aria-describedby={`${id}-help`}>
        {colors.map((c, i) => (
          <span key={i} className={styles.swatch}>
            <input id={i === 0 ? id : undefined} type="color" value={c} aria-label={`Colour ${i + 1}`} onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" aria-label={`Remove colour ${i + 1}`} disabled={colors.length <= 4} onClick={() => onChange(colors.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        {colors.length < 12 && (
          <button type="button" className={styles.secondary} onClick={() => onChange([...colors, '#ffffff'])}>
            Add colour
          </button>
        )}
      </div>
    );
  }
  if (isIdList(field.kind)) {
    return <PickList id={id} label={field.label} choices={content[field.kind]} picked={value as string[]} onChange={onChange} />;
  }
  if (field.kind === 'choice') {
    return (
      <select id={id} className={styles.input} value={value as string} onChange={(e) => onChange(e.target.value)} {...common}>
        {field.choices?.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'world') {
    return (
      <select id={id} className={styles.input} value={value as string} onChange={(e) => onChange(e.target.value)} {...common}>
        {worlds.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'range') {
    const [min, max] = value as [string, string];
    return (
      <div className={styles.rangeInputs}>
        <input id={id} className={styles.input} aria-label={`${field.label}, from`} value={min} onChange={(e) => onChange([e.target.value, max])} {...numberProps} {...common} />
        <span aria-hidden="true">to</span>
        <input className={styles.input} aria-label={`${field.label}, to`} value={max} onChange={(e) => onChange([min, e.target.value])} {...numberProps} {...common} />
        {field.unit && <span className={styles.unit}>{field.unit}</span>}
      </div>
    );
  }
  return (
    <div className={styles.numberInput}>
      <input id={id} className={styles.input} value={value as string} onChange={(e) => onChange(e.target.value)} {...numberProps} {...common} />
      {field.unit && <span className={styles.unit}>{field.unit}</span>}
    </div>
  );
}
