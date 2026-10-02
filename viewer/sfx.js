// Synthesised sound effects (WebAudio), no audio files.
import { WIDTH as W } from '/kit/arena/engine.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.muted = !this.muted;
    return this.muted;
  }

  out(x, gain) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = x == null ? 0 : Math.max(-0.7, Math.min(0.7, (x / W) * 1.4 - 0.7));
    g.connect(p).connect(this.master);
    return g;
  }

  env(node, t, a, d, peak = 1) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseBurst(dest, t, dur, type, f1, f2, q = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f1, t);
    f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, type, f1, f2, peak = 1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, dur, peak);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, x, k = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'capture': {
        // Bigger capture -> longer, higher chord.
        const o = this.out(x, 0.16 + Math.min(0.2, k / 400));
        const notes = k > 120 ? [523, 659, 784, 1046] : k > 30 ? [523, 659, 784] : [659, 880];
        notes.forEach((f, i) => this.tone(o, t + i * 0.055, 0.22, 'triangle', f, f));
        this.noiseBurst(o, t, 0.12, 'highpass', 4000, 8000);
        break;
      }
      case 'cut': {
        const o = this.out(x, 0.5);
        this.noiseBurst(o, t, 0.25, 'bandpass', 3000, 600, 2);
        this.tone(o, t, 0.5, 'sawtooth', 880, 110, 0.5);
        this.noiseBurst(o, t + 0.04, 0.9, 'lowpass', 1500, 80);
        break;
      }
      case 'death': {
        const o = this.out(x, 0.45);
        this.tone(o, t, 0.7, 'square', 330, 60, 0.4);
        this.noiseBurst(o, t, 0.8, 'lowpass', 1200, 90);
        break;
      }
      case 'respawn': {
        const o = this.out(x, 0.12);
        this.tone(o, t, 0.3, 'sine', 300, 900);
        break;
      }
      case 'beep': {
        this.tone(this.out(null, 0.2), t, 0.12, 'sine', 880, 880);
        break;
      }
      case 'tick': {
        this.tone(this.out(null, 0.1), t, 0.05, 'square', 1200, 1200, 0.5);
        break;
      }
      case 'go': {
        const o = this.out(null, 0.25);
        this.tone(o, t, 0.4, 'sawtooth', 660, 1320, 0.5);
        this.tone(o, t, 0.4, 'sine', 1320, 1320);
        break;
      }
      case 'end': {
        const o = this.out(null, 0.3);
        this.tone(o, t, 0.8, 'sawtooth', 440, 220, 0.5);
        this.tone(o, t, 0.8, 'sine', 220, 110);
        break;
      }
      case 'win': {
        const o = this.out(null, 0.22);
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(o, t + i * 0.09, 0.4, 'triangle', f, f));
        break;
      }
    }
  }

  // Engine events -> sounds.
  events(events) {
    for (const e of events) {
      if (e.type === 'capture' && e.count > 0) this.play('capture', e.x, e.count / 10);
      else if (e.type === 'death') this.play(e.cause === 'cut' || e.cause === 'head' ? 'cut' : 'death', e.x);
      else if (e.type === 'respawn') this.play('respawn', e.x);
    }
  }
}
