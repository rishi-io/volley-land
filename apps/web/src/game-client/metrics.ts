import type { MetricsReport } from './hud/hud-store';

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** Collects per-frame measurements and condenses them into one report per second. */
export class MetricsAccumulator {
  frames = 0;
  starvedFrames = 0;
  snapshots = 0;
  corrections = 0;
  readonly rtt: number[] = [];
  readonly predictionError: number[] = [];
  readonly interpolationError: number[] = [];
  readonly snapshotBytes: number[] = [];
  private windowStart = performance.now();

  /** Returns a report once a second has elapsed, else null. */
  flush(now: number, dpr: number): MetricsReport | null {
    const elapsed = now - this.windowStart;
    if (elapsed < 1000) return null;
    const seconds = elapsed / 1000;
    const report: MetricsReport = {
      fps: Math.round(this.frames / seconds),
      rttMs: Math.round(median(this.rtt)),
      predictionErrorM: Number(mean(this.predictionError).toFixed(3)),
      correctionsPerSec: Number((this.corrections / seconds).toFixed(1)),
      interpolationErrorM: Number(mean(this.interpolationError).toFixed(3)),
      snapshotBytes: Math.round(mean(this.snapshotBytes)),
      snapshotsPerSec: Number((this.snapshots / seconds).toFixed(1)),
      starvedFramePct: this.frames ? Number(((100 * this.starvedFrames) / this.frames).toFixed(1)) : 0,
      dpr: Number(dpr.toFixed(2)),
    };
    this.frames = this.starvedFrames = this.snapshots = this.corrections = 0;
    this.rtt.length = this.predictionError.length = this.interpolationError.length = this.snapshotBytes.length = 0;
    this.windowStart = now;
    return report;
  }
}
