// Procedural characters, weapons, aircraft and parachute for Warbattle.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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

// Animated soldier built from the rigged character model (Idle / Walk / Run / TPose clips).
// Arms reach the held weapon with CCD inverse kinematics; legs use the same solver to crouch.
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
function ccd(chain, effector, target, iters = 8) {
  for (let it = 0; it < iters; it++) {
    for (const j of chain) {
      j.getWorldPosition(_v1);
      effector.getWorldPosition(_v2);
      const a = _v2.sub(_v1), b = _v3.copy(target).sub(_v1);
      if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) continue;
      a.normalize(); b.normalize();
      _q1.setFromUnitVectors(a, b);
      j.getWorldQuaternion(_q2);
      _q2.premultiply(_q1);
      j.parent.getWorldQuaternion(_q1).invert();
      j.quaternion.copy(_q1.multiply(_q2));
      j.updateMatrixWorld(true);
    }
    effector.getWorldPosition(_v2);
    if (_v2.distanceToSquared(target) < 1e-5) break;
  }
}

const TINTS = [0xffffff, 0xd8d2c0, 0xc4ccb4, 0xb8b8b8, 0xd6c3a5, 0xa9b3a0];
export class Soldier {
  static init(gltf) { Soldier.src = gltf.scene; Soldier.clips = gltf.animations; }
  constructor(seed = 1, isPlayer = false) {
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(Soldier.src);
    this.root.add(this.model);
    const tint = isPlayer ? 0xffffff : TINTS[seed % TINTS.length];
    this.model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        if (tint !== 0xffffff) { o.material = o.material.clone(); o.material.color.setHex(tint); }
        o.userData.soldier = this;
      }
    });
    const B = (n) => this.model.getObjectByName('mixamorig' + n) || this.model.getObjectByName('mixamorig:' + n);
    this.b = {
      hips: B('Hips'), spine: B('Spine'), spine1: B('Spine1'), spine2: B('Spine2'), neck: B('Neck'), head: B('Head'),
      lArm: B('LeftArm'), lFore: B('LeftForeArm'), lHand: B('LeftHand'), rArm: B('RightArm'), rFore: B('RightForeArm'), rHand: B('RightHand'),
      lUp: B('LeftUpLeg'), lLeg: B('LeftLeg'), lFoot: B('LeftFoot'), rUp: B('RightUpLeg'), rLeg: B('RightLeg'), rFoot: B('RightFoot'),
    };
    this.hipsRest = this.b.hips.position.clone();
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n) => Soldier.clips.find(c => c.name === n);
    this.act = {};
    for (const n of ['Idle', 'Walk', 'Run', 'TPose']) { const a = this.mixer.clipAction(clip(n)); a.play(); a.setEffectiveWeight(n === 'Idle' ? 1 : 0); this.act[n] = a; }
    this.mixer.update(Math.random() * 3);
    // the held weapon lives in world space; the game positions it every frame
    this.gunSocket = new THREE.Group();
    this.deadT = 0; this.headHidden = false;
    this.tmp = { lf: new THREE.Vector3(), rf: new THREE.Vector3(), t: new THREE.Vector3() };
  }

  setGear() {}   // gear shows in the HUD; the character model already wears armour and a visor

  setWeapon(obj) {
    this.gunSocket.clear();
    if (obj) this.gunSocket.add(obj);
  }

  hideHead(v) {
    this.headHidden = v;
    this.b.neck.scale.setScalar(v ? 0.001 : 1);   // helmet and visor are weighted to the neck
  }

  weights(w, dt) {
    const k = 1 - Math.exp(-dt * 8);
    for (const n in this.act) { const a = this.act[n]; a.setEffectiveWeight(lerpN(a.getEffectiveWeight(), w[n] || 0, k)); }
  }

  // s: {speed, crouch, pitch, dead, airborne, parachute, armed, aimYaw}
  animate(dt, s) {
    const b = this.b, sp = s.speed || 0;
    this.model.rotation.set(0, 0, 0); this.model.position.set(0, 0, 0);
    if (s.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 1.8);
      const t = this.deadT;
      this.weights({ Idle: 1 }, dt);
      if (t < 1) this.mixer.update(dt * 0.3);
      this.model.rotation.x = -Math.PI / 2 * (t * t);
      this.model.position.y = 0.15 * t;
      return;
    }
    this.deadT = 0;
    if (s.airborne && !s.parachute) {
      this.weights({ TPose: 1 }, dt); this.mixer.update(dt);
      this.model.rotation.x = Math.PI * 0.42; this.model.position.y = 0.9;
      return;
    }
    if (s.parachute) {
      this.weights({ Idle: 1 }, dt); this.mixer.update(dt);
      this.root.updateMatrixWorld(true);
      // hands up on the risers
      for (const [arm, fore, hand, side] of [[b.lArm, b.lFore, b.lHand, 1], [b.rArm, b.rFore, b.rHand, -1]]) {
        const t = this.root.localToWorld(this.tmp.t.set(0.22 * side, 2.15, 0.05));
        ccd([fore, arm], hand, t, 6);
      }
      return;
    }
    // locomotion blend
    const run = THREE.MathUtils.clamp((sp - 3.5) / 2.5, 0, 1), walk = THREE.MathUtils.clamp(sp / 2.5, 0, 1) * (1 - run);
    this.weights({ Idle: 1 - Math.max(walk, run), Walk: walk, Run: run }, dt);
    this.act.Walk.timeScale = s.crouch ? 0.7 : Math.max(0.6, sp / 1.6);
    this.act.Run.timeScale = Math.max(0.8, sp / 5.5);
    this.mixer.update(dt);
    if (this.headHidden) this.b.neck.scale.setScalar(0.001);   // the clips key bone scale, so re-apply after them
    this.root.updateMatrixWorld(true);
    // crouch: lower the hips and bend the legs back onto the feet
    const crouch = this.crouchK = lerpN(this.crouchK || 0, s.crouch ? 1 : 0, 1 - Math.exp(-dt * 10));
    if (crouch > 0.01) {
      b.lFoot.getWorldPosition(this.tmp.lf); b.rFoot.getWorldPosition(this.tmp.rf);
      const drop = 0.42 * crouch;
      const down = this.tmp.t.set(0, -drop, 0);
      b.hips.parent.worldToLocal(b.hips.getWorldPosition(_v1).add(down));
      b.hips.position.copy(_v1);
      b.hips.updateMatrixWorld(true);
      ccd([b.lLeg, b.lUp], b.lFoot, this.tmp.lf, 6);
      ccd([b.rLeg, b.rUp], b.rFoot, this.tmp.rf, 6);
    }
    // aim: lean the spine with the view pitch
    const p = s.pitch || 0;
    for (const bone of [b.spine, b.spine1, b.spine2]) bone.rotateX(-p / 3);
    b.neck.rotateX(-p * 0.15);
    this.root.updateMatrixWorld(true);
    // hands to the weapon
    const g = this.gunSocket.children[0];
    if (s.armed && g?.userData.grip && this.gunSocket.parent) {
      this.gunSocket.updateMatrixWorld(true);
      const rg = g.localToWorld(this.tmp.t.copy(g.userData.grip));
      ccd([b.rFore, b.rArm], b.rHand, rg, 10);
      const lg = g.localToWorld(this.tmp.t.copy(g.userData.fore));
      ccd([b.lFore, b.lArm], b.lHand, lg, 10);
      // hands follow the weapon's orientation
      this.gunSocket.getWorldQuaternion(_q2);
      for (const h of [b.rHand, b.lHand]) { h.parent.getWorldQuaternion(_q1).invert(); h.quaternion.copy(_q1.multiply(_q2)).multiply(HAND_FIX[h === b.rHand ? 0 : 1]); h.updateMatrixWorld(true); }
    }
  }

  // world-space chest point used to place the held weapon
  chest(out) { this.b.spine2.getWorldPosition(out); return out; }
  eye(out) { this.b.head.getWorldPosition(out); return out; }
}
// rotate the hand bone (fingers along +Y in Mixamo rigs) so the palm wraps the grip
const HAND_FIX = [
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2)),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)),
];
function lerpN(a, b, t) { return a + (b - a) * t; }

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
    g.userData.grip = new THREE.Vector3(0, -0.07, 0.08); g.userData.fore = new THREE.Vector3(0, 0.0, hgZ);
  } else if (kind === 'marksman') {
    const m = models.bolt_action_rifle_7_62 ? normalizeModel(models.bolt_action_rifle_7_62.scene, 1.12) : box(0.05, 0.08, 1.1, M.tan);
    m.position.z = -0.2; g.add(m);
    // scope
    const sc = cyl(0.022, 0.022, 0.3, M.gunmetal, 14); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.1, -0.12); g.add(sc);
    const fr = cyl(0.03, 0.022, 0.06, M.gunmetal, 14); fr.rotation.x = Math.PI / 2; fr.position.set(0, 0.1, -0.29); g.add(fr);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.78);
    g.userData.sightY = 0.1;
    g.userData.grip = new THREE.Vector3(0, -0.04, 0.12); g.userData.fore = new THREE.Vector3(0, -0.01, -0.32);
  } else if (kind === 'pistol') {
    const m = models.service_pistol ? normalizeModel(models.service_pistol.scene, 0.2) : box(0.03, 0.12, 0.2, M.gunmetal);
    g.add(m);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.12);
    g.userData.sightY = 0.06;
    g.userData.grip = new THREE.Vector3(0, -0.05, 0.04); g.userData.fore = new THREE.Vector3(-0.02, -0.06, 0.03);
  } else if (kind === 'smoke') {
    const can = cyl(0.032, 0.032, 0.13, new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 0.55, metalness: 0.4 }), 16); g.add(can);
    const band = cyl(0.033, 0.033, 0.02, new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.6 }), 16); band.position.y = 0.03; g.add(band);
    const top = cyl(0.02, 0.026, 0.02, M.gunmetal, 12); top.position.y = 0.075; g.add(top);
    g.add(box(0.012, 0.09, 0.008, M.gunmetal, 0.034, 0.03, 0));
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.1); g.userData.sightY = 0.05;
    g.userData.grip = new THREE.Vector3(0, 0, 0.03); g.userData.fore = new THREE.Vector3(-0.08, -0.04, 0.03);
  } else if (kind === 'grenade') {
    const m = models.stick_grenade ? normalizeModel(models.stick_grenade.scene, 0.35) : cyl(0.03, 0.03, 0.3, M.tan);
    m.rotation.x = -0.6; g.add(m);
    g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
    g.userData.sightY = 0.05;
    g.userData.grip = new THREE.Vector3(0, 0, 0.05); g.userData.fore = new THREE.Vector3(-0.1, -0.05, 0.05);
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
