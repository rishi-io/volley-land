'use client';

import { CONTENT_LIMITS, CONTENT_TEXT, QuestionStatusSchema, SourceUseSchema } from '@volleyland/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AdminApi, AdminApiError, type AdminContent, type AuthoredQuestionDto, AuthoredQuestionDtoSchema, type ImportReport, type QuestionFilter, type QuestionPage } from '../api';
import styles from '../admin.module.css';
import { issuesFrom, labeller, questionText } from './content-model';

interface Props {
  api: AdminApi;
  data: AdminContent;
}

type Versioned = QuestionPage['questions'][number];
type Selection = { mode: 'new' } | { mode: 'edit'; id: string } | null;

/** Question text while it is edited: difficulty stays text until it is saved. */
interface QuestionDraft extends Omit<AuthoredQuestionDto, 'difficulty'> {
  difficulty: string;
}

const STATUS_LABEL: Record<AuthoredQuestionDto['status'], string> = { draft: 'Draft', published: 'Published', retired: 'Retired' };
const USE_LABEL: Record<AuthoredQuestionDto['source']['use'], string> = { copied: 'Copied word for word', adapted: 'Adapted', aligned: 'Written to match' };
const OPTION_IDS = 'abcdefgh';

const blank = (data: AdminContent, filter: QuestionFilter): QuestionDraft => ({
  id: '',
  topicId: filter.topicId ?? '',
  difficulty: '2',
  status: 'draft',
  prompt: '',
  options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '' })),
  correctOptionId: 'a',
  explanation: '',
  source: { sourceId: filter.sourceId ?? data.sources[0]?.value.id ?? '', use: 'aligned', reference: '' },
});

const toDraft = (q: AuthoredQuestionDto): QuestionDraft => ({ ...structuredClone(q), difficulty: String(q.difficulty) });
const fromDraft = (d: QuestionDraft): AuthoredQuestionDto => ({ ...d, difficulty: d.difficulty.trim() === '' ? Number.NaN : Number(d.difficulty) });

/** Local checks before saving, from the same schema plus the one rule across fields; the server checks everything again. */
function validate(question: AuthoredQuestionDto, isNew: boolean): Record<string, string> {
  const result = AuthoredQuestionDtoSchema.safeParse(isNew && question.id === '' ? { ...question, id: 'q-new' } : question);
  const issues: Record<string, string> = {};
  if (!result.success) for (const issue of result.error.issues) issues[issue.path.map(String).join('.')] ??= issue.message;
  if (!question.options.some((o) => o.id === question.correctOptionId)) issues.correctOptionId ??= 'pick the correct option';
  return issues;
}

/**
 * Questions: find them by country, curriculum, class or year, subject, status and text (the
 * server's list_questions does the filtering, as it does for MCP clients), then write, publish,
 * retire, duplicate, delete or import them.
 */
export function QuestionsEditor({ api, data }: Props) {
  const { label } = useMemo(() => labeller(data), [data]);
  const [filter, setFilter] = useState<QuestionFilter>({});
  const [page, setPage] = useState<QuestionPage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setPage(await api.questions(filter));
      setListError(null);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, [api, filter]);

  useEffect(() => {
    // Typing in the search box waits for a pause before asking the server.
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  const record: Versioned | null = selection?.mode === 'edit' ? (page?.questions.find((q) => q.value.id === selection.id) ?? null) : null;
  const saved = useMemo(() => (record ? toDraft(record.value) : null), [record]);
  const current = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const select = (next: Selection, start: QuestionDraft | null = null) => {
    if (dirty) {
      setMessage({ kind: 'error', text: 'Save or discard your changes first.' });
      return;
    }
    setSelection(next);
    setDraft(start);
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
    if (!current) return;
    const question = fromDraft(current);
    const isNew = selection?.mode === 'new';
    const local = validate(question, isNew);
    if (Object.keys(local).length > 0) {
      setIssues(local);
      setMessage({ kind: 'error', text: 'Fix the highlighted fields, then save again.' });
      return;
    }
    setBusy(true);
    try {
      const { id, ...changes } = question;
      const result = isNew
        ? await api.createContent('questions', id === '' ? changes : question)
        : await api.updateContent('questions', record!.value.id, changes, record!.version);
      await load();
      setSelection({ mode: 'edit', id: (result.value as { id: string }).id });
      setDraft(null);
      setIssues({});
      setMessage({ kind: 'ok', text: question.status === 'published' ? 'Saved. Matches ask it from the next hit on.' : 'Saved.' });
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
      await api.deleteContent('questions', record.value.id, record.version);
      await load();
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

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) => {
    if (!current) return;
    setDraft({ ...current, [key]: value });
    setMessage(null);
  };

  // Pickers narrow each other: a curriculum's levels, a country's curricula.
  const curricula = data.curricula.filter((c) => !filter.countryId || c.value.countryId === filter.countryId);
  const levels = data.levels.filter((l) => !filter.curriculumId || l.value.curriculumId === filter.curriculumId).filter((l) => curricula.some((c) => c.value.id === l.value.curriculumId));
  const setFilterKey = (key: keyof QuestionFilter, value: string) => {
    const next: QuestionFilter = { ...filter, [key]: value || undefined };
    if (key === 'countryId') next.curriculumId = next.levelId = undefined;
    if (key === 'curriculumId') next.levelId = undefined;
    setFilter(next);
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h1>{CONTENT_TEXT.questions.title}</h1>
          <p>{CONTENT_TEXT.questions.summary} Only published questions are asked; rooms ask from the pool set under Questions asked.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondary} aria-pressed={importing} onClick={() => setImporting(!importing)}>
            Import…
          </button>
          <button type="button" className={styles.primary} onClick={() => select({ mode: 'new' }, blank(data, filter))}>
            New question
          </button>
        </div>
      </header>

      {importing && <ImportPanel api={api} onImported={() => void load()} />}

      <div className={styles.filters} role="search">
        <FilterSelect label="Country" value={filter.countryId} options={data.countries.map((c) => [c.value.id, c.value.name])} onChange={(v) => setFilterKey('countryId', v)} />
        <FilterSelect label="Curriculum" value={filter.curriculumId} options={curricula.map((c) => [c.value.id, c.value.name])} onChange={(v) => setFilterKey('curriculumId', v)} />
        <FilterSelect label="Class or year" value={filter.levelId} options={levels.map((l) => [l.value.id, label('levels', l.value.id)])} onChange={(v) => setFilterKey('levelId', v)} />
        <FilterSelect label="Subject" value={filter.subjectId} options={data.subjects.map((s) => [s.value.id, s.value.name])} onChange={(v) => setFilterKey('subjectId', v)} />
        <FilterSelect label="Source" value={filter.sourceId} options={data.sources.map((s) => [s.value.id, s.value.title])} onChange={(v) => setFilterKey('sourceId', v)} />
        <FilterSelect label="Status" value={filter.status} options={QuestionStatusSchema.options.map((s) => [s, STATUS_LABEL[s]])} onChange={(v) => setFilterKey('status', v)} />
        <label className={styles.filterField}>
          <span>Search</span>
          <input className={styles.input} type="search" value={filter.text ?? ''} placeholder="Words in the question" onChange={(e) => setFilterKey('text', e.target.value)} />
        </label>
      </div>

      <div className={styles.contentLayout}>
        <div className={styles.tableWrap}>
          {listError && <p className={styles.errorText}>{listError}</p>}
          {page && (
            <p className={styles.fieldMeta}>
              {page.total === page.questions.length ? `${page.total} questions` : `Showing ${page.questions.length} of ${page.total} questions; narrow the filters to see the rest`}
            </p>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Topic</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {page?.questions.map(({ value: q }) => (
                <tr key={q.id} aria-selected={selection?.mode === 'edit' && selection.id === q.id}>
                  <td>
                    <button type="button" className={styles.rowButton} onClick={() => select({ mode: 'edit', id: q.id })}>
                      {q.prompt}
                    </button>
                  </td>
                  <td>{label('topics', q.topicId)}</td>
                  <td>{q.difficulty}</td>
                  <td>
                    <span className={styles.status} data-status={q.status}>
                      {STATUS_LABEL[q.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {page?.total === 0 && <p className={styles.empty}>No questions match.</p>}
        </div>

        {selection && current && (
          <form
            className={styles.recordForm}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2>
              {selection.mode === 'new' ? 'New question' : <code>{current.id}</code>}
              {record && <span className={styles.version}>Version {record.version}</span>}
            </h2>

            <Row k="topicId" issues={issues}>
              <select id="q-topicId" className={styles.input} value={current.topicId} onChange={(e) => set('topicId', e.target.value)}>
                <option value="">Choose…</option>
                {data.levels.map((l) => (
                  <optgroup key={l.value.id} label={label('levels', l.value.id)}>
                    {data.topics
                      .filter((t) => t.value.levelId === l.value.id)
                      .map((t) => (
                        <option key={t.value.id} value={t.value.id}>
                          {label('subjects', t.value.subjectId)}: {t.value.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </Row>
            <div className={styles.formPair}>
              <Row k="difficulty" issues={issues}>
                <select id="q-difficulty" className={styles.input} value={current.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
                  {[1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={String(d)}>
                      {d}
                    </option>
                  ))}
                </select>
              </Row>
              <Row k="status" issues={issues}>
                <select id="q-status" className={styles.input} value={current.status} onChange={(e) => set('status', e.target.value as QuestionDraft['status'])}>
                  {QuestionStatusSchema.options.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Row>
            </div>
            <Row k="prompt" issues={issues}>
              <textarea id="q-prompt" className={styles.input} rows={3} value={current.prompt} onChange={(e) => set('prompt', e.target.value)} />
            </Row>

            <fieldset className={styles.optionList} data-invalid={issues.options || issues.correctOptionId ? true : undefined}>
              <legend>{questionText('options').title}</legend>
              <p className={styles.fieldMeta}>Mark the correct one. {questionText('options').description}</p>
              {current.options.map((option, i) => (
                <div key={option.id} className={styles.optionRow}>
                  <input
                    type="radio"
                    name="correct"
                    aria-label={`Option ${option.id} is correct`}
                    checked={current.correctOptionId === option.id}
                    onChange={() => set('correctOptionId', option.id)}
                  />
                  <code>{option.id}</code>
                  <input
                    className={styles.input}
                    aria-label={`Option ${option.id}`}
                    aria-invalid={issues[`options.${i}.text`] ? true : undefined}
                    value={option.text}
                    onChange={(e) => set('options', current.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)))}
                  />
                  <button
                    type="button"
                    className={styles.secondary}
                    aria-label={`Remove option ${option.id}`}
                    disabled={current.options.length <= CONTENT_LIMITS.minOptions}
                    onClick={() => {
                      const options = current.options.filter((_, j) => j !== i);
                      setDraft({ ...current, options, correctOptionId: current.correctOptionId === option.id ? options[0]!.id : current.correctOptionId });
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {current.options.length < CONTENT_LIMITS.maxOptions && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => set('options', [...current.options, { id: [...OPTION_IDS].find((c) => !current.options.some((o) => o.id === c))!, text: '' }])}
                >
                  Add option
                </button>
              )}
              {(issues.options || issues.correctOptionId) && <p className={styles.errorText}>{issues.options ?? issues.correctOptionId}</p>}
            </fieldset>

            <Row k="explanation" issues={issues}>
              <textarea id="q-explanation" className={styles.input} rows={3} value={current.explanation} onChange={(e) => set('explanation', e.target.value)} />
            </Row>

            <fieldset className={styles.optionList}>
              <legend>Source</legend>
              <Row k="source.sourceId" issues={issues}>
                <select id="q-source.sourceId" className={styles.input} value={current.source.sourceId} onChange={(e) => set('source', { ...current.source, sourceId: e.target.value })}>
                  <option value="">Choose…</option>
                  {data.sources.map((s) => (
                    <option key={s.value.id} value={s.value.id}>
                      {s.value.title} ({s.value.publisher})
                    </option>
                  ))}
                </select>
              </Row>
              <div className={styles.formPair}>
                <Row k="source.use" issues={issues}>
                  <select id="q-source.use" className={styles.input} value={current.source.use} onChange={(e) => set('source', { ...current.source, use: e.target.value as QuestionDraft['source']['use'] })}>
                    {SourceUseSchema.options.map((u) => (
                      <option key={u} value={u}>
                        {USE_LABEL[u]}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row k="source.reference" issues={issues}>
                  <input id="q-source.reference" className={styles.input} value={current.source.reference} onChange={(e) => set('source', { ...current.source, reference: e.target.value })} />
                </Row>
              </div>
              {(() => {
                const source = data.sources.find((s) => s.value.id === current.source.sourceId)?.value;
                return source ? (
                  <p className={styles.fieldMeta}>
                    Licence: {source.licence || 'not recorded'}
                    {source.url && (
                      <>
                        {' · '}
                        <a href={source.url} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      </>
                    )}
                  </p>
                ) : null;
              })()}
            </fieldset>

            <p className={message?.kind === 'ok' ? styles.okText : styles.errorText} role="status">
              {message?.text ?? (dirty ? 'Unsaved changes' : '')}
            </p>
            <div className={styles.saveActions}>
              {record && (
                <>
                  {confirmDelete ? (
                    <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>
                      Delete for good
                    </button>
                  ) : (
                    <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(true)}>
                      Delete…
                    </button>
                  )}
                  <button type="button" className={styles.secondary} disabled={busy || dirty} onClick={() => select({ mode: 'new' }, { ...toDraft(record.value), id: '', status: 'draft' })}>
                    Duplicate
                  </button>
                </>
              )}
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

/** One labelled question field, with its words from contracts and its issue if any. */
function Row({ k, issues, children }: { k: string; issues: Record<string, string>; children: React.ReactNode }) {
  const text = questionText(k);
  const issue = issues[k];
  return (
    <div className={styles.formRow} data-invalid={issue ? true : undefined}>
      <label htmlFor={`q-${k}`}>{text.title}</label>
      {children}
      <p className={styles.fieldMeta}>{issue ? <span className={styles.errorText}>{issue}</span> : text.description}</p>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string | undefined; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <label className={styles.filterField}>
      <span>{label}</span>
      <select className={styles.input} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Paste a JSON list of questions (as get_question returns them, with answer keys), check it, then import it all or nothing. */
function ImportPanel({ api, onImported }: { api: AdminApi; onImported: () => void }) {
  const [text, setText] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    let questions: unknown;
    try {
      questions = JSON.parse(text);
    } catch (e) {
      setError(`Not JSON: ${(e as Error).message}`);
      return;
    }
    if (!Array.isArray(questions)) {
      setError('Paste a JSON list: [ { "id": …, "topicId": …, … }, … ]');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.importQuestions(questions, dryRun);
      setReport(result);
      if (!dryRun) {
        onImported();
        setText('');
      }
    } catch (e) {
      const body = e instanceof AdminApiError ? e.body : null;
      setReport(body?.issues ? { dryRun, valid: false, issues: body.issues, ids: [] } : null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.importPanel}>
      <label htmlFor="import-json">
        <strong>Import questions</strong> (up to {CONTENT_LIMITS.maxImport}, all or nothing). Each needs id, topicId, difficulty, status, prompt, options, correctOptionId, explanation and source
        (sourceId, use, reference). Create the source and topics first.
      </label>
      <textarea id="import-json" className={styles.input} rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{ "id": "q-…", "topicId": "…", … }]' />
      <div className={styles.saveActions}>
        <button type="button" className={styles.secondary} disabled={busy || !text.trim()} onClick={() => void run(true)}>
          Check
        </button>
        <button type="button" className={styles.primary} disabled={busy || !text.trim()} onClick={() => void run(false)}>
          Import
        </button>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      {report &&
        (report.valid ? (
          <p className={styles.okText}>
            {report.dryRun ? `All ${report.ids.length} questions can be imported.` : `Imported ${report.ids.length} questions.`}
          </p>
        ) : (
          <ul className={styles.issueList}>
            {report.issues.slice(0, 50).map((issue) => {
              // Paths start at the question's position (the operation's own check prefixes "questions.").
              const [index, ...rest] = issue.path.replace(/^questions\./, '').split('.');
              return (
                <li key={`${issue.path}:${issue.message}`}>
                  {Number.isInteger(Number(index)) ? `Question ${Number(index) + 1}` : 'The list'}
                  {rest.length > 0 && (
                    <>
                      , <code>{rest.join('.')}</code>
                    </>
                  )}
                  : {issue.message}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
