'use client';

import { useState } from 'react';
import { useRuntime } from '../runtime';
import { useHud } from './hud-store';

/** F3 measurement panel for the Phase 0 device check; "Copy" captures a JSON record. */
export function MetricsPanel() {
  const runtime = useRuntime();
  const metrics = useHud((s) => s.metrics);
  const [copied, setCopied] = useState(false);
  if (!metrics) return <aside className="metrics">Measuring…</aside>;

  async function copy() {
    const history = useHud.getState().metricsHistory;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const record = {
      capturedAt: new Date().toISOString(),
      device: { userAgent: nav.userAgent, cores: nav.hardwareConcurrency, memoryGb: nav.deviceMemory ?? null, gpu: runtime.gpu },
      seconds: history.length,
      summary: summarize(history),
      history,
    };
    await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const rows: [string, string][] = [
    ['FPS', String(metrics.fps)],
    ['Input RTT', `${metrics.rttMs} ms`],
    ['Prediction error', `${metrics.predictionErrorM} m`],
    ['Corrections', `${metrics.correctionsPerSec}/s`],
    ['Interpolation error', `${metrics.interpolationErrorM} m`],
    ['Snapshot size', `${metrics.snapshotBytes} B`],
    ['Snapshot rate', `${metrics.snapshotsPerSec}/s`],
    ['Starved frames', `${metrics.starvedFramePct}%`],
    ['Render scale', `${metrics.dpr}×`],
  ];
  return (
    <aside className="metrics" aria-label="Performance metrics">
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={copy}>
        {copied ? 'Copied' : 'Copy metrics (JSON)'}
      </button>
    </aside>
  );
}

function summarize(history: { fps: number; rttMs: number; interpolationErrorM: number }[]) {
  if (!history.length) return null;
  const fps = history.map((h) => h.fps).sort((a, b) => a - b);
  const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const rtt = history.map((h) => h.rttMs).sort((a, b) => a - b);
  return {
    fpsMedian: pct(fps, 0.5),
    fpsP5: pct(fps, 0.05),
    secondsBelow60: fps.filter((f) => f < 58).length,
    rttMedianMs: pct(rtt, 0.5),
    rttP95Ms: pct(rtt, 0.95),
    interpolationErrorMeanM: Number((history.reduce((s, h) => s + h.interpolationErrorM, 0) / history.length).toFixed(3)),
  };
}
