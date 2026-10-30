'use client';

import { CONTENT_TEXT } from '@volleyland/contracts';
import { useMemo, useState } from 'react';
import { type AdminApi, AdminApiError, type AdminContent, type ContentRecord } from '../api';
import styles from '../admin.module.css';
import { type ContentField, type Draft, type TaxonomyKind, fieldsOf, fromDraft, issuesFrom, labeller, toDraft, validate } from './content-model';

interface Props {
  kind: TaxonomyKind;
  api: AdminApi;
  data: AdminContent;
  /** Reload the bank after a save, so every page sees the change. */
  onSaved: () => Promise<void>;
}

type Selection = { mode: 'new' } | { mode: 'edit'; id: string } | null;

/**
 * List, create, edit and delete one kind of taxonomy record (countries, curricula, levels,
 * subjects, topics, sources). Every save runs the same operation an MCP client would.
 */
export function RecordEditor({ kind, api, data, onSaved }: Props) {
  const { title, singular, summary } = CONTENT_TEXT[kind];
  const fields = useMemo(() => fieldsOf(kind), [kind]);
  const { label } = useMemo(() => labeller(data), [data]);
  const records = data[kind] as ContentRecord[];
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const record = selection?.mode === 'edit' ? records.find((r) => r.value.id === selection.id) ?? null : null;
  const saved = useMemo(() => toDraft(kind, (record?.value as Record<string, unknown>) ?? null), [kind, record]);
  const current = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  // The columns: the name, then whatever it belongs to.
  const columns = fields.filter((f) => f.input === 'ref' || f.key === 'name' || f.key === 'title' || f.key === 'publisher');

  const select = (next: Selection) => {
    if (dirty) {
      setMessage({ kind: 'error', text: 'Save or discard your changes first.' });
      return;
    }
    setSelection(next);
    setDraft(null);
    setIssues({});
    setMessage(null);
    setConfirmDelete(false);
  };

  const fail = (error: unknown) => {
    const body = error instanceof AdminApiError ? error.body : null;
    setIssues(issuesFrom(body?.issues));
    setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
  };

  const save = async () => {
    const value = fromDraft(kind, current);
    const local = validate(kind, value);
    if (Object.keys(local).length > 0) {
      setIssues(local);
      setMessage({ kind: 'error', text: 'Fix the highlighted fields, then save again.' });
      return;
    }
    setBusy(true);
    try {
      if (selection?.mode === 'new') {
        await api.createContent(kind, value);
      } else if (record) {
        const { id: _id, ...changes } = value;
        await api.updateContent(kind, record.value.id, changes, record.version);
      }
      await onSaved();
      setSelection({ mode: 'edit', id: value.id as string });
      setDraft(null);
      setIssues({});
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    setBusy(true);
    try {
      await api.deleteContent(kind, record.value.id, record.version);
      await onSaved();
      setSelection(null);
      setDraft(null);
      setMessage(null);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h1>{title}</h1>
          <p>{summary}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primary} onClick={() => select({ mode: 'new' })}>
            New {singular}
          </button>
        </div>
      </header>

      <div className={styles.contentLayout}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
                <th scope="col">ID</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const value = r.value as Record<string, unknown>;
                return (
                  <tr key={r.value.id} aria-selected={selection?.mode === 'edit' && selection.id === r.value.id}>
                    {columns.map((c, i) => {
                      const text = c.refKind ? label(c.refKind, String(value[c.key])) : String(value[c.key] ?? '');
                      return (
                        <td key={c.key}>
                          {i === 0 ? (
                            <button type="button" className={styles.rowButton} onClick={() => select({ mode: 'edit', id: r.value.id })}>
                              {text}
                            </button>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <code>{r.value.id}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {records.length === 0 && <p className={styles.empty}>No {title.toLowerCase()} yet.</p>}
        </div>

        {selection && (
          <form
            className={styles.recordForm}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2>
              {selection.mode === 'new' ? `New ${singular}` : label(kind, record?.value.id ?? '')}
              {record && <span className={styles.version}>Version {record.version}</span>}
            </h2>
            {fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={current[field.key] ?? ''}
                issue={issues[field.key]}
                readOnly={field.input === 'id' && selection.mode === 'edit'}
                data={data}
                onChange={(v) => {
                  setDraft({ ...current, [field.key]: v });
                  setMessage(null);
                }}
              />
            ))}
            <p className={message?.kind === 'ok' ? styles.okText : styles.errorText} role="status">
              {message?.text ?? (dirty ? 'Unsaved changes' : '')}
            </p>
            <div className={styles.saveActions}>
              {record &&
                (confirmDelete ? (
                  <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>
                    Delete for good
                  </button>
                ) : (
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(true)}>
                    Delete…
                  </button>
                ))}
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setIssues({});
                  setMessage(null);
                  if (selection.mode === 'new') setSelection(null);
                }}
              >
                {selection.mode === 'new' ? 'Cancel' : 'Discard changes'}
              </button>
              <button type="submit" className={styles.primary} disabled={busy || (selection.mode === 'edit' && !dirty)}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function FieldRow({
  field,
  value,
  issue,
  readOnly,
  data,
  onChange,
}: {
  field: ContentField;
  value: string;
  issue: string | undefined;
  readOnly: boolean;
  data: AdminContent;
  onChange: (value: string) => void;
}) {
  const id = `content-${field.key}`;
  const { label } = labeller(data);
  const common = { id, className: styles.input, 'aria-invalid': issue ? true : undefined, 'aria-describedby': `${id}-help` };
  return (
    <div className={styles.formRow} data-invalid={issue ? true : undefined}>
      <label htmlFor={id}>
        {field.label}
        {field.unit && <span className={styles.unit}> ({field.unit})</span>}
      </label>
      {field.input === 'ref' && field.refKind ? (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(data[field.refKind as TaxonomyKind] as ContentRecord[]).map((r) => (
            <option key={r.value.id} value={r.value.id}>
              {label(field.refKind!, r.value.id)}
            </option>
          ))}
        </select>
      ) : field.input === 'textarea' ? (
        <textarea {...common} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          value={value}
          readOnly={readOnly}
          inputMode={field.input === 'integer' || field.input === 'year' ? 'numeric' : undefined}
          placeholder={field.input === 'ages' ? '15–16' : field.input === 'url' ? 'https://' : field.input === 'year' ? 'none' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p id={`${id}-help`} className={styles.fieldMeta}>
        {issue ? <span className={styles.errorText}>{issue}</span> : field.help}
      </p>
    </div>
  );
}
