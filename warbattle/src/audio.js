// Synthesized positional audio (no sample files needed).
export class Audio3D {
  constructor() { this.ctx = null; this.enabled = false; this.volume = 0.8; }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    // impulse response for outdoor slapback reverb
    const len = c.sampleRate * 1.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < c.sampleRate * 0.08 ? 0.2 : 1); }
    this.reverb = c.createConvolver(); this.reverb.buffer = ir;
    this.revGain = c.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.enabled = true;
    this.startAmbience();
  }

  setListener(pos, fwd, up) {
    if (!this.enabled) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 2000; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  noiseSrc(dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = dur > 2; return s; }

  // gunshot: crack + boom + tail. dist used for low-pass of far shots.
  shot(pos, kind = 'carbine', dist = 0, local = false) {
    if (!this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const out = local ? this.master : this.panner(pos);
    if (!local) out.connect(this.master);
    const far = Math.min(1, dist / 400);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000 - far * 7800;
    lp.connect(out);
    const send = c.createGain(); send.gain.value = 0.4 + far * 0.8; lp.connect(send); send.connect(this.reverb);
    const prof = { carbine: [1, 0.09, 140], smg: [0.8, 0.07, 170], marksman: [1.4, 0.16, 90], pistol: [0.75, 0.07, 190] }[kind] || [1, 0.1, 140];
    // crack
    const n = this.noiseSrc(0.2); const ng = c.createGain();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    n.connect(hp); hp.connect(ng); ng.connect(lp);
    ng.gain.setValueAtTime(prof[0] * 1.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + prof[1]);
    n.start(t, Math.random()); n.stop(t + prof[1] + 0.05);
    // body
    const n2 = this.noiseSrc(0.4); const g2 = c.createGain(); const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 1400;
    n2.connect(bp); bp.connect(g2); g2.connect(lp);
    g2.gain.setValueAtTime(prof[0] * 1.6, t); g2.gain.exponentialRampToValueAtTime(0.001, t + prof[1] * 3.5);
    n2.start(t, Math.random()); n2.stop(t + 0.5);
    // thump
    const o = c.createOscillator(); const og = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(prof[2], t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    og.gain.setValueAtTime(prof[0] * 1.1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(og); og.connect(lp); o.start(t); o.stop(t + 0.25);
  }

  explosion(pos, dist) {
    if (!this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.panner(pos); p.refDistance = 10; p.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(400, 3000 - dist * 6); lp.connect(p);
    const s2 = c.createGain(); s2.gain.value = 0.8; lp.connect(s2); s2.connect(this.reverb);
    const n = this.noiseSrc(2); const g = c.createGain(); n.connect(g); g.connect(lp);
    g.gain.setValueAtTime(3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    n.start(t); n.stop(t + 1.7);
    const o = c.createOscillator(); const og = c.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    og.gain.setValueAtTime(2.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.9); o.connect(og); og.connect(lp); o.start(t); o.stop(t + 1);
  }

  click(freq = 2200, dur = 0.03, vol = 0.25, delay = 0) {
    if (!this.enabled) return;
    const c = this.ctx, t = c.currentTime + delay;
    const n = this.noiseSrc(0.1); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 3;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(this.master); n.start(t, Math.random()); n.stop(t + dur + 0.02);
  }
  reload(dur) { this.click(1500, 0.05, 0.3, 0.1); this.click(900, 0.06, 0.35, dur * 0.45); this.click(2600, 0.04, 0.35, dur * 0.9); }
  hitmarker(head) { this.click(head ? 4200 : 3000, 0.05, head ? 0.45 : 0.3); }
  dryFire() { this.click(3200, 0.02, 0.2); }

  footstep(pos, surface = 'ground', local = false, vol = 0.18) {
    if (!this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const out = local ? this.master : this.panner(pos); if (!local) out.connect(this.master);
    const n = this.noiseSrc(0.2); const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = surface === 'wood' ? 600 : surface === 'stone' ? 1600 : 900; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, Math.random()); n.stop(t + 0.15);
  }

  impact(pos, mat) {
    if (!this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.panner(pos); p.connect(this.master);
    const n = this.noiseSrc(0.2); const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = mat === 'metal' ? 3500 : mat === 'wood' ? 700 : 1200; f.Q.value = mat === 'metal' ? 8 : 1.5;
    const g = c.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + (mat === 'metal' ? 0.25 : 0.1));
    n.connect(f); f.connect(g); g.connect(p); n.start(t, Math.random()); n.stop(t + 0.3);
  }

  whiz(pos) {
    if (!this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.panner(pos); p.connect(this.master);
    const n = this.noiseSrc(0.2); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(f); f.connect(g); g.connect(p); n.start(t, Math.random()); n.stop(t + 0.16);
  }

  startAmbience() {
    const c = this.ctx;
    // wind
    const n = this.noiseSrc(4); n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.07;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.09; const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    n.connect(f); f.connect(g); g.connect(this.master); n.start();
    this.windGain = g;
    // engine drone for the aircraft (gain controlled from game)
    const e1 = c.createOscillator(); e1.type = 'sawtooth'; e1.frequency.value = 62;
    const e2 = c.createOscillator(); e2.type = 'sawtooth'; e2.frequency.value = 63.7;
    const en = this.noiseSrc(4); en.loop = true; const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 300;
    const eg = c.createGain(); eg.gain.value = 0;
    e1.connect(ef); e2.connect(ef); en.connect(ef); ef.connect(eg); eg.connect(this.master);
    e1.start(); e2.start(); en.start();
    this.engineGain = eg;
    // birds
    this.birdTimer = setInterval(() => { if (this.enabled && Math.random() < 0.5 && this.ambientBirds) this.bird(); }, 2500);
  }
  bird() {
    const c = this.ctx, t = c.currentTime;
    const p = this.panner({ x: this.lastPos?.x + (Math.random() - 0.5) * 80 || 0, y: (this.lastPos?.y || 0) + 10, z: this.lastPos?.z + (Math.random() - 0.5) * 80 || 0 }); p.connect(this.master);
    const notes = 2 + Math.floor(Math.random() * 4); const base = 2600 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const o = c.createOscillator(); const g = c.createGain(); const st = t + i * 0.13;
      o.frequency.setValueAtTime(base, st); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), st + 0.08);
      g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.06, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
      o.connect(g); g.connect(p); o.start(st); o.stop(st + 0.12);
    }
  }
  setEngine(v) { if (this.engineGain) this.engineGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3); }
  setWind(v) { if (this.windGain) this.windGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3); }
}
