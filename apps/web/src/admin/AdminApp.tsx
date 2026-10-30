'use client';

import type { ContentKind, SettingsSection, Versioned } from '@volleyland/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AdminContent, AdminApiError, type AdminSettingsResponse, createAdminApi } from './api';
import { SECTIONS, sectionSpec } from './catalog';
import { NAV_KINDS, kindTitle, labeller } from './content/content-model';
import { QuestionsEditor } from './content/QuestionsEditor';
import { RecordEditor } from './content/RecordEditor';
import { type FieldIssues, type SectionDraft, fromDraft, sameValue, validateSection } from './form';
import { type ContentChoices, SectionEditor, type SaveMessage } from './SectionEditor';
import { WorldBuilder } from './world/WorldBuilder';
import styles from './admin.module.css';

/** A question bank page is `bank-<kind>` (the settings section "questions" is a different page). */
type BankView = `bank-${ContentKind}`;
type View = SettingsSection | 'worlds' | BankView;
const TOKEN_KEY = 'volleyland.adminToken';
const VIEWS: View[] = [...SECTIONS.map((s) => s.id), 'worlds', ...NAV_KINDS.map((k): BankView => `bank-${k}`)];
const bankKind = (view: View): ContentKind | null => (view.startsWith('bank-') ? (view.slice(5) as ContentKind) : null);

const readToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lasts only for this page.
  }
};
const viewFromHash = (): View => {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (VIEWS as string[]).includes(hash) ? (hash as View) : 'combat';
};

export function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenRead, setTokenRead] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'needs-token' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<AdminSettingsResponse | null>(null);
  const [content, setContent] = useState<AdminContent | null>(null);
  const [view, setView] = useState<View>('combat');
  const [drafts, setDrafts] = useState<Partial<Record<SettingsSection, SectionDraft>>>({});
  const [serverIssues, setServerIssues] = useState<Partial<Record<SettingsSection, FieldIssues>>>({});
  const [messages, setMessages] = useState<Partial<Record<SettingsSection, SaveMessage>>>({});
  const [saving, setSaving] = useState<SettingsSection | null>(null);
  const [worldsDirty, setWorldsDirty] = useState(false);

  const api = useMemo(() => createAdminApi(token), [token]);

  const load = useCallback(async () => {
    try {
      const [settings, bank] = await Promise.all([api.settings(), api.content()]);
      setData(settings);
      setContent(bank);
      setState('ready');
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        setState('needs-token');
        return;
      }
      setLoadError(error instanceof Error ? error.message : String(error));
      setState('error');
    }
  }, [api]);

  useEffect(() => {
    setToken(readToken());
    setTokenRead(true);
    setView(viewFromHash());
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (tokenRead) void load();
  }, [load, tokenRead]);

  const dirtySections = useMemo(() => {
    const dirty = new Set<SettingsSection>();
    if (!data) return dirty;
    for (const spec of SECTIONS) {
      const draft = drafts[spec.id];
      if (draft && !sameValue(fromDraft(spec, draft), data.sections[spec.id].value)) dirty.add(spec.id);
    }
    return dirty;
  }, [data, drafts]);

  const save = async (section: SettingsSection) => {
    if (!data) return;
    const spec = sectionSpec(section);
    const value = fromDraft(spec, drafts[section]!);
    const local = validateSection(section, value);
    if (Object.keys(local).length > 0) {
      setServerIssues((s) => ({ ...s, [section]: local }));
      setMessages((m) => ({ ...m, [section]: { kind: 'error', text: 'Fix the highlighted fields, then save again.' } }));
      return;
    }
    setSaving(section);
    try {
      const saved = (await api.updateSection(section, value as never, data.sections[section].version)) as Versioned<never>;
      setData((d) => (d ? { ...d, sections: { ...d.sections, [section]: saved } } : d));
      setDrafts((d) => ({ ...d, [section]: undefined }));
      setServerIssues((s) => ({ ...s, [section]: undefined }));
      setMessages((m) => ({ ...m, [section]: { kind: 'saved', text: `Saved as version ${saved.version}. Matches that start from now on use it.` } }));
    } catch (error) {
      const body = error instanceof AdminApiError ? error.body : null;
      const issues: FieldIssues = {};
      for (const issue of body?.issues ?? []) issues[issue.path.split('.')[0]!] ??= issue.message;
      setServerIssues((s) => ({ ...s, [section]: issues }));
      const conflict = error instanceof AdminApiError && error.status === 409;
      setMessages((m) => ({
        ...m,
        [section]: { kind: conflict ? 'conflict' : 'error', text: error instanceof Error ? error.message : String(error) },
      }));
    } finally {
      setSaving(null);
    }
  };

  const go = (next: View) => {
    window.location.hash = next;
    setView(next);
  };

  if (state === 'needs-token') {
    return (
      <TokenGate
        rejected={token !== null}
        onSubmit={(t) => {
          writeToken(t);
          setState('loading');
          setToken(t);
        }}
      />
    );
  }

  const reloadContent = async () => setContent(await api.content());

  if (state === 'loading' || !data || !content) {
    return (
      <main className={styles.centered}>
        {state === 'error' ? (
          <div className={styles.gate}>
            <h1>Could not load settings</h1>
            <p>{loadError}</p>
            <button type="button" className={styles.primary} onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <p>Loading settings…</p>
        )}
      </main>
    );
  }

  const kind = bankKind(view);
  const activeSpec = view === 'worlds' || kind ? null : sectionSpec(view as SettingsSection);
  const { label } = labeller(content);
  const choices: ContentChoices = {
    curricula: content.curricula.map((c) => ({ id: c.value.id, label: c.value.name })),
    levels: content.levels.map((l) => ({ id: l.value.id, label: label('levels', l.value.id) })),
    subjects: content.subjects.map((s) => ({ id: s.value.id, label: s.value.name })),
  };
  const nav = (group: string) => SECTIONS.filter((s) => s.nav === group);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <strong>Volleyland</strong>
          <span>Admin</span>
        </div>
        <nav aria-label="Settings sections">
          {(['Game rules', 'Rooms and bots', 'Look and feel'] as const).map((group) => (
            <div key={group} className={styles.navGroup}>
              <h2>{group}</h2>
              <ul>
                {nav(group).map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} aria-current={view === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
                      {s.title}
                      {dirtySections.has(s.id) && <span className={styles.dirtyDot} title="Unsaved changes" />}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className={styles.navGroup}>
            <h2>Question bank</h2>
            <ul>
              {NAV_KINDS.map((k) => (
                <li key={k}>
                  <a href={`#bank-${k}`} aria-current={view === `bank-${k}` ? 'page' : undefined} onClick={() => go(`bank-${k}`)}>
                    {kindTitle(k)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.navGroup}>
            <h2>World builder</h2>
            <ul>
              <li>
                <a href="#worlds" aria-current={view === 'worlds' ? 'page' : undefined} onClick={() => go('worlds')}>
                  Worlds
                  {worldsDirty && <span className={styles.dirtyDot} title="Unsaved changes" />}
                </a>
              </li>
            </ul>
          </div>
        </nav>
        <p className={styles.sideNote}>
          Room <code>{data.devRoomCode}</code> picks up saved changes the next time it opens, after everyone has left.
        </p>
        {token && (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              writeToken(null);
              setToken(null);
              setState('needs-token');
            }}
          >
            Forget admin token
          </button>
        )}
      </aside>

      <main className={styles.main}>
        {activeSpec && (
          <SectionEditor
            key={activeSpec.id}
            spec={activeSpec}
            record={data.sections[activeSpec.id]}
            defaults={data.defaults[activeSpec.id] as Record<string, unknown>}
            draft={drafts[activeSpec.id]}
            worlds={data.worlds.map((w) => w.value)}
            content={choices}
            issues={serverIssues[activeSpec.id] ?? {}}
            message={messages[activeSpec.id] ?? null}
            saving={saving === activeSpec.id}
            dirty={dirtySections.has(activeSpec.id)}
            onDraft={(draft) => {
              setDrafts((d) => ({ ...d, [activeSpec.id]: draft }));
              setMessages((m) => ({ ...m, [activeSpec.id]: undefined }));
            }}
            onDiscard={() => {
              setDrafts((d) => ({ ...d, [activeSpec.id]: undefined }));
              setServerIssues((s) => ({ ...s, [activeSpec.id]: undefined }));
              setMessages((m) => ({ ...m, [activeSpec.id]: undefined }));
            }}
            onSave={() => void save(activeSpec.id)}
            onReloadLatest={() => void load()}
          />
        )}
        {kind === 'questions' && <QuestionsEditor api={api} data={content} />}
        {kind && kind !== 'questions' && <RecordEditor key={kind} kind={kind} api={api} data={content} onSaved={reloadContent} />}
        {view === 'worlds' && (
          <WorldBuilder
            api={api}
            worlds={data.worlds}
            rooms={data.sections.rooms}
            movement={data.sections.movement.value}
            projectiles={data.sections.projectiles.value}
            appearance={data.sections.appearance.value}
            roomQuestions={data.sections.questions.value}
            content={choices}
            devRoomCode={data.devRoomCode}
            onDirtyChange={setWorldsDirty}
            onWorlds={(worlds) => setData((d) => (d ? { ...d, worlds } : d))}
            onRooms={(rooms) => setData((d) => (d ? { ...d, sections: { ...d.sections, rooms } } : d))}
          />
        )}
      </main>
    </div>
  );
}

function TokenGate({ rejected, onSubmit }: { rejected: boolean; onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <main className={styles.centered}>
      <form
        className={styles.gate}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h1>Volleyland admin</h1>
        <p>Enter the admin token set as ADMIN_TOKEN on the game server.</p>
        <label className={styles.gateField}>
          <span>Admin token</span>
          <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        {rejected && <p className={styles.errorText}>That token was not accepted.</p>}
        <button type="submit" className={styles.primary}>
          Open admin
        </button>
      </form>
    </main>
  );
}
