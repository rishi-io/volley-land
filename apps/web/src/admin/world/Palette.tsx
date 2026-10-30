'use client';

import { PROPS, PROP_KINDS, type PropKind, SURFACES, type SurfaceId, THEME_INFO, type ThemeId } from '@volleyland/game-core';
import { textureBase } from '@/game-client/world/textures';
import styles from '../admin.module.css';
import type { Tool } from './PlanView';

export const SURFACE_NAMES: Record<SurfaceId, string> = {
  court: 'Court',
  grass: 'Grass',
  dirt: 'Dirt',
  sand: 'Sand',
  cobbles: 'Cobbles',
  boards: 'Wooden boards',
  tiles: 'Tiles',
  carpet: 'Carpet',
  snow: 'Snow',
  ice: 'Ice',
  asphalt: 'Asphalt',
  rubber: 'Playground rubber',
  metal: 'Metal plate',
};

export const SURFACE_OPTIONS = SURFACES.map((s) => ({ value: s, label: SURFACE_NAMES[s] }));

interface Props {
  theme: ThemeId;
  tool: Tool | null;
  regionSurface: SurfaceId;
  lowCoverHeight: number;
  disabledProps: boolean;
  disabledSpawns: boolean;
  disabledRegions: boolean;
  disabledHills: boolean;
  onTool: (tool: Tool | null) => void;
  onRegionSurface: (surface: SurfaceId) => void;
}

/** Pick what a click on the plan places: a prop, a floor patch or a spawn point. */
export function Palette({ theme, tool, regionSurface, lowCoverHeight, disabledProps, disabledSpawns, disabledRegions, disabledHills, onTool, onRegionSurface }: Props) {
  const suits = Object.keys(THEME_INFO[theme].props) as PropKind[];
  const rest = PROP_KINDS.filter((k) => !suits.includes(k));
  const active = (t: Tool) => tool !== null && JSON.stringify(tool) === JSON.stringify(t);
  const toggle = (t: Tool) => onTool(active(t) ? null : t);

  const propButton = (kind: PropKind) => {
    const t: Tool = { kind: 'prop', prop: kind };
    const low = PROPS[kind].size.height < lowCoverHeight;
    return (
      <li key={kind}>
        <button type="button" className={styles.paletteItem} aria-pressed={active(t)} disabled={disabledProps} onClick={() => toggle(t)}>
          <span className={styles.paletteGlyph} data-shape={PROPS[kind].shape} data-low={low || undefined} aria-hidden />
          {PROPS[kind].name}
          {low && <span className={styles.lowTag}>low</span>}
        </button>
      </li>
    );
  };

  return (
    <div className={styles.propPalette} aria-label="Place on the plan">
      <h3>Props for {THEME_INFO[theme].name.toLowerCase()}</h3>
      <ul>{suits.map(propButton)}</ul>
      <details>
        <summary>All props</summary>
        <ul>{rest.map(propButton)}</ul>
      </details>
      <h3>Floor</h3>
      <ul>
        {(['rect', 'ellipse'] as const).map((shape) => {
          const t: Tool = { kind: 'region', shape, surface: regionSurface };
          return (
            <li key={shape}>
              <button type="button" className={styles.paletteItem} aria-pressed={active(t)} disabled={disabledRegions} onClick={() => toggle(t)}>
                <span className={styles.paletteGlyph} data-shape={shape === 'rect' ? 'box' : 'circle'} style={{ background: textureBase(regionSurface) }} aria-hidden />
                {shape === 'rect' ? 'Rectangle patch' : 'Round patch'}
              </button>
            </li>
          );
        })}
      </ul>
      <label className={styles.stackField}>
        <span className={styles.visuallyHidden}>Patch surface</span>
        <select
          className={styles.input}
          value={regionSurface}
          onChange={(e) => {
            const surface = e.target.value as SurfaceId;
            onRegionSurface(surface);
            if (tool?.kind === 'region') onTool({ ...tool, surface });
          }}
        >
          {SURFACE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <h3>Ground</h3>
      <ul>
        {(
          [
            ['hill', 3, 'Hill'],
            ['hollow', -2, 'Hollow'],
          ] as const
        ).map(([shape, height, label]) => {
          const t: Tool = { kind: 'hill', height };
          return (
            <li key={shape}>
              <button type="button" className={styles.paletteItem} aria-pressed={active(t)} disabled={disabledHills} onClick={() => toggle(t)}>
                <span className={styles.paletteGlyph} data-shape={shape} aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <h3>Players</h3>
      <ul>
        <li>
          <button type="button" className={styles.paletteItem} aria-pressed={active({ kind: 'spawn' })} disabled={disabledSpawns} onClick={() => toggle({ kind: 'spawn' })}>
            <span className={styles.paletteGlyph} data-shape="spawn" aria-hidden />
            Spawn point
          </button>
        </li>
      </ul>
    </div>
  );
}
