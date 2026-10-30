'use client';

import { useEffect } from 'react';
import { useHud } from './hud-store';
import { describeNotice } from './settings-notice';

const SHOW_MS = 10_000;

/** Tells the player what the admin changed, so the game never changes under them silently. */
export function SettingsNoticeToast() {
  const notice = useHud((s) => s.settingsNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useHud.getState().set({ settingsNotice: null }), SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  const dismiss = () => useHud.getState().set({ settingsNotice: null });
  return (
    <div className="notice" role="status" aria-live="polite">
      <div className="notice__head">
        <strong>{notice.newMatch ? 'Settings changed: new match started' : 'Display settings changed'}</strong>
        <button type="button" className="notice__close" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      {notice.newMatch && <p className="notice__sub">Everyone respawned with the new settings.</p>}
      {describeNotice(notice).map((group) => (
        <section key={group.title} className="notice__group">
          <h3>{group.title}</h3>
          <dl>
            {group.lines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
