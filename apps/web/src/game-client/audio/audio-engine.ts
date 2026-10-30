import type { SoundSettings } from './sound-settings';

export type Bus = 'music' | 'sfx' | 'voice';

/** Where a sound comes from on the floor (world metres); omitted, it plays at the listener. */
export interface At {
  x: number;
  z: number;
}

/** The part of a buffer worth playing, in seconds. */
interface Span {
  start: number;
  length: number;
}

/** Below this amplitude (−34 dBFS) a voice line's ends count as silence. */
const SILENCE = 0.02;
/** Kept either side of the speech, so trimming never clips a soft attack or tail. */
const TRIM_PAD_S = 0.03;

/** Music level while the player answers a question, as a share of the music volume. */
const DUCKED = 0.2;
const FADE_S = 0.6;

/**
 * Web Audio for the game: a bus per kind of sound under one master gain, sounds placed in the
 * world so they get quieter with distance and pan left or right, and one looping music track.
 * Browsers start audio only after the player interacts, so nothing plays until `unlock()`;
 * files are fetched before that and decoded once there is a context.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private readonly files = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly decoded = new Map<string, AudioBuffer | null>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | null>>();
  /** Voice lines without the dead air text-to-speech leaves around them (effects play whole). */
  private readonly spoken = new Map<string, Span>();
  private settings: SoundSettings;
  private ducked = false;
  private musicUrl: string | null = null;
  private music: { url: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private listener = { x: 0, z: 0 };
  private listenerYaw = 0;

  constructor(settings: SoundSettings) {
    this.settings = settings;
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Call from a user gesture: creates or resumes the audio context and starts the music. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      for (const bus of ['music', 'sfx', 'voice'] as const) {
        const gain = ctx.createGain();
        gain.connect(this.master);
        this.buses[bus] = gain;
      }
      this.applyOrientation();
      this.applyLevels(0);
      for (const url of this.files.keys()) void this.decode(url);
    }
    void this.ctx.resume().then(() => this.startMusic());
  }

  /** Fetches files ahead of time so they play without delay. */
  preload(urls: Iterable<string>): void {
    for (const url of urls) {
      if (!this.files.has(url)) {
        this.files.set(
          url,
          fetch(url)
            .then((res) => (res.ok ? res.arrayBuffer() : null))
            .catch(() => null),
        );
      }
      if (this.ctx) void this.decode(url);
    }
  }

  /**
   * Plays a loaded sound and returns its length in ms, or null if it is not ready (a sound that
   * would play late is better skipped) or audio is not unlocked.
   */
  play(url: string, bus: Exclude<Bus, 'music'>, at?: At, volume = 1): number | null {
    const { ctx } = this;
    const buffer = this.decoded.get(url);
    const out = this.buses[bus];
    if (!ctx || ctx.state !== 'running' || !buffer || !out) {
      this.preload([url]);
      return null;
    }
    let span: Span = { start: 0, length: buffer.duration };
    if (bus === 'voice') {
      span = this.spoken.get(url) ?? trimSilence(buffer);
      this.spoken.set(url, span);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    if (at) {
      const panner = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 5,
        rolloffFactor: 1.2,
        maxDistance: 60,
        positionX: at.x,
        positionY: 0,
        positionZ: at.z,
      });
      gain.connect(panner).connect(out);
    } else {
      gain.connect(out);
    }
    source.start(0, span.start, span.length);
    return span.length * 1000;
  }

  /**
   * Moves the listener to the local player every frame. `yaw` is where the camera faces: 0 (+z)
   * from behind the player; in first person it turns with the view.
   */
  setListener(x: number, z: number, yaw = 0): void {
    this.listener = { x, z };
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionZ.value = z;
    } else {
      l.setPosition(x, 0, z);
    }
    if (yaw !== this.listenerYaw) {
      this.listenerYaw = yaw;
      this.applyOrientation();
    }
  }

  /** Facing the camera's way with +y up, so a sound on the screen's left is heard on the left. */
  private applyOrientation(): void {
    const l = this.ctx?.listener;
    if (!l) return;
    const fx = Math.sin(this.listenerYaw);
    const fz = Math.cos(this.listenerYaw);
    if (l.forwardX) {
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  distanceTo(at: At): number {
    return Math.hypot(at.x - this.listener.x, at.z - this.listener.z);
  }

  /** Switches the looping music track (null for none), fading between them. */
  setMusic(url: string | null): void {
    if (url === this.musicUrl) return;
    this.musicUrl = url;
    if (url) this.preload([url]);
    this.startMusic();
  }

  /** Turns the music down while the player is answering a question. */
  setDucked(ducked: boolean): void {
    if (ducked === this.ducked) return;
    this.ducked = ducked;
    this.applyLevels(FADE_S);
  }

  setSettings(settings: SoundSettings): void {
    this.settings = settings;
    this.applyLevels(0.05);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.music = null;
  }

  private async startMusic(): Promise<void> {
    const { ctx } = this;
    const url = this.musicUrl;
    if (!ctx || ctx.state !== 'running' || this.music?.url === url) return;
    const old = this.music;
    this.music = null;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE_S / 3);
      old.source.stop(ctx.currentTime + FADE_S * 2);
    }
    if (!url) return;
    const buffer = await this.decode(url);
    // The track may have changed, or the context closed, while this one decoded.
    if (!buffer || url !== this.musicUrl || this.ctx !== ctx || this.music) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, FADE_S / 3);
    source.connect(gain).connect(this.buses.music!);
    source.start();
    this.music = { url, source, gain };
  }

  private decode(url: string): Promise<AudioBuffer | null> {
    const { ctx } = this;
    if (!ctx) return Promise.resolve(null);
    let pending = this.decoding.get(url);
    if (!pending) {
      pending = (this.files.get(url) ?? Promise.resolve(null))
        .then((data) => (data ? ctx.decodeAudioData(data.slice(0)) : null))
        .catch(() => null)
        .then((buffer) => {
          this.decoded.set(url, buffer);
          return buffer;
        });
      this.decoding.set(url, pending);
    }
    return pending;
  }

  private applyLevels(fadeS: number): void {
    const { ctx, master, buses, settings } = this;
    if (!ctx || !master) return;
    const set = (node: GainNode | undefined, value: number) =>
      node?.gain.setTargetAtTime(value, ctx.currentTime, Math.max(fadeS / 3, 0.01));
    set(master, settings.muted ? 0 : settings.master);
    set(buses.music, settings.music * (this.ducked ? DUCKED : 1));
    set(buses.sfx, settings.sfx);
    set(buses.voice, settings.voice);
  }
}

/** The span of a buffer between its first and last sound above the silence threshold. */
export function trimSilence(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>): Span {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const loud = (i: number) => channels.some((data) => Math.abs(data[i]!) >= SILENCE);
  let first = 0;
  while (first < buffer.length && !loud(first)) first++;
  let last = buffer.length - 1;
  while (last > first && !loud(last)) last--;
  if (first >= buffer.length) return { start: 0, length: 0 };
  const pad = TRIM_PAD_S * buffer.sampleRate;
  const from = Math.max(0, first - pad);
  const to = Math.min(buffer.length, last + 1 + pad);
  return { start: from / buffer.sampleRate, length: (to - from) / buffer.sampleRate };
}
