// Procedural WebAudio sound engine – no asset files needed.
let ctx, master, noiseBuf, comp;
let volume = 0.6;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  comp = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function resumeAudio() { if (ctx && ctx.state !== 'running') ctx.resume(); }
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

function out(gain = 1, pan = 0) {
  const g = ctx.createGain();
  g.gain.value = gain;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(master);
  } else g.connect(master);
  return g;
}
function noise(t, dur, { gain = 1, pan = 0, f0 = 4000, f1 = 400, q = 0.7, type = 'bandpass', att = 0.002 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = out(0, pan);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); s.start(t, Math.random() * 0.5, dur + 0.05);
}
function tone(t, dur, f0, f1, { gain = 0.5, type = 'sine', pan = 0 } = {}) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = out(0, pan);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); o.start(t); o.stop(t + dur + 0.02);
}

// vol: 0..1 distance falloff, pan: -1..1
export function sndShot(kind, vol = 1, pan = 0) {
  if (!ctx) return; const t = ctx.currentTime; const g = vol;
  switch (kind) {
    case 'rifle':
      noise(t, 0.16, { gain: 0.9 * g, pan, f0: 5000, f1: 500, q: 0.5 });
      tone(t, 0.12, 190, 55, { gain: 0.8 * g, type: 'triangle', pan });
      noise(t + 0.01, 0.35, { gain: 0.25 * g, pan, f0: 1200, f1: 150, type: 'lowpass' });
      break;
    case 'smg':
      noise(t, 0.09, { gain: 0.75 * g, pan, f0: 6500, f1: 900, q: 0.6 });
      tone(t, 0.07, 260, 90, { gain: 0.55 * g, type: 'square', pan });
      break;
    case 'sniper':
      noise(t, 0.5, { gain: 1 * g, pan, f0: 3500, f1: 120, q: 0.4 });
      tone(t, 0.35, 120, 28, { gain: 1 * g, type: 'sawtooth', pan });
      noise(t + 0.03, 1.0, { gain: 0.35 * g, pan, f0: 900, f1: 90, type: 'lowpass' });
      break;
    case 'shotgun':
      noise(t, 0.3, { gain: 1 * g, pan, f0: 3000, f1: 150, q: 0.4 });
      tone(t, 0.22, 110, 35, { gain: 1 * g, type: 'sawtooth', pan });
      noise(t + 0.02, 0.6, { gain: 0.3 * g, pan, f0: 800, f1: 100, type: 'lowpass' });
      break;
  }
}
export function sndHit(head) {
  if (!ctx) return; const t = ctx.currentTime;
  if (head) { tone(t, 0.18, 1900, 1500, { gain: 0.45, type: 'square' }); tone(t, 0.25, 1200, 900, { gain: 0.3, type: 'sine' }); }
  else tone(t, 0.09, 1100, 800, { gain: 0.35, type: 'triangle' });
}
export function sndKill() {
  if (!ctx) return; const t = ctx.currentTime;
  tone(t, 0.12, 700, 700, { gain: 0.3, type: 'square' });
  tone(t + 0.09, 0.16, 1050, 1050, { gain: 0.3, type: 'square' });
  tone(t + 0.19, 0.3, 1400, 1400, { gain: 0.28, type: 'triangle' });
}
export function sndHurt() {
  if (!ctx) return; const t = ctx.currentTime;
  tone(t, 0.25, 160, 60, { gain: 0.7, type: 'sawtooth' });
  noise(t, 0.15, { gain: 0.5, f0: 900, f1: 200, type: 'lowpass' });
}
export function sndReload(stage) {
  if (!ctx) return; const t = ctx.currentTime;
  if (stage === 0) { noise(t, 0.06, { gain: 0.4, f0: 3000, f1: 1500, q: 2 }); tone(t, 0.06, 500, 300, { gain: 0.25, type: 'square' }); }
  if (stage === 1) { noise(t, 0.08, { gain: 0.45, f0: 2200, f1: 900, q: 2 }); tone(t, 0.1, 300, 180, { gain: 0.3, type: 'square' }); }
  if (stage === 2) { noise(t, 0.05, { gain: 0.6, f0: 4000, f1: 2000, q: 3 }); tone(t, 0.09, 700, 400, { gain: 0.35, type: 'square' }); }
}
export function sndEmpty() { if (!ctx) return; tone(ctx.currentTime, 0.05, 900, 700, { gain: 0.2, type: 'square' }); }
export function sndStep(vol = 0.2, pan = 0) { if (!ctx) return; noise(ctx.currentTime, 0.07, { gain: vol, pan, f0: 600, f1: 200, type: 'lowpass', q: 1 }); }
export function sndJump() { if (!ctx) return; noise(ctx.currentTime, 0.1, { gain: 0.15, f0: 800, f1: 300, type: 'lowpass' }); }
export function sndLand() { if (!ctx) return; const t = ctx.currentTime; tone(t, 0.12, 90, 45, { gain: 0.5, type: 'sine' }); noise(t, 0.1, { gain: 0.25, f0: 700, f1: 150, type: 'lowpass' }); }
export function sndSwitch() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.07, { gain: 0.3, f0: 3000, f1: 1200, q: 2 }); tone(t + 0.04, 0.05, 600, 400, { gain: 0.2, type: 'square' }); }
export function sndSpawn() { if (!ctx) return; const t = ctx.currentTime; tone(t, 0.4, 200, 800, { gain: 0.25, type: 'sine' }); }
export function sndStart() { if (!ctx) return; const t = ctx.currentTime; tone(t, 0.2, 440, 440, { gain: 0.3, type: 'square' }); tone(t + 0.15, 0.2, 660, 660, { gain: 0.3, type: 'square' }); tone(t + 0.3, 0.4, 880, 880, { gain: 0.3, type: 'triangle' }); }

// ---------- Synthwave background music (procedural) ----------
let musicGain, musicTimer, nextT = 0, step = 0, musicOn = false;
const BASS = [55, 55, 82.4, 55, 65.4, 65.4, 98, 65.4, 73.4, 73.4, 110, 73.4, 61.7, 61.7, 92.5, 82.4];
const CHORDS = [[220, 261.6, 329.6], [261.6, 311.1, 392], [293.7, 349.2, 440], [246.9, 293.7, 370]];
export function startMusic(level = 0.22) {
  if (!ctx || musicOn) { if (musicGain) musicGain.gain.value = level; return; }
  musicOn = true; musicGain = ctx.createGain(); musicGain.gain.value = level; musicGain.connect(master);
  nextT = ctx.currentTime + 0.1; step = 0;
  musicTimer = setInterval(schedule, 100);
}
export function setMusic(level) { if (musicGain) musicGain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.4); }
function schedule() {
  const spb = 60 / 112 / 4;
  while (nextT < ctx.currentTime + 0.3) {
    const t = nextT, s = step % 64, bar = (s / 16) | 0;
    const f = BASS[s % 16] * (bar % 2 ? 1 : 1);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(160, t + spb * 0.9);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 0.95);
    o.connect(lp); lp.connect(g); g.connect(musicGain); o.start(t); o.stop(t + spb);
    if (s % 4 === 0) { // kick
      const k = ctx.createOscillator(); k.type = 'sine'; k.frequency.setValueAtTime(140, t); k.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const kg = ctx.createGain(); kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      k.connect(kg); kg.connect(musicGain); k.start(t); k.stop(t + 0.22);
    }
    if (s % 8 === 4) { // snare
      const n = ctx.createBufferSource(); n.buffer = noiseBuf; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      n.connect(hp); hp.connect(ng); ng.connect(musicGain); n.start(t, Math.random() * 0.5, 0.2);
    }
    if (s % 2 === 0) { // hats
      const n = ctx.createBufferSource(); n.buffer = noiseBuf; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(s % 4 === 2 ? 0.22 : 0.1, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      n.connect(hp); hp.connect(ng); ng.connect(musicGain); n.start(t, Math.random() * 0.5, 0.06);
    }
    // arpeggio
    const ch = CHORDS[bar % 4], af = ch[s % 3] * (s % 8 > 3 ? 2 : 1);
    const a = ctx.createOscillator(); a.type = 'square'; a.frequency.value = af;
    const alp = ctx.createBiquadFilter(); alp.type = 'lowpass'; alp.frequency.value = 2400;
    const ag = ctx.createGain(); ag.gain.setValueAtTime(0.0001, t); ag.gain.exponentialRampToValueAtTime(0.09, t + 0.005); ag.gain.exponentialRampToValueAtTime(0.0001, t + spb * 1.6);
    a.connect(alp); alp.connect(ag); ag.connect(musicGain); a.start(t); a.stop(t + spb * 1.7);
    if (s % 16 === 0) { // pad
      for (const pf of ch) { const p = ctx.createOscillator(); p.type = 'sawtooth'; p.frequency.value = pf / 2; p.detune.value = (Math.random() - 0.5) * 14;
        const pl = ctx.createBiquadFilter(); pl.type = 'lowpass'; pl.frequency.value = 900; const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, t); pg.gain.linearRampToValueAtTime(0.07, t + 0.4); pg.gain.linearRampToValueAtTime(0.0001, t + spb * 16);
        p.connect(pl); pl.connect(pg); pg.connect(musicGain); p.start(t); p.stop(t + spb * 16 + 0.1); }
    }
    nextT += spb; step++;
  }
}
