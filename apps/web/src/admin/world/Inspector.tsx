'use client';

import type { WorldLayoutDto } from '@volleyland/contracts';
import { PROPS, PROP_KINDS, type PropKind, type SurfaceId } from '@volleyland/game-core';
import styles from '../admin.module.css';
import { type ItemRef, updateItem } from './editing';
import { NumberField, SelectField } from './fields';
import { SURFACE_OPTIONS } from './Palette';

interface Props {
  layout: WorldLayoutDto;
  refs: ItemRef[];
  lowCoverHeight: number;
  /** Steepest climb players manage, in degrees (from the movement rules). */
  maxSlopeDeg: number;
  /** Apply an edit to one field; `field` lets consecutive edits to it share one undo step. */
  onEdit: (layout: WorldLayoutDto, field: string) => void;
  onRotate: (degrees: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMirror: (symmetry: 'mirror-x' | 'mirror-z' | 'quad') => void;
  onReorder: (direction: 1 | -1) => void;
  canDeleteSpawns: boolean;
}

const PROP_OPTIONS = PROP_KINDS.map((k) => ({ value: k, label: PROPS[k].name }));

/** Edit what is selected on the plan: one item's fields, or actions for several. */
export function Inspector({ layout, refs, lowCoverHeight, maxSlopeDeg, onEdit, onRotate, onDuplicate, onDelete, onMirror, onReorder, canDeleteSpawns }: Props) {
  const actions = (
    <div className={styles.inspectorActions}>
      <button type="button" className={styles.secondary} onClick={() => onRotate(-15)} title="Shift+R">
        Turn −15°
      </button>
      <button type="button" className={styles.secondary} onClick={() => onRotate(15)} title="R">
        Turn +15°
      </button>
      <button type="button" className={styles.secondary} onClick={onDuplicate} title="Ctrl+D">
        Duplicate
      </button>
      <button type="button" className={styles.danger} onClick={onDelete} disabled={!canDeleteSpawns} title="Delete">
        Remove
      </button>
    </div>
  );
  const mirror = (
    <div className={styles.mirrorTools}>
      <span>Mirror copy</span>
      <div>
        <button type="button" className={styles.secondary} onClick={() => onMirror('mirror-x')} title="Copy to the other side, left–right">
          Left ↔ right
        </button>
        <button type="button" className={styles.secondary} onClick={() => onMirror('mirror-z')} title="Copy to the other side, front–back">
          Front ↕ back
        </button>
        <button type="button" className={styles.secondary} onClick={() => onMirror('quad')} title="Copy into all four quarters">
          Four ways
        </button>
      </div>
    </div>
  );

  if (refs.length > 1) {
    const counts = {
      props: refs.filter((r) => r.kind === 'prop').length,
      regions: refs.filter((r) => r.kind === 'region').length,
      spawns: refs.filter((r) => r.kind === 'spawn').length,
      hills: refs.filter((r) => r.kind === 'hill').length,
    };
    const parts = [
      counts.props && `${counts.props} prop${counts.props === 1 ? '' : 's'}`,
      counts.regions && `${counts.regions} floor patch${counts.regions === 1 ? '' : 'es'}`,
      counts.spawns && `${counts.spawns} spawn point${counts.spawns === 1 ? '' : 's'}`,
      counts.hills && `${counts.hills} hill${counts.hills === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return (
      <fieldset>
        <legend>{refs.length} selected</legend>
        <p className={styles.inspectorHint}>{parts.join(', ')}. Drag any of them to move them together; arrow keys nudge.</p>
        {actions}
        {mirror}
      </fieldset>
    );
  }

  const ref = refs[0]!;
  const edit = (patch: Record<string, unknown>, field: string) => onEdit(updateItem(layout, ref, patch), `${ref.kind}:${ref.index}:${field}`);
  const number = (label: string, key: string, value: number, unit = 'm', step = 0.5, help?: string) => (
    <NumberField key={key} label={label} unit={unit} step={step} value={value} help={help} onChange={(v) => edit({ [key]: v }, key)} />
  );

  if (ref.kind === 'prop') {
    const p = layout.props[ref.index]!;
    const round = PROPS[p.kind].shape === 'circle';
    const low = p.height < lowCoverHeight;
    return (
      <fieldset>
        <legend>
          {PROPS[p.kind].name} {ref.index + 1}
        </legend>
        <SelectField<PropKind> label="Kind" value={p.kind} options={PROP_OPTIONS} onChange={(kind) => edit({ kind, ...(PROPS[kind].shape === 'circle' ? { depth: p.width } : {}) }, 'kind')} />
        <div className={styles.fieldPair}>
          {number('Centre x', 'x', p.x)}
          {number('Centre z', 'z', p.z)}
        </div>
        <div className={styles.fieldPair}>
          {number(round ? 'Diameter' : 'Width', 'width', p.width, 'm', 0.1)}
          {!round && number('Depth', 'depth', p.depth, 'm', 0.1)}
        </div>
        {number('Height', 'height', p.height, 'm', 0.1, low ? 'Low cover: throws fly over it, players walk round it.' : 'Full cover: stops throws.')}
        {number('Turn', 'rotation', p.rotation, '°', 15)}
        {actions}
        {mirror}
      </fieldset>
    );
  }

  if (ref.kind === 'region') {
    const r = layout.regions[ref.index]!;
    return (
      <fieldset>
        <legend>Floor patch {ref.index + 1}</legend>
        <SelectField<SurfaceId> label="Surface" value={r.surface} options={SURFACE_OPTIONS} onChange={(surface) => edit({ surface }, 'surface')} />
        <SelectField<'rect' | 'ellipse'>
          label="Shape"
          value={r.shape}
          options={[
            { value: 'rect', label: 'Rectangle' },
            { value: 'ellipse', label: 'Round' },
          ]}
          onChange={(shape) => edit({ shape }, 'shape')}
        />
        <div className={styles.fieldPair}>
          {number('Centre x', 'x', r.x)}
          {number('Centre z', 'z', r.z)}
        </div>
        <div className={styles.fieldPair}>
          {number('Width', 'width', r.width, 'm', 1)}
          {number('Depth', 'depth', r.depth, 'm', 1)}
        </div>
        {number('Turn', 'rotation', r.rotation, '°', 15)}
        <div className={styles.inspectorActions}>
          <button type="button" className={styles.secondary} disabled={ref.index === layout.regions.length - 1} onClick={() => onReorder(1)}>
            Bring forward
          </button>
          <button type="button" className={styles.secondary} disabled={ref.index === 0} onClick={() => onReorder(-1)}>
            Send back
          </button>
        </div>
        <p className={styles.inspectorHint}>Patches are only paint: they never change how players move.</p>
        {actions}
        {mirror}
      </fieldset>
    );
  }

  if (ref.kind === 'hill') {
    const h = layout.hills![ref.index]!;
    // A mound is steepest at about 1.5 × height ÷ the width of its sloping rim.
    const rim = (Math.min(h.width, h.depth) / 2) * (1 - h.plateau);
    const steepest = Math.round((Math.atan((1.5 * Math.abs(h.height)) / Math.max(0.01, rim)) * 180) / Math.PI);
    const tooSteep = steepest > maxSlopeDeg;
    return (
      <fieldset>
        <legend>
          {h.height < 0 ? 'Hollow' : 'Hill'} {ref.index + 1}
        </legend>
        <div className={styles.fieldPair}>
          {number('Centre x', 'x', h.x)}
          {number('Centre z', 'z', h.z)}
        </div>
        <div className={styles.fieldPair}>
          {number('Width', 'width', h.width, 'm', 1)}
          {number('Depth', 'depth', h.depth, 'm', 1)}
        </div>
        {number('Height', 'height', h.height, 'm', 0.25, 'Negative makes a hollow.')}
        {number('Flat top', 'plateau', h.plateau, '', 0.05, '0 is a smooth dome; 0.8 a mesa with steep sides.')}
        {number('Turn', 'rotation', h.rotation, '°', 15)}
        <p className={tooSteep ? styles.errorText : styles.inspectorHint}>
          Sides about {steepest}° at their steepest{tooSteep ? `: too steep to climb (over ${maxSlopeDeg}°). Make it wider, lower or less flat-topped.` : '.'} Hills block sight and throws like cover.
        </p>
        {actions}
        {mirror}
      </fieldset>
    );
  }

  const s = layout.spawnPoints[ref.index]!;
  return (
    <fieldset>
      <legend>Spawn point {ref.index + 1}</legend>
      <div className={styles.fieldPair}>
        {number('Position x', 'x', s.x)}
        {number('Position z', 'z', s.z)}
      </div>
      <p className={styles.inspectorHint}>Players appear at the nearest spawn point that is out of throwing range of everyone else.</p>
      {actions}
      {mirror}
    </fieldset>
  );
}
