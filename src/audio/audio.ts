import type { ThemeId } from '../core/types';
import { getSettings, onSettingsChange, type Settings } from '../ui/settings';

/**
 * Procedural audio: every sound effect and the ambient music are synthesised with the Web Audio
 * API, so there are no audio files to load or license. The AudioContext starts on the first user
 * gesture (browser autoplay rules) and suspends while the tab is hidden.
 */

export type Sfx =
  | 'click' | 'open' | 'close' | 'select' | 'pickup' | 'order' | 'error'
  | 'war' | 'battle' | 'strike' | 'capture' | 'capital' | 'loss' | 'message' | 'signed' | 'alert'
  | 'pause' | 'resume' | 'save' | 'victory' | 'defeat';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();
  private theme: ThemeId = 'sepia';
  private musicTimer: number | undefined;
  private unlocked = false;

  constructor() {
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      this.ensure();
      this.applyVolumes(getSettings());
      if (getSettings().music) this.startMusic();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    onSettingsChange((s, prev) => {
      this.applyVolumes(s);
      if (s.music && !prev.music) this.startMusic();
      if (!s.music && prev.music) this.stopMusic();
    });
  }

  /** Era flavour for music and a few effects. */
  setTheme(theme: ThemeId) {
    this.theme = theme;
    if (this.musicTimer !== undefined) {
      this.stopMusic();
      this.startMusic();
    }
  }

  play(name: Sfx, opts: { minGapMs?: number } = {}) {
    const s = getSettings();
    if (s.muted || s.sfxVolume <= 0 || s.masterVolume <= 0) return;
    if ((name === 'click' || name === 'open' || name === 'close') && !s.uiSounds) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = performance.now();
    const gap = opts.minGapMs ?? (name === 'click' ? 40 : 250);
    if (now - (this.last.get(name) ?? -1e9) < gap) return;
    this.last.set(name, now);
    try {
      RECIPES[name](this.kit(ctx), this.theme);
    } catch {
      /* audio is never allowed to break the game */
    }
  }

  // ---- internals ----------------------------------------------------------------------------------

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || !this.unlocked) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    // gentle limiter so stacked effects never clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  private applyVolumes(s: Settings) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music ? s.musicVolume * 0.5 : 0, t, 0.3);
  }

  private kit(ctx: AudioContext): Kit {
    const out = this.sfxBus;
    const t0 = ctx.currentTime + 0.005;
    const tone = (freq: number, at: number, dur: number, opts: ToneOpts = {}) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = opts.type ?? 'sine';
      o.frequency.setValueAtTime(freq, t0 + at);
      if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + at + dur);
      const peak = opts.gain ?? 0.3;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + at + (opts.attack ?? 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      let node: AudioNode = o;
      if (opts.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(opts.lowpass, t0 + at);
        if (opts.lowpassTo) f.frequency.exponentialRampToValueAtTime(opts.lowpassTo, t0 + at + dur);
        node.connect(f);
        node = f;
      }
      node.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + dur + 0.05);
    };
    const noise = (at: number, dur: number, opts: NoiseOpts = {}) => {
      if (!this.noise) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = opts.filter ?? 'lowpass';
      f.frequency.setValueAtTime(opts.freq ?? 1200, t0 + at);
      if (opts.freqTo) f.frequency.exponentialRampToValueAtTime(opts.freqTo, t0 + at + dur);
      f.Q.value = opts.q ?? 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + at + (opts.attack ?? 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      src.connect(f).connect(g).connect(out);
      src.start(t0 + at, Math.random() * 0.5);
      src.stop(t0 + at + dur + 0.05);
    };
    return { tone, noise };
  }

  // ---- generative ambient music ---------------------------------------------------------------------

  private startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicTimer !== undefined) return;
    const step = () => {
      this.musicPhrase(ctx);
      this.musicTimer = window.setTimeout(step, 3500 + Math.random() * 3500);
    };
    step();
  }

  private stopMusic() {
    window.clearTimeout(this.musicTimer);
    this.musicTimer = undefined;
  }

  /** One soft phrase: a long pad chord and a few sparse melody notes from the era's scale. */
  private musicPhrase(ctx: AudioContext) {
    const m = MUSIC[this.theme] ?? MUSIC.sepia;
    const t0 = ctx.currentTime + 0.05;
    const degree = (d: number) => m.root * Math.pow(2, (m.scale[((d % m.scale.length) + m.scale.length) % m.scale.length] + 12 * Math.floor(d / m.scale.length)) / 12);
    const voice = (freq: number, at: number, dur: number, type: OscillatorType, gain: number, cutoff: number) => {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = (Math.random() - 0.5) * 8;
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(gain, t0 + at + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(f).connect(g).connect(this.musicBus);
      o.start(t0 + at);
      o.stop(t0 + at + dur + 0.1);
    };
    const chordRoot = m.chords[Math.floor(Math.random() * m.chords.length)];
    for (const d of [0, 2, 4]) voice(degree(chordRoot + d) / 2, 0, 7, m.pad, 0.05, m.padCutoff);
    const notes = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const d = chordRoot + [0, 2, 4, 5, 7][Math.floor(Math.random() * 5)];
      voice(degree(d), 0.6 + i * (0.6 + Math.random() * 0.8), 1.8, m.lead, 0.045, m.leadCutoff);
    }
  }
}

interface ToneOpts { type?: OscillatorType; gain?: number; attack?: number; slideTo?: number; lowpass?: number; lowpassTo?: number }
interface NoiseOpts { filter?: BiquadFilterType; freq?: number; freqTo?: number; q?: number; gain?: number; attack?: number }
interface Kit {
  tone(freq: number, at: number, dur: number, opts?: ToneOpts): void;
  noise(at: number, dur: number, opts?: NoiseOpts): void;
}

const modern = (theme: ThemeId) => theme === 'tactical';

/** Sound recipes. Older eras get brass, drums and bells; the modern tactical theme gets synth tones. */
const RECIPES: Record<Sfx, (k: Kit, theme: ThemeId) => void> = {
  click: (k) => k.tone(880, 0, 0.05, { gain: 0.08, type: 'triangle' }),
  open: (k) => { k.tone(520, 0, 0.08, { gain: 0.08, type: 'triangle' }); k.tone(780, 0.05, 0.1, { gain: 0.07, type: 'triangle' }); },
  close: (k) => { k.tone(700, 0, 0.08, { gain: 0.07, type: 'triangle' }); k.tone(460, 0.05, 0.1, { gain: 0.06, type: 'triangle' }); },
  select: (k, t) => modern(t)
    ? k.tone(1400, 0, 0.06, { gain: 0.1, type: 'square', lowpass: 3000 })
    : (k.noise(0, 0.05, { filter: 'bandpass', freq: 2200, q: 3, gain: 0.25 }), k.tone(320, 0, 0.08, { gain: 0.12 })),
  pickup: (k) => k.noise(0, 0.22, { filter: 'bandpass', freq: 600, freqTo: 2400, q: 1.2, gain: 0.12, attack: 0.05 }),
  order: (k, t) => {
    if (modern(t)) { k.tone(660, 0, 0.07, { gain: 0.1, type: 'square', lowpass: 2500 }); k.tone(990, 0.08, 0.09, { gain: 0.1, type: 'square', lowpass: 2500 }); return; }
    for (const at of [0, 0.13]) { k.tone(110, at, 0.18, { gain: 0.35, slideTo: 55 }); k.noise(at, 0.08, { freq: 900, gain: 0.15 }); }
  },
  error: (k) => k.tone(140, 0, 0.16, { gain: 0.12, type: 'square', lowpass: 900 }),
  war: (k, t) => {
    if (modern(t)) {
      for (let i = 0; i < 3; i++) k.tone(880, i * 0.32, 0.22, { gain: 0.12, type: 'sawtooth', lowpass: 2200, slideTo: 620 });
      k.tone(55, 0, 1.2, { gain: 0.25, slideTo: 40 });
      return;
    }
    // war horn over a low boom
    k.tone(55, 0, 1.4, { gain: 0.4, slideTo: 38 });
    k.noise(0, 0.6, { freq: 300, gain: 0.25 });
    k.tone(110, 0.08, 1.5, { gain: 0.18, type: 'sawtooth', attack: 0.15, lowpass: 400, lowpassTo: 1400 });
    k.tone(165, 0.1, 1.4, { gain: 0.12, type: 'sawtooth', attack: 0.2, lowpass: 400, lowpassTo: 1200 });
  },
  battle: (k) => {
    k.tone(70, 0, 0.6, { gain: 0.45, slideTo: 35 });
    k.noise(0, 0.5, { freq: 700, freqTo: 120, gain: 0.4 });
    k.noise(0.18, 0.35, { freq: 500, freqTo: 100, gain: 0.25 });
  },
  strike: (k, t) => {
    // incoming: a falling whoosh (jets or a missile), then the impact
    k.noise(0, 0.75, { filter: 'bandpass', freq: modern(t) ? 4200 : 2600, freqTo: 380, q: 1.4, gain: 0.22, attack: 0.25 });
    k.tone(62, 0.7, 0.7, { gain: 0.45, slideTo: 32 });
    k.noise(0.7, 0.55, { freq: 900, freqTo: 120, gain: 0.38 });
  },
  capture: (k, t) => {
    const type = modern(t) ? 'square' : 'triangle';
    [523, 659, 784].forEach((f, i) => k.tone(f, i * 0.09, 0.22, { gain: 0.14, type, lowpass: 3000 }));
  },
  capital: (k, t) => {
    const type = modern(t) ? 'square' : 'sawtooth';
    [392, 523, 659, 784].forEach((f, i) => k.tone(f, i * 0.12, 0.3, { gain: 0.12, type, lowpass: 2200 }));
    [523, 659, 784].forEach((f) => k.tone(f, 0.5, 1.1, { gain: 0.1, type, lowpass: 2000 }));
    k.tone(65, 0.5, 0.8, { gain: 0.3, slideTo: 45 });
  },
  loss: (k) => [392, 311, 262].forEach((f, i) => k.tone(f, i * 0.22, 0.5, { gain: 0.14, type: 'triangle', lowpass: 1600 })),
  message: (k, t) => {
    if (modern(t)) { k.tone(1320, 0, 0.12, { gain: 0.1 }); k.tone(1760, 0.12, 0.2, { gain: 0.1 }); return; }
    k.tone(1320, 0, 1.0, { gain: 0.12 });
    k.tone(1980, 0, 0.7, { gain: 0.06 });
    k.tone(2640, 0, 0.4, { gain: 0.03 });
  },
  signed: (k) => { k.tone(90, 0, 0.25, { gain: 0.35, slideTo: 60 }); k.noise(0.02, 0.25, { filter: 'highpass', freq: 2500, gain: 0.08 }); },
  alert: (k) => { k.tone(880, 0, 0.09, { gain: 0.12, type: 'square', lowpass: 2500 }); k.tone(880, 0.14, 0.09, { gain: 0.12, type: 'square', lowpass: 2500 }); },
  pause: (k) => k.tone(600, 0, 0.08, { gain: 0.07, slideTo: 420 }),
  resume: (k) => k.tone(420, 0, 0.08, { gain: 0.07, slideTo: 600 }),
  save: (k) => { k.tone(784, 0, 0.12, { gain: 0.09, type: 'triangle' }); k.tone(1047, 0.1, 0.2, { gain: 0.09, type: 'triangle' }); },
  victory: (k, t) => {
    const type = modern(t) ? 'square' : 'sawtooth';
    [392, 523, 659, 784, 1047].forEach((f, i) => k.tone(f, i * 0.16, 0.4, { gain: 0.12, type, lowpass: 2500 }));
    [523, 659, 784, 1047].forEach((f) => k.tone(f, 0.85, 2.2, { gain: 0.09, type, lowpass: 2200 }));
    k.tone(65, 0.85, 1.5, { gain: 0.3, slideTo: 50 });
  },
  defeat: (k) => {
    [440, 415, 392, 330].forEach((f, i) => k.tone(f, i * 0.4, 0.8, { gain: 0.12, type: 'triangle', lowpass: 1400 }));
    k.tone(55, 1.2, 2.5, { gain: 0.3, slideTo: 35 });
  },
};

/** Per-theme music: root note, scale (semitones), chord roots (scale degrees) and timbres. */
const MUSIC: Record<string, { root: number; scale: number[]; chords: number[]; pad: OscillatorType; lead: OscillatorType; padCutoff: number; leadCutoff: number }> = {
  parchment: { root: 220, scale: [0, 2, 3, 7, 8], chords: [0, 3, 4], pad: 'triangle', lead: 'triangle', padCutoff: 700, leadCutoff: 1800 },
  marble: { root: 196, scale: [0, 2, 3, 5, 7, 9, 10], chords: [0, 3, 4, 6], pad: 'triangle', lead: 'sine', padCutoff: 900, leadCutoff: 2200 },
  ornate: { root: 220, scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 2, 5, 6], pad: 'sawtooth', lead: 'triangle', padCutoff: 600, leadCutoff: 2000 },
  sepia: { root: 174.6, scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 3, 5, 6], pad: 'sawtooth', lead: 'sine', padCutoff: 500, leadCutoff: 1500 },
  tactical: { root: 146.8, scale: [0, 3, 5, 7, 10], chords: [0, 2, 3], pad: 'sine', lead: 'square', padCutoff: 1200, leadCutoff: 900 },
};

export const audio = new AudioEngine();
