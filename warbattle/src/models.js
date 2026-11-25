// Procedural characters, weapons, aircraft and parachute for Warbattle.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const camoCache = new Map();
export function camoTexture(palette, seed = 1) {
  const key = palette.join() + seed;
  if (camoCache.has(key)) return camoCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  g.fillStyle = palette[0]; g.fillRect(0, 0, 256, 256);
  for (let layer = 1; layer < palette.length; layer++) {
    g.fillStyle = palette[layer];
    for (let i = 0; i < 26; i++) {
      const x = r() * 256, y = r() * 256;
      g.beginPath();
      const pts = 7;
      for (let k = 0; k <= pts; k++) {
        const a = k / pts * Math.PI * 2, rad = (10 + r() * 22) * (1.2 - layer * 0.15);
        const px = x + Math.cos(a) * rad * (1 + r() * 0.6), py = y + Math.sin(a) * rad * 0.7;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.fill();
      // wrap copies for tiling
      g.save(); g.translate(x > 128 ? -256 : 256, 0); g.fill(); g.restore();
    }
  }
  // fabric weave noise
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 18 + ((i / 4) % 2 ? 4 : -4); img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  camoCache.set(key, t);
  return t;
}

const PALETTES = [
  ['#5b5a41', '#3f4330', '#7a6f50', '#2c2a22'],
  ['#6d6a5c', '#4a4b42', '#8e8a77', '#2f302b'],
  ['#4d5844', '#33402f', '#6e7258', '#25291f'],
  ['#7c6b52', '#5a4c3a', '#9c8a6a', '#3a3127'],
  ['#3e4a52', '#2c353b', '#5e6a70', '#1f2326'],
];

const shared = {};
function mats() {
  if (shared.skin) return shared;
  shared.skin = [0xc99a7a, 0xa87656, 0x7a5236, 0xe0b598].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  shared.boot = new THREE.MeshStandardMaterial({ color: 0x1f1b17, roughness: 0.75 });
  shared.glove = new THREE.MeshStandardMaterial({ color: 0x2a2722, roughness: 0.8 });
  shared.vest = new THREE.MeshStandardMaterial({ color: 0x3b3d30, roughness: 0.85 });
  shared.vest2 = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.6 });
  shared.helmet = new THREE.MeshStandardMaterial({ color: 0x48503c, roughness: 0.55, metalness: 0.15 });
  shared.helmet2 = new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.4, metalness: 0.3 });
  shared.hair = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 });
  shared.gunmetal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.38, metalness: 0.8 });
  shared.polymer = new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.62, metalness: 0.05 });
  shared.tan = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.65 });
  shared.glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.9 });
  shared.backpack = new THREE.MeshStandardMaterial({ color: 0x4a4636, roughness: 0.9 });
  return shared;
}

function cap(r, len, mat) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.castShadow = true; m.receiveShadow = true; return m; }
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
function cyl(rt, rb, h, mat, seg = 12) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; return m; }

export class Soldier {
  constructor(seed = 1, isPlayer = false) {
    const M = mats();
    const r = mulberry32(seed * 977 + 3);
    const pal = isPlayer ? PALETTES[2] : PALETTES[Math.floor(r() * PALETTES.length)];
    const cloth = new THREE.MeshStandardMaterial({ map: camoTexture(pal, seed), roughness: 0.92 });
    const pants = new THREE.MeshStandardMaterial({ map: camoTexture(pal, seed + 101), roughness: 0.92, color: 0xdddddd });
    const skin = M.skin[Math.floor(r() * M.skin.length)];
    this.root = new THREE.Group();
    this.hips = new THREE.Group(); this.hips.position.y = 0.95; this.root.add(this.hips);
    // torso
    this.spine = new THREE.Group(); this.hips.add(this.spine);
    const torso = cap(0.17, 0.36, cloth); torso.scale.set(1.05, 1, 0.68); torso.position.y = 0.3; this.spine.add(torso);
    const pelvis = cap(0.15, 0.1, pants); pelvis.scale.set(1.1, 1, 0.75); pelvis.position.y = 0.02; this.hips.add(pelvis);
    this.belt = box(0.36, 0.06, 0.24, M.boot, 0, 0.1, 0); this.hips.add(this.belt);
    // vest + backpack (toggled by armor level)
    this.vestMesh = new THREE.Group();
    const v1 = box(0.4, 0.38, 0.3, M.vest, 0, 0.33, 0); this.vestMesh.add(v1);
    for (let i = -1; i <= 1; i++) this.vestMesh.add(box(0.09, 0.12, 0.05, M.vest, i * 0.11, 0.24, 0.17));
    this.vestMesh.visible = false; this.spine.add(this.vestMesh);
    this.pack = box(0.32, 0.4, 0.18, M.backpack, 0, 0.32, -0.24); this.pack.visible = r() < 0.6; this.spine.add(this.pack);
    // neck + head
    this.neck = new THREE.Group(); this.neck.position.y = 0.6; this.spine.add(this.neck);
    const neckM = cyl(0.055, 0.065, 0.1, skin); neckM.position.y = 0.03; this.neck.add(neckM);
    this.head = new THREE.Group(); this.head.position.y = 0.17; this.neck.add(this.head);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skin); headM.scale.set(0.92, 1.08, 1); headM.castShadow = true; this.head.add(headM);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), M.hair); hair.scale.set(0.93, 1.08, 1.01); this.head.add(hair);
    const nose = box(0.03, 0.05, 0.04, skin, 0, -0.005, 0.115); this.head.add(nose);
    for (const s of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), M.boot); eye.position.set(s * 0.04, 0.025, 0.1); this.head.add(eye); }
    this.helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.helmet);
    this.helmetMesh.scale.set(1, 0.95, 1.08); this.helmetMesh.position.y = 0.025; this.helmetMesh.castShadow = true; this.helmetMesh.visible = false; this.head.add(this.helmetMesh);
    this.cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.07, 14), cloth); this.cap.position.y = 0.08; this.head.add(this.cap);
    // arms
    const arm = (side) => {
      const sh = new THREE.Group(); sh.position.set(side * 0.22, 0.52, 0); this.spine.add(sh);
      const upper = cap(0.055, 0.22, cloth); upper.position.y = -0.14; sh.add(upper);
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      const fore = cap(0.048, 0.22, cloth); fore.position.y = -0.13; el.add(fore);
      const hand = box(0.07, 0.1, 0.05, M.glove, 0, -0.3, 0); el.add(hand);
      return { sh, el, hand };
    };
    this.armL = arm(-1); this.armR = arm(1);
    // legs
    const leg = (side) => {
      const hip = new THREE.Group(); hip.position.set(side * 0.1, -0.02, 0); this.hips.add(hip);
      const thigh = cap(0.075, 0.3, pants); thigh.position.y = -0.22; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.45; hip.add(knee);
      const shin = cap(0.06, 0.3, pants); shin.position.y = -0.2; knee.add(shin);
      const boot = box(0.11, 0.1, 0.25, M.boot, 0, -0.43, 0.04); knee.add(boot);
      return { hip, knee };
    };
    this.legL = leg(-1); this.legR = leg(1);
    // weapon socket in front of chest
    this.gunSocket = new THREE.Group(); this.gunSocket.position.set(0.1, 0.38, 0.28); this.spine.add(this.gunSocket);
    this.phase = r() * 10;
    this.deadT = 0;
    this.root.traverse(o => { if (o.isMesh) o.userData.soldier = this; });
  }

  setGear(armor, helmet) {
    const M = mats();
    this.vestMesh.visible = armor > 0;
    this.vestMesh.children.forEach(c => c.material = armor >= 2 ? M.vest2 : M.vest);
    this.helmetMesh.visible = helmet > 0; this.cap.visible = helmet === 0;
    this.helmetMesh.material = helmet >= 2 ? M.helmet2 : M.helmet;
  }

  setWeapon(obj) {
    this.gunSocket.clear();
    if (obj) this.gunSocket.add(obj);
  }

  // s: {speed, crouch, pitch, dead, fwd, side, airborne, parachute, aim}
  animate(dt, s) {
    const sp = s.speed || 0;
    this.phase += dt * (sp > 0.2 ? 2.2 + sp * 1.25 : 0);
    const ph = this.phase;
    const amp = Math.min(1, sp / 5.5);
    const crouch = s.crouch ? 1 : 0;
    if (s.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      const t = this.deadT;
      this.hips.rotation.x = -Math.PI / 2 * t * t;
      this.hips.position.y = 0.95 - 0.7 * t;
      this.armL.sh.rotation.x = -1.3 * t; this.armR.sh.rotation.x = -1.6 * t;
      this.legL.hip.rotation.x = 0.1 * t; this.legR.hip.rotation.x = -0.2 * t;
      return;
    }
    this.deadT = 0;
    this.hips.rotation.x = 0;
    if (s.parachute || s.airborne) {
      const free = s.airborne && !s.parachute;
      this.hips.position.y = 0.95;
      this.spine.rotation.x = free ? 0.9 : 0;
      this.legL.hip.rotation.x = free ? 0.5 : 0.2; this.legR.hip.rotation.x = free ? 0.3 : 0.1;
      this.legL.knee.rotation.x = 0.6; this.legR.knee.rotation.x = 0.4;
      this.armL.sh.rotation.set(free ? -0.4 : Math.PI * 0.92, 0, free ? -1.2 : 0.2);
      this.armR.sh.rotation.set(free ? -0.4 : Math.PI * 0.92, 0, free ? 1.2 : -0.2);
      this.armL.el.rotation.x = -0.3; this.armR.el.rotation.x = -0.3;
      this.gunSocket.visible = false;
      return;
    }
    this.gunSocket.visible = true;
    this.hips.position.y = 0.95 - crouch * 0.38 + Math.abs(Math.sin(ph)) * 0.04 * amp;
    this.spine.rotation.x = crouch * 0.28 + amp * 0.08;
    this.legL.hip.rotation.x = Math.sin(ph) * 0.65 * amp - crouch * 1.1;
    this.legR.hip.rotation.x = -Math.sin(ph) * 0.65 * amp - crouch * 0.4;
    this.legL.knee.rotation.x = Math.max(0, -Math.cos(ph)) * 0.9 * amp + crouch * 1.9;
    this.legR.knee.rotation.x = Math.max(0, Math.cos(ph)) * 0.9 * amp + crouch * 0.95;
    const p = s.pitch || 0;
    if (!s.armed) {
      this.neck.rotation.x = -p * 0.4;
      const sw = Math.sin(ph) * 0.55 * amp;
      this.armR.sh.rotation.set(sw, 0, 0.12); this.armR.el.rotation.set(-0.25 - amp * 0.4, 0, 0);
      this.armL.sh.rotation.set(-sw, 0, -0.12); this.armL.el.rotation.set(-0.25 - amp * 0.4, 0, 0);
      return;
    }
    // arms hold weapon; pitch follows aim
    this.neck.rotation.x = -p * 0.4;
    this.gunSocket.rotation.x = p * 0.85;
    this.gunSocket.position.y = 0.38 + p * 0.12;
    this.armR.sh.rotation.set(-1.05 + p * 0.8, 0, -0.3);
    this.armR.el.rotation.set(-1.0, 0, 0);
    this.armL.sh.rotation.set(-1.4 + p * 0.8, 0, 0.62);
    this.armL.el.rotation.set(-0.35, 0, -0.2);
  }
}

// ---------------- weapons ----------------
function normalizeModel(src, length, { flip = false, yaw = 0 } = {}) {
  const o = src.clone();
  const bb = new THREE.Box3().setFromObject(o);
  const size = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  o.position.sub(c);
  const wrap = new THREE.Group(); wrap.add(o);
  // align longest axis to Z
  if (size.x >= size.y && size.x >= size.z) wrap.rotation.y = Math.PI / 2;
  else if (size.y >= size.x && size.y >= size.z) wrap.rotation.x = Math.PI / 2;
  if (flip) wrap.rotation.y += Math.PI;
  wrap.rotation.y += yaw;
  const outer = new THREE.Group(); outer.add(wrap);
  outer.scale.setScalar(length / Math.max(size.x, size.y, size.z));
  outer.traverse(m => { if (m.isMesh) { m.castShadow = true; } });
  return outer;
}

export function makeWeapon(kind, models) {
  const M = mats();
  const g = new THREE.Group();
  // convention: muzzle toward -Z, grip at origin
  if (kind === 'carbine' || kind === 'smg') {
    const L = kind === 'carbine' ? 1 : 0.74;
    const furn = kind === 'carbine' ? M.tan : M.polymer;
    const rb = (w, h, d, mat, x, y, z, r = 0.008) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat); m.position.set(x, y, z); m.castShadow = true; return m; };
    // upper + lower receiver
    g.add(rb(0.058, 0.07, 0.34 * L, M.gunmetal, 0, 0.045, -0.06));
    g.add(rb(0.054, 0.05, 0.22 * L, M.gunmetal, 0, -0.005, -0.04));
    // ejection port + charging handle
    g.add(box(0.004, 0.022, 0.07, M.polymer, 0.03, 0.05, -0.04));
    g.add(rb(0.03, 0.014, 0.05, M.gunmetal, 0, 0.085, 0.1, 0.004));
    // picatinny rail with teeth
    g.add(box(0.026, 0.012, 0.48 * L, M.gunmetal, 0, 0.087, -0.16));
    for (let i = 0; i < Math.round(22 * L); i++) g.add(box(0.03, 0.006, 0.008, M.gunmetal, 0, 0.096, 0.07 - i * 0.021));
    // handguard (vented)
    const hgL = 0.32 * L, hgZ = -0.23 - hgL / 2;
    g.add(rb(0.066, 0.068, hgL, furn, 0, 0.04, hgZ, 0.014));
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) g.add(box(0.004, 0.016, 0.03, M.polymer, sx * 0.033, 0.04, hgZ - hgL / 2 + 0.04 + i * hgL / 5.5));
    // barrel + gas block + muzzle device
    const bar = cyl(0.011, 0.011, 0.22 * L + 0.06, M.gunmetal, 12); bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.04, hgZ - hgL / 2 - 0.08 * L); g.add(bar);
    const mzZ = hgZ - hgL / 2 - 0.2 * L;
    const mz = cyl(0.018, 0.018, 0.07, M.polymer, 12); mz.rotation.x = Math.PI / 2; mz.position.set(0, 0.04, mzZ); g.add(mz);
    for (let i = 0; i < 3; i++) g.add(box(0.038, 0.004, 0.008, M.gunmetal, 0, 0.058, mzZ - 0.02 + i * 0.02));
    // magazine with ribs
    const magH = kind === 'smg' ? 0.2 : 0.18;
    const mag = new THREE.Group(); mag.position.set(0, -0.03, -0.1); mag.rotation.x = kind === 'smg' ? 0.05 : 0.28; g.add(mag);
    mag.add(rb(0.036, magH, 0.075, kind === 'carbine' ? M.polymer : M.gunmetal, 0, -magH / 2, 0, 0.006));
    for (let i = 0; i < 4; i++) mag.add(box(0.038, 0.006, 0.06, M.polymer, 0, -0.03 - i * magH / 5, 0));
    // pistol grip + trigger guard
    const grip = rb(0.036, 0.11, 0.05, furn, 0, -0.07, 0.07, 0.01); grip.rotation.x = -0.32; g.add(grip);
    g.add(box(0.008, 0.008, 0.07, M.gunmetal, 0, -0.04, 0.01));
    // stock: buffer tube + adjustable stock
    const tube = cyl(0.016, 0.016, 0.16, M.gunmetal, 12); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.04, 0.19); g.add(tube);
    g.add(rb(0.05, 0.09, 0.17, furn, 0, 0.02, 0.27, 0.012));
    g.add(rb(0.054, 0.12, 0.025, M.polymer, 0, 0.0, 0.36, 0.008));
    // reflex sight
    g.add(rb(0.036, 0.028, 0.07, M.polymer, 0, 0.108, -0.04, 0.006));
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 16, 1, true), M.polymer); hood.rotation.x = Math.PI / 2; hood.position.set(0, 0.14, -0.05); g.add(hood);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 16), M.glass); lens.position.set(0, 0.14, -0.06); g.add(lens);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); dot.position.set(0, 0.14, -0.058); g.add(dot);
    // front grip on the carbine
    if (kind === 'carbine') { const fg = cyl(0.014, 0.016, 0.08, M.polymer, 10); fg.position.set(0, -0.02, hgZ - 0.03); g.add(fg); }
    g.userData.muzzle = new THREE.Vector3(0, 0.04, mzZ - 0.04);
    g.userData.sightY = 0.14;
  } else if (kind === 'marksman') {
    const m = models.bolt_action_rifle_7_62 ? normalizeModel(models.bolt_action_rifle_7_62.scene, 1.12) : box(0.05, 0.08, 1.1, M.tan);
    m.position.z = -0.2; g.add(m);
    // scope
    const sc = cyl(0.022, 0.022, 0.3, M.gunmetal, 14); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.1, -0.12); g.add(sc);
    const fr = cyl(0.03, 0.022, 0.06, M.gunmetal, 14); fr.rotation.x = Math.PI / 2; fr.position.set(0, 0.1, -0.29); g.add(fr);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.78);
    g.userData.sightY = 0.1;
  } else if (kind === 'pistol') {
    const m = models.service_pistol ? normalizeModel(models.service_pistol.scene, 0.2) : box(0.03, 0.12, 0.2, M.gunmetal);
    g.add(m);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.12);
    g.userData.sightY = 0.06;
  } else if (kind === 'grenade') {
    const m = models.stick_grenade ? normalizeModel(models.stick_grenade.scene, 0.35) : cyl(0.03, 0.03, 0.3, M.tan);
    m.rotation.x = -0.6; g.add(m);
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
    g.userData.sightY = 0.05;
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------- vehicles ----------------
export function makePlane() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x5d6553, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 0.4, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0e1620, roughness: 0.05, metalness: 0.9 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 26, 24), paint); fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), paint); nose.rotation.x = -Math.PI / 2; nose.scale.set(1, 1.6, 1); nose.position.z = -13; g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.7, 9, 24), paint); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.9, 17.4); g.add(tail);
  const cock = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.6), glass); cock.position.set(0, 1.4, -14.2); cock.rotation.x = 0.4; g.add(cock);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(40, 0.45, 5.2), paint); wing.position.set(0, 2.0, -2); g.add(wing);
  const hs = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 3), paint); hs.position.set(0, 2.2, 20.5); g.add(hs);
  const vs = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 4.5), paint); vs.position.set(0, 5.2, 20.5); vs.rotation.x = -0.3; g.add(vs);
  g.userData.props = [];
  for (const x of [-12, -6, 6, 12]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.75, 4.6, 14), dark); n.rotation.x = Math.PI / 2; n.position.set(x, 1.5, -3.6); g.add(n);
    const prop = new THREE.Group(); prop.position.set(x, 1.5, -6.05);
    for (let b = 0; b < 4; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.06), dark); bl.rotation.z = b * Math.PI / 2; prop.add(bl); }
    g.add(prop); g.userData.props.push(prop);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.2, 5), dark); door.position.set(0, -2.2, 16); door.rotation.x = -0.35; g.add(door);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

export function makeParachute(seed = 1) {
  const g = new THREE.Group();
  const r = mulberry32(seed);
  const cols = [[0x6b7a4e, 0xc9c2a8], [0x8a5a3a, 0xd8cfb5], [0x3e5a6e, 0xd0d6d0], [0x5a5a5a, 0xb53f2c]][Math.floor(r() * 4)];
  const segs = 14;
  for (let i = 0; i < segs; i++) {
    const geo = new THREE.SphereGeometry(4.2, 3, 8, i / segs * Math.PI * 2, Math.PI * 2 / segs, 0, Math.PI * 0.32);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[i % 2], roughness: 0.8, side: THREE.DoubleSide }));
    m.scale.set(1.25, 0.55, 0.85); m.castShadow = true;
    g.add(m);
  }
  g.children.forEach(c => (c.position.y = 5.2 - 4.2 * 0.55));
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    pts.push(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(Math.cos(a) * 4.4, 4.05, Math.sin(a) * 3.0));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 })));
  return g;
}

export function makeArmorPickup(kind, level) {
  const M = mats();
  const g = new THREE.Group();
  if (kind === 'vest') {
    g.add(box(0.42, 0.06, 0.5, level >= 2 ? M.vest2 : M.vest, 0, 0.03, 0));
    for (let i = -1; i <= 1; i++) g.add(box(0.1, 0.05, 0.12, M.vest, i * 0.12, 0.07, 0.12));
  } else if (kind === 'helmet') {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), level >= 2 ? M.helmet2 : M.helmet);
    h.castShadow = true; g.add(h);
  } else if (kind === 'bandage') {
    const b = cyl(0.04, 0.04, 0.08, new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 })); b.rotation.z = Math.PI / 2; b.position.y = 0.04; g.add(b);
  }
  return g;
}
