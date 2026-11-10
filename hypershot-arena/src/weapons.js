import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------------- Stats ----------------
export const WEAPONS = [
  { id: 'rifle', name: 'VX-9 RIFLE', auto: true, dmg: 24, head: 2.0, interval: 0.092, mag: 30, reserve: 120, reload: 1.9,
    hip: 0.022, ads: 0.003, moveSpread: 0.02, kickP: 0.0095, kickY: 0.0035, vmKick: 0.045, fov: 0.75, pellets: 1, color: [3, 2.4, 1.2], tr: 0.02, shake: 0.5, range: 120 },
  { id: 'smg', name: 'HORNET SMG', auto: true, dmg: 15, head: 1.8, interval: 0.058, mag: 36, reserve: 180, reload: 1.6,
    hip: 0.03, ads: 0.008, moveSpread: 0.018, kickP: 0.006, kickY: 0.004, vmKick: 0.03, fov: 0.8, pellets: 1, color: [2.5, 2.8, 3.2], tr: 0.015, shake: 0.35, range: 90 },
  { id: 'sniper', name: 'LONGSHOT', auto: false, dmg: 105, head: 2.0, interval: 1.0, mag: 5, reserve: 25, reload: 2.7,
    hip: 0.07, ads: 0.0, moveSpread: 0.05, kickP: 0.035, kickY: 0.006, vmKick: 0.11, fov: 0.2, pellets: 1, color: [1.5, 3.2, 3.6], tr: 0.035, shake: 1.2, range: 250, scope: true },
  { id: 'shotgun', name: 'BREAKER SG', auto: false, dmg: 13, head: 1.5, interval: 0.8, mag: 6, reserve: 36, reload: 2.2,
    hip: 0.055, ads: 0.035, moveSpread: 0.02, kickP: 0.04, kickY: 0.01, vmKick: 0.1, fov: 0.85, pellets: 9, color: [3.2, 1.4, 0.5], tr: 0.012, shake: 1.0, range: 45 },
];

// ---------------- Materials ----------------
const mk = (c, m, r) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
const MAT = {
  metal: mk(0x30353f, 0.9, 0.3), dark: mk(0x15171c, 0.4, 0.55), steel: mk(0x9aa3b0, 1, 0.22),
  wood: mk(0x6b3f21, 0.1, 0.65), glove: mk(0x1b1e26, 0.2, 0.75), skin: mk(0xe0a98a, 0, 0.6), sleeve: mk(0x0e5a8a, 0.1, 0.7),
  lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 2.2) }),
  cyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 2.4, 3.2) }),
  pink: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.25, 1.3) }),
  gold: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.1, 0.4) }),
};

function rb(w, h, l, mat, x, y, z, rx = 0, r) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, 2, r ?? Math.min(w, h, l) * 0.3), mat);
  m.position.set(x, y, z); m.rotation.x = rx; return m;
}
function cyl(rad, len, mat, x, y, z, seg = 18) {
  const g = new THREE.CylinderGeometry(rad, rad, len, seg); g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return m;
}
function flat(w, h, l, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); return m; }

function hands(g, rGrip, lGrip) {
  // right hand + forearm
  const rh = rb(0.058, 0.07, 0.085, MAT.glove, rGrip[0], rGrip[1], rGrip[2]); g.add(rh);
  const ra = rb(0.07, 0.07, 0.34, MAT.sleeve, rGrip[0] + 0.035, rGrip[1] - 0.09, rGrip[2] + 0.22, -0.35, 0.02); ra.rotation.y = -0.12; g.add(ra);
  // left hand + forearm
  const lh = rb(0.07, 0.065, 0.1, MAT.glove, lGrip[0], lGrip[1], lGrip[2]); g.add(lh);
  const la = rb(0.07, 0.07, 0.38, MAT.sleeve, lGrip[0] - 0.07, lGrip[1] - 0.1, lGrip[2] + 0.25, -0.35, 0.02); la.rotation.y = 0.28; g.add(la);
  return { rh, lh };
}

// Each builder returns {group, muzzle, parts, hip, adsPos, port}
export function buildViewmodel(id) {
  const g = new THREE.Group(); const parts = {};
  let muzzleZ = -0.7, hip = [0.2, -0.2, -0.38], ads = [0, -0.066, -0.3], port = [0.03, 0.03, -0.02];
  if (id === 'rifle') {
    g.add(rb(0.052, 0.085, 0.34, MAT.metal, 0, 0, 0));
    g.add(rb(0.032, 0.014, 0.32, MAT.dark, 0, 0.049, -0.01));
    g.add(rb(0.06, 0.064, 0.24, MAT.dark, 0, -0.004, -0.27));
    g.add(cyl(0.011, 0.3, MAT.steel, 0, 0.01, -0.5));
    g.add(cyl(0.018, 0.06, MAT.dark, 0, 0.01, -0.66));
    g.add(rb(0.046, 0.09, 0.2, MAT.dark, 0, -0.02, 0.27));
    g.add(rb(0.04, 0.11, 0.05, MAT.dark, 0, -0.095, 0.1, 0.3));
    parts.mag = rb(0.04, 0.14, 0.07, MAT.metal, 0, -0.105, -0.06, -0.12); g.add(parts.mag);
    g.add(rb(0.01, 0.034, 0.012, MAT.dark, 0, 0.07, -0.56));
    g.add(rb(0.034, 0.028, 0.012, MAT.dark, 0, 0.066, 0.1));
    g.add(flat(0.004, 0.012, 0.2, MAT.cyan, 0.0285, 0.012, -0.0));
    g.add(flat(0.004, 0.012, 0.2, MAT.cyan, -0.0285, 0.012, -0.0));
    muzzleZ = -0.70; ads = [0, -0.068, -0.3];
    hands(g, [0, -0.13, 0.1], [0, -0.075, -0.27]);
  } else if (id === 'smg') {
    g.add(rb(0.05, 0.08, 0.26, MAT.metal, 0, 0, 0));
    g.add(rb(0.056, 0.058, 0.16, MAT.dark, 0, -0.005, -0.2));
    g.add(cyl(0.01, 0.16, MAT.steel, 0, 0.012, -0.36));
    g.add(cyl(0.02, 0.08, MAT.dark, 0, 0.012, -0.43));
    g.add(rb(0.04, 0.07, 0.15, MAT.dark, 0, -0.01, 0.2));
    g.add(rb(0.038, 0.1, 0.05, MAT.dark, 0, -0.09, 0.09, 0.25));
    parts.mag = rb(0.034, 0.2, 0.05, MAT.metal, 0, -0.14, -0.04, 0); g.add(parts.mag);
    g.add(rb(0.03, 0.03, 0.05, MAT.pink, 0, 0.058, -0.0));   // holo sight
    g.add(rb(0.034, 0.012, 0.06, MAT.dark, 0, 0.044, 0));
    g.add(flat(0.004, 0.012, 0.15, MAT.pink, 0.0275, 0.012, 0.0));
    g.add(flat(0.004, 0.012, 0.15, MAT.pink, -0.0275, 0.012, 0.0));
    muzzleZ = -0.48; ads = [0, -0.07, -0.26];
    hands(g, [0, -0.12, 0.09], [0, -0.1, -0.21]);
  } else if (id === 'sniper') {
    g.add(rb(0.05, 0.08, 0.42, MAT.metal, 0, 0, 0));
    g.add(cyl(0.012, 0.55, MAT.steel, 0, 0.01, -0.6));
    g.add(cyl(0.019, 0.1, MAT.dark, 0, 0.01, -0.93));
    g.add(rb(0.05, 0.1, 0.28, MAT.dark, 0, -0.02, 0.34));
    g.add(rb(0.04, 0.1, 0.05, MAT.dark, 0, -0.09, 0.12, 0.3));
    parts.mag = rb(0.04, 0.07, 0.07, MAT.metal, 0, -0.06, -0.06); g.add(parts.mag);
    // scope
    const sc = cyl(0.03, 0.3, MAT.dark, 0, 0.098, -0.02, 20); g.add(sc);
    g.add(cyl(0.038, 0.06, MAT.dark, 0, 0.098, -0.16)); g.add(cyl(0.034, 0.05, MAT.dark, 0, 0.098, 0.12));
    const lens = cyl(0.027, 0.004, MAT.lens, 0, 0.098, -0.172); g.add(lens);
    g.add(rb(0.02, 0.04, 0.04, MAT.dark, 0, 0.055, -0.1)); g.add(rb(0.02, 0.04, 0.04, MAT.dark, 0, 0.055, 0.07));
    parts.bolt = rb(0.012, 0.012, 0.07, MAT.steel, 0.045, 0.03, 0.06); g.add(parts.bolt);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), MAT.steel); knob.position.set(0.065, 0.03, 0.09); parts.bolt.add(knob); knob.position.set(0.02, 0, 0.03);
    g.add(flat(0.004, 0.012, 0.3, MAT.cyan, 0.026, 0.012, 0));
    g.add(flat(0.004, 0.012, 0.3, MAT.cyan, -0.026, 0.012, 0));
    muzzleZ = -0.99; hip = [0.21, -0.22, -0.4]; ads = [0, -0.1, -0.26];
    hands(g, [0, -0.125, 0.12], [0, -0.07, -0.3]);
  } else { // shotgun
    g.add(rb(0.056, 0.085, 0.3, MAT.metal, 0, 0, 0));
    g.add(cyl(0.015, 0.5, MAT.steel, 0, 0.012, -0.4));
    g.add(cyl(0.016, 0.4, MAT.dark, 0, -0.03, -0.35));
    g.add(cyl(0.02, 0.03, MAT.dark, 0, 0.012, -0.66));
    g.add(rb(0.05, 0.1, 0.24, MAT.wood, 0, -0.025, 0.26, 0.05));
    g.add(rb(0.04, 0.1, 0.05, MAT.wood, 0, -0.09, 0.1, 0.3));
    parts.pump = rb(0.06, 0.05, 0.16, MAT.wood, 0, -0.035, -0.3); g.add(parts.pump);
    g.add(rb(0.01, 0.026, 0.012, MAT.gold, 0, 0.05, -0.6));
    g.add(flat(0.004, 0.012, 0.18, MAT.gold, 0.029, 0.012, 0));
    g.add(flat(0.004, 0.012, 0.18, MAT.gold, -0.029, 0.012, 0));
    muzzleZ = -0.68; ads = [0, -0.062, -0.3];
    const h = hands(g, [0, -0.13, 0.1], [0, -0.04, -0.3]);
    parts.lh = h.lh; parts.lhBase = h.lh.position.clone();
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, muzzleZ); g.add(muzzle);
  // muzzle flash sprite
  const fm = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat());
  fm.position.set(0, 0.01, muzzleZ - 0.06); fm.visible = false; g.add(fm);
  const fm2 = fm.clone(); fm2.rotation.y = Math.PI / 2; fm.add(fm2);
  parts.flash = fm;
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  for (const k in parts) if (parts[k].position && !parts[k].userData.base) parts[k].userData.base = parts[k].position.clone();
  return { group: g, muzzle, parts, hip, ads, port };
}

let _fm;
function flashMat() {
  if (_fm) return _fm;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,.85)'); gr.addColorStop(1, 'rgba(255,90,10,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  // star spikes
  x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(255,220,140,.8)';
  for (let i = 0; i < 6; i++) { x.save(); x.translate(64, 64); x.rotate(i * 1.0472 + 0.3); x.beginPath(); x.moveTo(0, -3); x.lineTo(60, 0); x.lineTo(0, 3); x.fill(); x.restore(); }
  _fm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.5, 1.2, 0.9), side: THREE.DoubleSide });
  return _fm;
}

// Simple 3rd-person gun for bots
export function buildBotGun() {
  const g = new THREE.Group();
  g.add(rb(0.07, 0.11, 0.42, MAT.metal, 0, 0, 0));
  g.add(cyl(0.014, 0.35, MAT.steel, 0, 0.015, -0.36));
  g.add(rb(0.05, 0.14, 0.07, MAT.dark, 0, -0.1, 0.05, 0.3));
  g.add(rb(0.06, 0.13, 0.08, MAT.metal, 0, -0.1, -0.1));
  g.add(flat(0.074, 0.014, 0.3, MAT.cyan, 0, 0.0, 0));
  return g;
}
