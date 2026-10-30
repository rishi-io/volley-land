import { describe, expect, it } from 'vitest';
import { trimSilence } from './audio-engine';

/** A one-channel buffer at 1 kHz from sample values. */
const bufferOf = (samples: number[]) => ({
  numberOfChannels: 1,
  length: samples.length,
  sampleRate: 1000,
  getChannelData: () => Float32Array.from(samples),
});

describe('trimSilence', () => {
  it('skips the silence before and after the sound, keeping a short pad', () => {
    const samples = [...Array(500).fill(0), ...Array(200).fill(0.5), ...Array(300).fill(0.001)];
    const clip = trimSilence(bufferOf(samples));
    expect(clip.start).toBeCloseTo(0.47);
    expect(clip.length).toBeCloseTo(0.26);
  });

  it('keeps a clip that is sound from end to end whole', () => {
    expect(trimSilence(bufferOf(Array(100).fill(0.3)))).toMatchObject({ start: 0, length: 0.1 });
  });

  it('gives a silent clip no length', () => {
    expect(trimSilence(bufferOf(Array(100).fill(0))).length).toBe(0);
  });
});
