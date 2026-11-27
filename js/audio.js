// Fully synthesized WebAudio sound effects (no asset files).

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.recent = 0; // simple voice limiting
    this.lastReset = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown-ish noise for rumble
    this.brown = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _voice() {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (t - this.lastReset > 0.05) { this.lastReset = t; this.recent = 0; }
    if (this.recent > 6) return false;
    this.recent++;
    return true;
  }
  _out(vol, pan) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }
  _noiseBurst(out, { dur = 0.2, f = 1000, q = 1, type = 'bandpass', attack = 0.002, decay = 0.15, buf, gain = 1, rate = 1 }) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = buf || this.noise;
    src.playbackRate.value = rate;
    const flt = c.createBiquadFilter();
    flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(flt); flt.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  _thump(out, f0, f1, dur, gain) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }

  // kind: 'rifle'|'smg'|'lmg'|'bolt'; dist in meters; pan -1..1
  gunshot(kind, dist = 0, pan = 0) {
    if (!this._voice()) return;
    const near = dist < 2;
    const vol = near ? 0.9 : Math.min(0.7, 18 / (dist + 12));
    if (vol < 0.02) return;
    const out = this._out(vol, pan);
    const far = Math.min(1, dist / 150);
    const base = { rifle: 1400, bolt: 1100, smg: 2000, lmg: 1600, pistol: 2200 }[kind] || 1500;
    this._noiseBurst(out, { f: base * (1 - far * 0.6), q: 0.7, decay: (kind === 'bolt' ? 0.32 : kind === 'smg' ? 0.11 : 0.2) + far * 0.3, gain: 1 });
    this._noiseBurst(out, { f: 300, type: 'lowpass', q: 0.5, decay: 0.25 + far * 0.4, gain: 0.8, buf: this.brown });
    if (near) this._thump(out, 160, 50, 0.12, 0.6);
  }
  explosion(dist = 0, pan = 0, big = false) {
    if (!this.ctx) return;
    const vol = Math.min(1, 60 / (dist + 30)) * (big ? 1.2 : 1);
    const out = this._out(vol, pan);
    this._noiseBurst(out, { f: 600 - Math.min(400, dist * 2), type: 'lowpass', q: 0.4, decay: 1.4, gain: 1, attack: 0.005 });
    this._noiseBurst(out, { f: 180, type: 'lowpass', q: 0.4, decay: 2.0, gain: 1, buf: this.brown, attack: 0.01 });
    this._thump(out, 90, 25, 0.8, 1);
  }
  whiz(pan = 0) {
    if (!this._voice()) return;
    const out = this._out(0.25, pan);
    this._noiseBurst(out, { f: 3500 + Math.random() * 2000, type: 'bandpass', q: 6, decay: 0.12, attack: 0.03, gain: 1 });
  }
  impact() {
    if (!this._voice()) return;
    const out = this._out(0.15, (Math.random() - 0.5));
    this._noiseBurst(out, { f: 2500, q: 2, decay: 0.05, gain: 1 });
  }
  hit() {
    if (!this.ctx) return;
    const out = this._out(0.35, 0);
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 1800;
    const g = c.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.07);
  }
  hurt() {
    if (!this.ctx) return;
    const out = this._out(0.5, 0);
    this._thump(out, 120, 40, 0.25, 0.8);
    this._noiseBurst(out, { f: 400, type: 'lowpass', decay: 0.2, gain: 0.6 });
  }
  click() {
    if (!this.ctx) return;
    const out = this._out(0.3, 0);
    this._noiseBurst(out, { f: 4000, q: 3, decay: 0.03, gain: 1 });
  }
  reload() {
    if (!this.ctx) return;
    const c = this.ctx;
    [0, 0.35, 0.9].forEach((dt) => setTimeout(() => {
      if (!this.ctx) return;
      const out = this._out(0.35, 0);
      this._noiseBurst(out, { f: 3000 - dt * 1000, q: 4, decay: 0.05, gain: 1 });
    }, dt * 1000));
  }
  plane(pan = 0) {
    if (!this.ctx) return;
    const out = this._out(0.5, pan);
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + 2); o.frequency.linearRampToValueAtTime(55, t + 5);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 2); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 5.6);
  }
  whistle() {
    if (!this.ctx) return;
    const out = this._out(0.18, 0);
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(500, t + 1.6);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.8);
  }
  ambient(on) {
    if (!this.ctx) return;
    if (on && !this._amb) {
      const src = this.ctx.createBufferSource(); src.buffer = this.brown; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0.08;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      this._amb = { src, g };
    } else if (!on && this._amb) {
      try { this._amb.src.stop(); } catch (e) {}
      this._amb = null;
    }
  }
  // Campaign UI blip
  ui() {
    if (!this.ctx) return;
    const out = this._out(0.15, 0);
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 660;
    const g = c.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.1);
  }
}

export const audio = new AudioSys();
