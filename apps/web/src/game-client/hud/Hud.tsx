'use client';

import { FirstPersonOverlay } from './FirstPersonOverlay';
import { MetricsPanel } from './MetricsPanel';
import { Minimap } from './Minimap';
import { QuestionOverlay } from './QuestionOverlay';
import { ResultToast } from './ResultToast';
import { SettingsNoticeToast } from './SettingsNoticeToast';
import { SoundControls } from './SoundControls';
import { WeaponBar } from './WeaponBar';
import { useHud } from './hud-store';

const STATUS_TEXT = {
  alive: 'Ready',
  frozen: 'Frozen — answer the question',
  dead: 'Knocked out — respawning…',
} as const;

export function Hud() {
  const connection = useHud((s) => s.connection);
  const error = useHud((s) => s.error);
  const health = useHud((s) => s.health);
  const maxHealth = useHud((s) => s.maxHealth);
  const status = useHud((s) => s.status);
  const protectedNow = useHud((s) => s.protectedNow);
  const opponents = useHud((s) => s.opponents);
  const showMetrics = useHud((s) => s.showMetrics);
  const world = useHud((s) => s.world);
  const showMinimap = useHud((s) => s.showMinimap);
  const view = useHud((s) => s.view);
  const canSwitch = useHud((s) => s.camera.playerChoice);
  const switchHelp = canSwitch ? ' · V: switch view' : '';

  return (
    <div className="hud">
      {connection !== 'connected' && (
        <div className="banner" role="alert">
          {connection === 'connecting' && 'Connecting to the arena…'}
          {connection === 'disconnected' && 'Disconnected from the server.'}
          {connection === 'error' && `Could not join: ${error ?? 'unknown error'}`}
        </div>
      )}
      <div className="hud__vitals">
        <div className="health" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}>
          <div className="health__fill" style={{ width: `${(100 * health) / maxHealth}%` }} />
          <span className="health__text">
            Health {health}/{maxHealth}
          </span>
        </div>
        <p className="hud__status">
          {STATUS_TEXT[status]}
          {protectedNow && status === 'alive' && ' · 🛡 Protected'}
        </p>
        {world && <p className="hud__world">World: {world.name}</p>}
        <ul className="hud__opponents" aria-label="Opponents">
          {opponents.length === 0 && <li>Waiting for an opponent…</li>}
          {opponents.map((o) => (
            <li key={o.id}>
              Opponent: {o.health} HP · {o.status}
            </li>
          ))}
        </ul>
      </div>
      <FirstPersonOverlay />
      {connection === 'connected' && <WeaponBar />}
      {showMinimap && connection === 'connected' && <Minimap />}
      <p className="hud__help">
        {view === 'first-person'
          ? `WASD / arrows: move · Mouse: look · Click or Space: fire at the crosshair · 1–4 or Q: weapon (answers while frozen) · M: map${switchHelp} · F3: metrics`
          : `WASD / arrows: move · Mouse: aim · Click or Space: fire · 1–4 or Q: weapon (answers while frozen) · Wheel or +/−: zoom · M: map${switchHelp} · F3: metrics`}
      </p>
      <SoundControls />
      <QuestionOverlay />
      <ResultToast />
      <SettingsNoticeToast />
      {showMetrics && <MetricsPanel />}
    </div>
  );
}
