'use client';

import { type SectionValue, type Versioned, WORLD_LIMITS, type WorldDto, type WorldLayoutDto, WorldSchema } from '@volleyland/contracts';
import {
  type AppearanceSettings,
  DEFAULT_TERRAIN,
  type SurfaceId,
  type Symmetry,
  THEMES,
  THEME_INFO,
  type ThemeId,
  blankLayout,
  checkWorld,
  generateLayout,
  newHill,
  newProp,
  playRulesOf,
} from '@volleyland/game-core';
import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AdminApiError, type AdminApi } from '../api';
import { sameValue } from '../form';
import { type ContentChoices, QuestionPoolFields } from '../QuestionPoolFields';
import styles from '../admin.module.css';
import {
  EMPTY,
  type ItemRef,
  type Selection,
  deleteItems,
  duplicateItems,
  keyOf,
  mirrorItems,
  moveItems,
  refsOf,
  reorderRegion,
  rotateItems,
  select,
} from './editing';
import { NumberField, SelectField, SliderField } from './fields';
import { Inspector } from './Inspector';
import { Palette, SURFACE_NAMES, SURFACE_OPTIONS } from './Palette';
import { PlanView, type Tool } from './PlanView';

const WorldPreview = dynamic(() => import('./WorldPreview'), { ssr: false, loading: () => <p className={styles.previewLoading}>Loading 3D preview…</p> });

const NEW = '__new__';
const HISTORY_LIMIT = 100;

interface Props {
  api: AdminApi;
  worlds: Versioned<WorldDto>[];
  rooms: Versioned<SectionValue<'rooms'>>;
  movement: SectionValue<'movement'>;
  projectiles: SectionValue<'projectiles'>;
  appearance: AppearanceSettings;
  /** The room-wide question pool, for worlds without their own. */
  roomQuestions: SectionValue<'questions'>;
  content: ContentChoices;
  devRoomCode: string;
  onDirtyChange: (dirty: boolean) => void;
  onWorlds: (worlds: Versioned<WorldDto>[]) => void;
  onRooms: (rooms: Versioned<SectionValue<'rooms'>>) => void;
}

interface History {
  past: WorldDto[];
  future: WorldDto[];
  /** The field the last edit changed, so typing into one field is one undo step. */
  lastField: string | null;
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'world';

const uniqueId = (base: string, taken: Set<string>) => {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
};

const THEME_OPTIONS = THEMES.map((t) => ({ value: t, label: THEME_INFO[t].name }));

const blankWorld = (id: string, theme: ThemeId = 'park'): WorldDto => ({
  id,
  name: 'New world',
  description: '',
  layout: blankLayout(theme),
});

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);

/**
 * World builder: pick a world, then place props, paint floor patches and set spawn points on the
 * plan (or generate a starting layout), check it plays well, preview it in 3D, save it and choose
 * it for the room. Every change can be undone. Worlds are stored as versioned records, like
 * settings sections.
 */
export function WorldBuilder({ api, worlds, rooms, movement, projectiles, appearance, roomQuestions, content, devRoomCode, onDirtyChange, onWorlds, onRooms }: Props) {
  const [selectedId, setSelectedId] = useState<string>(rooms.value.worldId);
  const [drafts, setDrafts] = useState<Record<string, WorldDto>>({});
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [tool, setTool] = useState<Tool | null>(null);
  const [regionSurface, setRegionSurface] = useState<SurfaceId>('cobbles');
  const [snap, setSnap] = useState(0.5);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [panel, setPanel] = useState<'none' | 'generate'>('none');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const savedRecord = worlds.find((w) => w.value.id === selectedId) ?? null;
  const isNew = selectedId === NEW;
  const world: WorldDto | null = drafts[selectedId] ?? savedRecord?.value ?? null;
  const dirty = Boolean(drafts[selectedId]) && (isNew || !sameValue(drafts[selectedId], savedRecord?.value));
  const inUse = !isNew && rooms.value.worldId === selectedId;
  const takenIds = useMemo(() => new Set(worlds.map((w) => w.value.id)), [worlds]);
  const history = histories[selectedId] ?? { past: [], future: [], lastField: null };
  const lowCoverHeight = projectiles.projectileHeight - projectiles.projectileRadius;

  const anyDirty = Object.entries(drafts).some(([id, d]) => id === NEW || !sameValue(d, worlds.find((w) => w.value.id === id)?.value));
  useEffect(() => onDirtyChange(anyDirty), [anyDirty, onDirtyChange]);

  const validation = useMemo(() => (world ? WorldSchema.safeParse(world) : null), [world]);
  const issues = validation && !validation.success ? validation.error.issues : [];
  const invalid = useMemo(() => {
    const keys = new Set<string>();
    const kinds = { props: 'prop', regions: 'region', spawnPoints: 'spawn', hills: 'hill' } as const;
    for (const issue of issues) {
      const [root, list, index] = issue.path;
      if (root === 'layout' && typeof index === 'number' && typeof list === 'string' && list in kinds) keys.add(keyOf({ kind: kinds[list as keyof typeof kinds], index }));
    }
    return keys;
  }, [issues]);

  // Play checks walk the whole floor, so they follow the layout a beat behind while dragging.
  const deferredLayout = useDeferredValue(world?.layout ?? null);
  const checks = useMemo(
    () =>
      deferredLayout && WorldSchema.shape.layout.safeParse(deferredLayout).success
        ? checkWorld(deferredLayout, playRulesOf({ ...movement, ...projectiles }, rooms.value.maxPlayers))
        : null,
    [deferredLayout, movement.playerRadius, projectiles, rooms.value.maxPlayers],
  );

  /** Replace the draft. `field` coalesces repeated edits of one field into one undo step; `gesture` means a drag already saved the undo step. */
  const commit = useCallback(
    (next: WorldDto, options: { field?: string; transient?: boolean } = {}) => {
      if (!world) return;
      setDrafts((d) => ({ ...d, [selectedId]: next }));
      setMessage(null);
      if (options.transient) return;
      setHistories((h) => {
        const current = h[selectedId] ?? { past: [], future: [], lastField: null };
        const coalesce = options.field !== undefined && current.lastField === options.field;
        return {
          ...h,
          [selectedId]: {
            past: coalesce ? current.past : [...current.past, world].slice(-HISTORY_LIMIT),
            future: [],
            lastField: options.field ?? null,
          },
        };
      });
    },
    [world, selectedId],
  );
  const editLayout = useCallback((layout: WorldLayoutDto, options?: { field?: string; transient?: boolean }) => world && commit({ ...world, layout }, options), [world, commit]);

  const undo = useCallback(() => {
    if (!world || history.past.length === 0) return;
    const previous = history.past.at(-1)!;
    setHistories((h) => ({ ...h, [selectedId]: { past: history.past.slice(0, -1), future: [world, ...history.future], lastField: null } }));
    setDrafts((d) => ({ ...d, [selectedId]: previous }));
    setSelection(EMPTY);
  }, [world, history, selectedId]);

  const redo = useCallback(() => {
    if (!world || history.future.length === 0) return;
    const [next, ...rest] = history.future;
    setHistories((h) => ({ ...h, [selectedId]: { past: [...history.past, world], future: rest, lastField: null } }));
    setDrafts((d) => ({ ...d, [selectedId]: next! }));
    setSelection(EMPTY);
  }, [world, history, selectedId]);

  const refs = useMemo(() => refsOf(selection), [selection]);
  const deletable = refs.filter((r) => r.kind === 'spawn').length <= (world?.layout.spawnPoints.length ?? 0) - WORLD_LIMITS.minSpawnPoints;

  const act = {
    rotate: (degrees: number) => world && refs.length > 0 && editLayout(rotateItems(world.layout, refs, degrees)),
    remove: () => {
      if (!world || refs.length === 0 || !deletable) return;
      editLayout(deleteItems(world.layout, refs));
      setSelection(EMPTY);
    },
    duplicate: () => {
      if (!world || refs.length === 0) return;
      const { layout, added } = duplicateItems(world.layout, refs);
      editLayout(layout);
      setSelection(select(...added));
    },
    mirror: (symmetry: Exclude<Symmetry, 'none'>) => {
      if (!world || refs.length === 0) return;
      const { layout, added } = mirrorItems(world.layout, refs, symmetry);
      editLayout(layout);
      setSelection(new Set([...selection, ...added.map(keyOf)]));
    },
    nudge: (dx: number, dz: number) => world && refs.length > 0 && editLayout(moveItems(world.layout, refs, dx, dz, 0), { field: `nudge:${[...selection].join()}` }),
  };

  const place = (x: number, z: number) => {
    if (!world || !tool) return;
    const l = world.layout;
    let ref: ItemRef;
    let layout: WorldLayoutDto;
    if (tool.kind === 'prop') {
      if (l.props.length >= WORLD_LIMITS.maxProps) return;
      layout = { ...l, props: [...l.props, newProp(tool.prop, x, z)] };
      ref = { kind: 'prop', index: l.props.length };
    } else if (tool.kind === 'region') {
      if (l.regions.length >= WORLD_LIMITS.maxRegions) return;
      layout = { ...l, regions: [...l.regions, { surface: tool.surface, shape: tool.shape, x, z, width: 6, depth: 6, rotation: 0 }] };
      ref = { kind: 'region', index: l.regions.length };
    } else if (tool.kind === 'hill') {
      const hills = l.hills ?? [];
      if (hills.length >= WORLD_LIMITS.maxHills) return;
      layout = { ...l, hills: [...hills, newHill(x, z, tool.height)] };
      ref = { kind: 'hill', index: hills.length };
    } else {
      if (l.spawnPoints.length >= WORLD_LIMITS.maxSpawnPoints) return;
      layout = { ...l, spawnPoints: [...l.spawnPoints, { x, z }] };
      ref = { kind: 'spawn', index: l.spawnPoints.length };
    }
    editLayout(layout);
    setSelection(select(ref));
  };

  // Keyboard shortcuts while the builder is open (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!world || view !== 'plan' || isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const step = (e.shiftKey ? 5 : 1) * (snap || 0.5);
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        act.duplicate();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(new Set(world.layout.props.map((_, index) => keyOf({ kind: 'prop', index }))));
      } else if (e.key === 'Escape') {
        if (tool) setTool(null);
        else setSelection(EMPTY);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && refs.length > 0) {
        e.preventDefault();
        act.remove();
      } else if (e.key.toLowerCase() === 'r' && !mod && refs.length > 0) {
        act.rotate(e.shiftKey ? -15 : 15);
      } else if (e.key.startsWith('Arrow') && refs.length > 0) {
        e.preventDefault();
        // Screen directions: the plan has +x to the left and +z up.
        const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        const [dx, dz] = moves[e.key]!;
        act.nudge(dx, dz);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pick = (id: string) => {
    setSelectedId(id);
    setSelection(EMPTY);
    setTool(null);
    setMessage(null);
    setConfirmDelete(false);
    setPanel('none');
  };

  const startNew = (from?: WorldDto) => {
    const base = from ? `${from.id}-copy` : 'new-world';
    const id = uniqueId(base, takenIds);
    const draft = from ? { ...structuredClone(from), id, name: `${from.name} (copy)` } : blankWorld(id);
    setDrafts((d) => ({ ...d, [NEW]: draft }));
    setHistories((h) => ({ ...h, [NEW]: { past: [], future: [], lastField: null } }));
    pick(NEW);
    if (!from) setPanel('generate');
  };

  const failure = (error: unknown) => {
    const body = error instanceof AdminApiError ? error.body : null;
    const detail = body?.issues?.map((i) => i.message).join('; ');
    setMessage({ kind: 'error', text: detail ? `${body!.message}: ${detail}` : error instanceof Error ? error.message : String(error) });
  };

  const forget = (id: string) => {
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    setHistories((h) => {
      const next = { ...h };
      delete next[id];
      return next;
    });
  };

  const save = async () => {
    if (!world || !validation?.success) return;
    setBusy(true);
    try {
      const saved = isNew ? await api.createWorld(world) : await api.updateWorld(world, savedRecord!.version);
      onWorlds([...worlds.filter((w) => w.value.id !== saved.value.id), saved].sort((a, b) => a.value.name.localeCompare(b.value.name)));
      forget(selectedId);
      setSelectedId(saved.value.id);
      setMessage({ kind: 'ok', text: inUse ? `Saved as version ${saved.version}. Players in room ${devRoomCode} have moved to the new layout.` : `Saved as version ${saved.version}.` });
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!savedRecord) return;
    setBusy(true);
    try {
      await api.deleteWorld(savedRecord.value.id, savedRecord.version);
      onWorlds(worlds.filter((w) => w.value.id !== savedRecord.value.id));
      forget(savedRecord.value.id);
      pick(rooms.value.worldId);
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const useForRoom = async () => {
    if (!savedRecord) return;
    setBusy(true);
    try {
      const saved = await api.updateSection('rooms', { ...rooms.value, worldId: savedRecord.value.id }, rooms.version);
      onRooms(saved);
      setMessage({ kind: 'ok', text: `Room ${devRoomCode} now plays ${savedRecord.value.name}.` });
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const exportJson = () => {
    if (!world) return;
    const blob = new Blob([`${JSON.stringify(world, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${world.id}.world.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = WorldSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        setMessage({ kind: 'error', text: `That file is not a world: ${parsed.error.issues[0]?.message ?? 'unknown problem'}` });
        return;
      }
      const imported = parsed.data;
      if (world && !isNew && imported.id === world.id) {
        commit({ ...world, ...imported });
        setMessage({ kind: 'ok', text: 'Imported over this world. Save to keep it.' });
      } else {
        const id = uniqueId(imported.id, takenIds);
        setDrafts((d) => ({ ...d, [NEW]: { ...imported, id } }));
        setHistories((h) => ({ ...h, [NEW]: { past: [], future: [], lastField: null } }));
        pick(NEW);
        setMessage({ kind: 'ok', text: `Imported as a new world (${id}). Create it to keep it.` });
      }
    } catch {
      setMessage({ kind: 'error', text: 'That file is not valid JSON.' });
    }
  };

  /** A new world's ID follows its name until the ID is edited by hand. */
  const renamed = (w: WorldDto, name: string): WorldDto => {
    const idFollowsName = isNew && w.id === uniqueId(slugify(w.name), takenIds);
    return { ...w, name, id: idFollowsName ? uniqueId(slugify(name), takenIds) : w.id };
  };

  const hillCount = world?.layout.hills?.length ?? 0;
  const counts = world
    ? `${world.layout.props.length}/${WORLD_LIMITS.maxProps} props, ${world.layout.regions.length} floor patches, ${world.layout.spawnPoints.length} spawn points${hillCount > 0 ? `, ${hillCount} hills` : ''}`
    : '';

  return (
    <section className={styles.section} aria-labelledby="worlds-title">
      <header className={styles.sectionHeader}>
        <div>
          <h1 id="worlds-title">Worlds</h1>
          <p>Build the places players fight in. Room {devRoomCode} plays one world at a time; choose it here or under Rooms.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondary} onClick={() => importInput.current?.click()}>
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = '';
            }}
          />
          <button type="button" className={styles.secondary} onClick={() => startNew()}>
            New world
          </button>
        </div>
      </header>

      <ul className={styles.worldTabs} aria-label="Worlds">
        {worlds.map((w) => (
          <li key={w.value.id}>
            <button type="button" aria-pressed={selectedId === w.value.id} onClick={() => pick(w.value.id)}>
              <span className={styles.themeDot} style={{ background: themeSwatch(w.value.layout.theme) }} aria-hidden />
              {w.value.name}
              {rooms.value.worldId === w.value.id && <span className={styles.inUse}>In use</span>}
              {drafts[w.value.id] && !sameValue(drafts[w.value.id], w.value) && <span className={styles.dirtyDot} title="Unsaved changes" />}
            </button>
          </li>
        ))}
        {drafts[NEW] && (
          <li>
            <button type="button" aria-pressed={isNew} onClick={() => pick(NEW)}>
              {drafts[NEW].name}
              <span className={styles.dirtyDot} title="Not saved yet" />
            </button>
          </li>
        )}
      </ul>

      {!world ? (
        <p className={styles.empty}>Pick a world above, or start a new one.</p>
      ) : (
        <div className={styles.builder}>
          <div className={styles.planPane}>
            <div className={styles.toolbar}>
              <div className={styles.segmented} role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>
                  Plan
                </button>
                <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
                  3D preview
                </button>
              </div>
              <button type="button" className={styles.secondary} onClick={undo} disabled={history.past.length === 0} title="Ctrl+Z">
                Undo
              </button>
              <button type="button" className={styles.secondary} onClick={redo} disabled={history.future.length === 0} title="Ctrl+Shift+Z">
                Redo
              </button>
              <button type="button" className={styles.secondary} aria-pressed={panel === 'generate'} onClick={() => setPanel(panel === 'generate' ? 'none' : 'generate')}>
                Generate…
              </button>
              <label className={styles.inlineField}>
                Snap
                <select className={styles.input} value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
                  <option value={0}>Off</option>
                  <option value={0.25}>0.25 m</option>
                  <option value={0.5}>0.5 m</option>
                  <option value={1}>1 m</option>
                </select>
              </label>
              <span className={styles.toolbarHint}>{counts}</span>
            </div>

            {panel === 'generate' && (
              <GeneratePanel
                layout={world.layout}
                maxPlayers={rooms.value.maxPlayers}
                onGenerate={(layout) => {
                  editLayout(layout);
                  setSelection(EMPTY);
                }}
                onClose={() => setPanel('none')}
              />
            )}

            {view === 'plan' ? (
              <>
                <p className={styles.toolbarHint} role="status">
                  {tool
                    ? `Click the plan to place ${
                        tool.kind === 'prop'
                          ? 'a prop'
                          : tool.kind === 'region'
                            ? `a ${SURFACE_NAMES[tool.surface].toLowerCase()} patch`
                            : tool.kind === 'hill'
                              ? tool.height < 0
                                ? 'a hollow'
                                : 'a hill'
                              : 'a spawn point'
                      }. Esc stops.`
                    : 'Drag to move, drag empty floor to select an area, Shift+click to add. Hills move by their ▲ marker. R turns, Ctrl+D duplicates, Delete removes. Wheel zooms; Space+drag pans.'}
                </p>
                <PlanView
                  layout={world.layout}
                  selection={selection}
                  invalid={invalid}
                  checks={checks}
                  tool={tool}
                  snap={snap}
                  lowCoverHeight={lowCoverHeight}
                  onSelect={setSelection}
                  onGestureStart={() => commit(world)}
                  onChange={(layout) => editLayout(layout, { transient: true })}
                  onPlace={place}
                />
              </>
            ) : (
              <WorldPreview layout={world.layout} appearance={appearance} projectileHeight={projectiles.projectileHeight} />
            )}

            {issues.length > 0 && (
              <ul className={styles.issueList} aria-label="Problems to fix before saving">
                {issues.slice(0, 8).map((issue, i) => (
                  <li key={i}>{issue.path[0] === 'layout' ? issue.message : `${issue.path.join('.')}: ${issue.message}`}</li>
                ))}
                {issues.length > 8 && <li>…and {issues.length - 8} more</li>}
              </ul>
            )}
            {checks && (
              <section className={styles.checks} aria-label="Play checks">
                <h3>Play checks</h3>
                <ul>
                  {checks.checks.map((c, i) => (
                    <li key={i} data-level={c.level}>
                      {c.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className={styles.inspector}>
            {view === 'plan' && (
              <Palette
                theme={world.layout.theme}
                tool={tool}
                regionSurface={regionSurface}
                lowCoverHeight={lowCoverHeight}
                disabledProps={world.layout.props.length >= WORLD_LIMITS.maxProps}
                disabledRegions={world.layout.regions.length >= WORLD_LIMITS.maxRegions}
                disabledSpawns={world.layout.spawnPoints.length >= WORLD_LIMITS.maxSpawnPoints}
                disabledHills={hillCount >= WORLD_LIMITS.maxHills}
                onTool={setTool}
                onRegionSurface={setRegionSurface}
              />
            )}
            {refs.length > 0 && view === 'plan' ? (
              <Inspector
                layout={world.layout}
                refs={refs}
                lowCoverHeight={lowCoverHeight}
                maxSlopeDeg={movement.maxSlopeDeg}
                onEdit={(layout, field) => editLayout(layout, { field })}
                onRotate={act.rotate}
                onDuplicate={act.duplicate}
                onDelete={act.remove}
                onMirror={act.mirror}
                onReorder={(direction) => {
                  const ref = refs[0]!;
                  const { layout, index } = reorderRegion(world.layout, ref.index, direction);
                  editLayout(layout);
                  setSelection(select({ kind: 'region', index }));
                }}
                canDeleteSpawns={deletable}
              />
            ) : (
              <fieldset>
                <legend>World</legend>
                <label className={styles.stackField}>
                  <span>Name</span>
                  <input className={styles.input} value={world.name} maxLength={60} onChange={(e) => commit(renamed(world, e.target.value), { field: 'name' })} />
                </label>
                <label className={styles.stackField}>
                  <span>ID</span>
                  <input className={styles.input} value={world.id} readOnly={!isNew} onChange={(e) => commit({ ...world, id: e.target.value }, { field: 'id' })} aria-describedby="world-id-help" />
                  <small id="world-id-help">{isNew ? 'Lowercase letters, digits and hyphens. Fixed once saved.' : 'Fixed: rooms refer to the world by it.'}</small>
                </label>
                <label className={styles.stackField}>
                  <span>Description</span>
                  <textarea className={styles.input} rows={3} maxLength={280} value={world.description} onChange={(e) => commit({ ...world, description: e.target.value }, { field: 'description' })} />
                </label>
                <SelectField<ThemeId>
                  label="Theme"
                  value={world.layout.theme}
                  options={THEME_OPTIONS}
                  onChange={(theme) => editLayout({ ...world.layout, theme })}
                />
                <SelectField label="Floor" value={world.layout.floor} options={SURFACE_OPTIONS} onChange={(floor) => editLayout({ ...world.layout, floor })} />
                <SliderField
                  label="Decorations"
                  value={world.layout.scatter}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => (v === 0 ? 'none' : `${Math.round(v * 100)}%`)}
                  onChange={(scatter) => editLayout({ ...world.layout, scatter }, { field: 'scatter' })}
                />
                <div className={styles.fieldPair}>
                  <NumberField label="Floor width" unit="m" step={2} value={world.layout.halfWidth * 2} onChange={(v) => editLayout({ ...world.layout, halfWidth: v / 2 }, { field: 'width' })} />
                  <NumberField label="Floor depth" unit="m" step={2} value={world.layout.halfDepth * 2} onChange={(v) => editLayout({ ...world.layout, halfDepth: v / 2 }, { field: 'depth' })} />
                </div>
                <p className={styles.inspectorHint}>
                  {WORLD_LIMITS.minHalfExtent * 2}–{WORLD_LIMITS.maxHalfExtent * 2} m a side. Theme sets the sky, light, border, scenery and decorations; the floor and patches are yours.
                </p>
                <GroundFields layout={world.layout} onEdit={(layout, field) => editLayout(layout, { field })} />
              </fieldset>
            )}
            {!(refs.length > 0 && view === 'plan') && (
              <QuestionPoolFields
                pool={world.questions}
                roomPool={roomQuestions}
                content={content}
                onChange={(questions) => {
                  const { questions: _old, ...rest } = world;
                  commit(questions ? { ...rest, questions } : rest);
                }}
              />
            )}
          </div>
        </div>
      )}

      {world && (
        <footer className={styles.saveBar} data-visible>
          <div className={styles.saveStatus} role="status">
            {message ? (
              <span className={message.kind === 'ok' ? styles.okText : styles.errorText}>{message.text}</span>
            ) : dirty ? (
              issues.length > 0 ? `Fix ${issues.length === 1 ? 'one problem' : `${issues.length} problems`} before saving` : 'Unsaved changes'
            ) : inUse ? (
              `Room ${devRoomCode} plays this world.`
            ) : null}
          </div>
          <div className={styles.saveActions}>
            {!confirmDelete && (
              <button type="button" className={styles.secondary} disabled={busy} onClick={exportJson}>
                Export
              </button>
            )}
            {!isNew && !confirmDelete && (
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => startNew(world)}>
                Duplicate
              </button>
            )}
            {!isNew &&
              !inUse &&
              (confirmDelete ? (
                <>
                  <button type="button" className={styles.secondary} onClick={() => setConfirmDelete(false)}>
                    Keep world
                  </button>
                  <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>
                    Delete {world.name}
                  </button>
                </>
              ) : (
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              ))}
            {!isNew && !inUse && !dirty && !confirmDelete && (
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => void useForRoom()}>
                Use in room {devRoomCode}
              </button>
            )}
            {dirty && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  forget(selectedId);
                  if (isNew) pick(rooms.value.worldId);
                  setSelection(EMPTY);
                }}
              >
                {isNew ? 'Discard world' : 'Discard changes'}
              </button>
            )}
            <button type="button" className={styles.primary} disabled={!dirty || busy || issues.length > 0} onClick={() => void save()}>
              {busy ? 'Saving…' : isNew ? 'Create world' : 'Save world'}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

const SYMMETRY_OPTIONS: { value: Symmetry; label: string }[] = [
  { value: 'quad', label: 'Four ways' },
  { value: 'mirror-x', label: 'Left ↔ right' },
  { value: 'mirror-z', label: 'Front ↕ back' },
  { value: 'none', label: 'None' },
];

/** The rolling ground under the whole floor. Hills and hollows are placed on the plan (Palette → Ground). */
function GroundFields({ layout, onEdit }: { layout: WorldLayoutDto; onEdit: (layout: WorldLayoutDto, field: string) => void }) {
  const terrain = layout.terrain ?? DEFAULT_TERRAIN;
  const set = (patch: Partial<typeof terrain>, field: string) => onEdit({ ...layout, terrain: { ...terrain, ...patch } }, `terrain:${field}`);
  const flat = terrain.relief === 0 && (layout.hills?.length ?? 0) === 0;
  return (
    <>
      <h3 className={styles.inspectorHeading}>Ground</h3>
      <SliderField label="Rolling ground" value={terrain.relief} min={0} max={8} step={0.25} format={(v) => (v === 0 ? 'flat' : `${v} m`)} onChange={(relief) => set({ relief }, 'relief')} />
      {terrain.relief > 0 && (
        <>
          <SliderField label="Rise to rise" value={terrain.scale} min={WORLD_LIMITS.minTerrainScale} max={WORLD_LIMITS.maxTerrainScale} step={2} format={(v) => `${v} m`} onChange={(scale) => set({ scale }, 'scale')} />
          <SelectField<Symmetry> label="Mirror the ground" value={terrain.symmetry} options={SYMMETRY_OPTIONS} onChange={(symmetry) => set({ symmetry }, 'symmetry')} />
          <div className={styles.inspectorActions}>
            <button type="button" className={styles.secondary} onClick={() => set({ seed: (terrain.seed % 1_000_000) + 1 }, 'seed')}>
              Another pattern
            </button>
          </div>
        </>
      )}
      {!flat && (
        <div className={styles.inspectorActions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              const { terrain: _terrain, hills: _hills, ...rest } = layout;
              onEdit(rest, 'terrain:flatten');
            }}
          >
            Make it flat
          </button>
        </div>
      )}
      <p className={styles.inspectorHint}>Hills hide players and stop throws. Ground steeper than the movement rules allow can only be walked down; the play checks show what cannot be reached.</p>
    </>
  );
}

function themeSwatch(theme: ThemeId): string {
  return { classic: '#5c6b8a', park: '#6aa84f', schoolyard: '#c8553d', beach: '#e8d3a2', snow: '#e4eef7', library: '#8e2c3a', space: '#4cc9f0' }[theme];
}

/** Generate a starting layout: the theme's props spread evenly and mirrored for fairness. Replaces the layout (undo brings it back). */
function GeneratePanel({ layout, maxPlayers, onGenerate, onClose }: { layout: WorldLayoutDto; maxPlayers: number; onGenerate: (layout: WorldLayoutDto) => void; onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeId>(layout.theme);
  const [width, setWidth] = useState(Math.max(60, layout.halfWidth * 2));
  const [depth, setDepth] = useState(Math.max(60, layout.halfDepth * 2));
  const [density, setDensity] = useState(0.55);
  const [symmetry, setSymmetry] = useState<Symmetry>('quad');
  const [spawns, setSpawns] = useState(Math.min(WORLD_LIMITS.maxSpawnPoints, Math.max(4, maxPlayers)));
  const [seed, setSeed] = useState(1);
  const [relief, setRelief] = useState(layout.terrain || layout.hills?.length ? 0.6 : 0);
  const run = (nextSeed = seed) => {
    const clamp = (v: number) => Math.max(WORLD_LIMITS.minHalfExtent * 2, Math.min(WORLD_LIMITS.maxHalfExtent * 2, v));
    onGenerate(generateLayout({ theme, width: clamp(width), depth: clamp(depth), density, symmetry, spawns, seed: nextSeed, relief }));
  };
  return (
    <div className={styles.generate} role="group" aria-label="Generate a layout">
      <div className={styles.generateFields}>
        <SelectField<ThemeId> label="Theme" value={theme} options={THEME_OPTIONS} onChange={setTheme} />
        <NumberField label="Width" unit="m" step={10} value={width} onChange={setWidth} />
        <NumberField label="Depth" unit="m" step={10} value={depth} onChange={setDepth} />
        <SliderField label="Cover" value={density} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setDensity} />
        <SliderField label="Hills" value={relief} min={0} max={1} step={0.05} format={(v) => (v === 0 ? 'flat' : `${Math.round(v * 100)}%`)} onChange={setRelief} />
        <SelectField<Symmetry>
          label="Symmetry"
          value={symmetry}
          options={[
            { value: 'quad', label: 'Four ways' },
            { value: 'mirror-x', label: 'Left ↔ right' },
            { value: 'mirror-z', label: 'Front ↕ back' },
            { value: 'none', label: 'None' },
          ]}
          onChange={setSymmetry}
        />
        <NumberField label="Spawn points" unit="" step={1} value={spawns} onChange={(v) => setSpawns(Math.max(2, Math.min(WORLD_LIMITS.maxSpawnPoints, Math.round(v))))} />
      </div>
      <p className={styles.inspectorHint}>Replaces the current layout (Undo brings it back). Props always leave room to walk between them.</p>
      <div className={styles.inspectorActions}>
        <button type="button" className={styles.primary} onClick={() => run()}>
          Generate
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            const next = seed + 1;
            setSeed(next);
            run(next);
          }}
        >
          Try another
        </button>
        <button type="button" className={styles.secondary} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
