import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { moveBody } from './physics.js';
import { buildBotGun } from './weapons.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export const NAMES = ['NOVA', 'BLITZ', 'VIPER', 'RAZOR', 'ECHO', 'ZEN', 'KUDO', 'MAVEN', 'DRIFT', 'PIXEL', 'ORBIT', 'TALON'];

function rb(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.22), mat);
  m.position.set(x, y, z); m.castShadow = true; return m;
}

export class Bot {
  constructor(game, id, name, hue, skill) {
    this.g = game; this.id = id; this.name = name; this.isPlayer = false;
    this.hue = hue; this.skill = skill;
    this.r = 0.4; this.h = 1.8;
    this.x = this.y = this.z = 0; this.vx = this.vy = this.vz = 0; this.onGround = false;
    this.yaw = 0; this.pitch = 0; this.hp = 100; this.alive = false;
    this.kills = 0; this.deaths = 0;
    this.path = []; this.target = null; this.lastSeen = null; this.loseT = 0; this.reactT = 0;
    this.scanT = rnd(0, 0.3); this.fireT = 0; this.burst = 0; this.burstPause = 0;
    this.strafe = 1; this.strafeT = 0; this.stuckT = 0; this.lastX = 0; this.lastZ = 0;
    this.deathT = 0; this.protT = 0; this.phase = 0; this.jitterYaw = 0; this.jitterPitch = 0; this.jitterT = 0;
    this.moveYaw = 0; this.tagDirty = true; this.lastAttacker = null;
    this.buildMesh();
  }
  buildMesh() {
    const c = new THREE.Color().setHSL(this.hue, 0.75, 0.5);
    const armor = new THREE.MeshStandardMaterial({ color: c, metalness: 0.35, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f29, metalness: 0.5, roughness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(this.hue, 1, 0.55).multiplyScalar(3.2) });
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    this.legL.position.set(-0.14, 0.8, 0); this.legR.position.set(0.14, 0.8, 0);
    for (const l of [this.legL, this.legR]) { l.add(rb(0.21, 0.5, 0.23, dark, 0, -0.25, 0)); l.add(rb(0.22, 0.32, 0.25, armor, 0, -0.62, 0.01)); l.add(rb(0.23, 0.1, 0.34, dark, 0, -0.77, -0.04)); root.add(l); }
    root.add(rb(0.5, 0.2, 0.28, dark, 0, 0.84, 0));
    this.upper = new THREE.Group(); this.upper.position.y = 0.9; root.add(this.upper);
    this.upper.add(rb(0.54, 0.62, 0.32, armor, 0, 0.3, 0));
    this.upper.add(rb(0.3, 0.14, 0.02, glow, 0, 0.42, -0.165));
    this.upper.add(rb(0.58, 0.1, 0.34, dark, 0, 0.1, 0));
    this.head = new THREE.Group(); this.head.position.set(0, 0.8, 0); this.upper.add(this.head);
    this.head.add(rb(0.34, 0.34, 0.34, dark, 0, 0, 0));
    this.head.add(rb(0.28, 0.1, 0.03, glow, 0, 0.02, -0.17));
    this.head.add(rb(0.04, 0.12, 0.04, armor, 0.12, 0.2, 0.05));
    this.armL = new THREE.Group(); this.armR = new THREE.Group();
    this.armL.position.set(-0.36, 0.52, 0); this.armR.position.set(0.36, 0.52, 0);
    for (const a of [this.armL, this.armR]) { a.add(rb(0.17, 0.5, 0.17, armor, 0, -0.22, 0)); a.add(rb(0.18, 0.14, 0.18, dark, 0, -0.5, 0)); this.upper.add(a); }
    this.gun = buildBotGun(); this.gun.scale.setScalar(1.15); this.gun.position.set(0.12, 0.2, -0.42); this.upper.add(this.gun);
    this.root = root; root.visible = false; this.g.scene.add(root);
    root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // name tag
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; this.tagCanvas = cv;
    this.tagTex = new THREE.CanvasTexture(cv); this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, transparent: true, depthWrite: false }));
    this.tag.scale.set(1.6, 0.4, 1); this.tag.position.y = 2.35; root.add(this.tag);
  }
  drawTag() {
    const g = this.tagCanvas.getContext('2d'); g.clearRect(0, 0, 256, 64);
    g.font = '800 26px Rajdhani, Segoe UI, sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(this.name, 129, 27);
    g.fillStyle = '#fff'; g.fillText(this.name, 128, 26);
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(48, 38, 160, 10);
    const f = Math.max(0, this.hp / 100);
    g.fillStyle = f > 0.5 ? '#3df08a' : f > 0.25 ? '#ffd23f' : '#ff3d5a'; g.fillRect(49, 39, 158 * f, 8);
    this.tagTex.needsUpdate = true; this.tagDirty = false;
  }
  spawn(x, z) {
    this.x = x; this.y = 0; this.z = z; this.vx = this.vy = this.vz = 0;
    this.hp = 100; this.alive = true; this.protT = 2; this.path = []; this.target = null; this.lastSeen = null;
    this.deathT = 0; this.root.visible = true; this.root.rotation.set(0, 0, 0);
    this.yaw = this.moveYaw = Math.atan2(-x, -z) + rnd(-0.5, 0.5);
    this.tagDirty = true;
  }
  eye(out) { return out.set(this.x, this.y + 1.55, this.z); }
  die() {
    this.alive = false; this.deathT = 0; this.deaths++; this.path = []; this.target = null;
    this.tag.visible = false;
  }
  onHurt(attacker) {
    this.tagDirty = true;
    if (attacker && attacker.alive && attacker !== this) {
      this.lastAttacker = attacker;
      if (!this.target || !this.targetVisible) { this.lastSeen = { x: attacker.x, z: attacker.z }; this.loseT = 4; this.path = []; this.reactT = Math.max(this.reactT, 0.15); this.target = attacker; this.targetVisible = false; this.scanT = 0; }
    }
  }
  scan() {
    const g = this.g, ex = this.x, ey = this.y + 1.55, ez = this.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let best = null, bd = 1e9;
    for (const c of g.combatants) {
      if (c === this || !c.alive || (c.protT > 0 && c.protT > 1.4)) continue;
      const dx = c.x - this.x, dz = c.z - this.z, d = Math.hypot(dx, dz);
      if (d > 62) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      const engaged = this.target === c;
      if (dot < (engaged ? -0.6 : -0.15) && d > 6) continue; // FOV
      if (!g.los(ex, ey, ez, c.x, c.y + 1.2, c.z)) continue;
      const score = d * (engaged ? 0.6 : 1) * (c.isPlayer ? 0.9 : 1);
      if (score < bd) { bd = score; best = c; }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) this.reactT = rnd(0.2, 0.55) * (1.3 - this.skill);
      this.target = best; this.targetVisible = true; this.lastSeen = { x: best.x, z: best.z }; this.loseT = 3;
    } else if (this.target) {
      this.targetVisible = false;
    }
  }
  pickGoal() {
    const g = this.g;
    let gx, gz;
    const p = g.player;
    if (Math.random() < 0.4 && p.alive) { gx = p.x + rnd(-10, 10); gz = p.z + rnd(-10, 10); }
    else [gx, gz] = g.nav.randomCell([this.x, this.z], 18);
    const path = g.nav.findPath(this.x, this.z, gx, gz);
    this.path = path || [];
    this.goalWait = this.path.length ? 0 : 0.4;
  }
  follow(dt, speed) {
    if (!this.path.length) return false;
    const n = this.path[0];
    const dx = n[0] - this.x, dz = n[1] - this.z, d = Math.hypot(dx, dz);
    if (d < 0.55) { this.path.shift(); return this.path.length > 0; }
    this.vx = dx / d * speed; this.vz = dz / d * speed;
    this.moveYaw = Math.atan2(-dx, -dz);
    return true;
  }
  update(dt) {
    const g = this.g;
    if (!this.alive) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.45), e = 1 - Math.pow(1 - t, 3);
      this.root.rotation.x = -1.55 * e; this.root.position.y = this.y + 0.15 * e;
      this.root.rotation.y = this.yaw;
      if (this.deathT > 2.6) this.root.visible = false;
      if (this.deathT > 3.2) g.respawn(this);
      return;
    }
    if (this.protT > 0) this.protT -= dt;
    this.scanT -= dt; if (this.scanT <= 0) { this.scanT = rnd(0.18, 0.3); this.scan(); }
    this.vx *= 0.0; this.vz *= 0.0;
    const spd = 5.2 + this.skill * 0.8;
    const tgt = this.target && this.target.alive ? this.target : null;
    if (!tgt) this.target = null;
    this.jitterT -= dt; if (this.jitterT <= 0) { this.jitterT = rnd(0.25, 0.6); const a = 0.045 * (1.25 - this.skill); this.jitterYaw = rnd(-a, a); this.jitterPitch = rnd(-a, a) * 0.7; }

    let moving = false, aimYaw = this.yaw, aimPitch = this.pitch, wantFire = false;
    if (tgt && this.targetVisible) {
      const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
      const dy = (tgt.y + 1.25) - (this.y + 1.55);
      aimYaw = Math.atan2(-dx, -dz) + this.jitterYaw;
      aimPitch = Math.atan2(dy, d) + this.jitterPitch;
      // movement: strafe + range keeping
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rnd(0.5, 1.4); this.strafe = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.12 && this.onGround) this.vy = 8.6; }
      const fwd = d > 22 ? 1 : d < 8 ? -1 : 0;
      const nx = dx / (d || 1), nz = dz / (d || 1);
      this.vx = (nz * -this.strafe * 0.7 + nx * fwd * 0.6) * spd; // strafe perpendicular
      this.vz = (-nx * -this.strafe * 0.7 + nz * fwd * 0.6) * spd;
      this.vx = (-nz * this.strafe * 0.75 + nx * fwd * 0.65) * spd;
      this.vz = (nx * this.strafe * 0.75 + nz * fwd * 0.65) * spd;
      moving = true; this.moveYaw = this.yaw;
      this.reactT -= dt;
      const eY = Math.abs(angDiff(this.yaw, aimYaw)), eP = Math.abs(aimPitch - this.pitch);
      wantFire = this.reactT <= 0 && eY < 0.12 && eP < 0.14 && d < 70;
    } else if (tgt && this.lastSeen && this.loseT > 0) {
      // chase last known position
      this.loseT -= dt;
      if (!this.path.length) { const p = this.g.nav.findPath(this.x, this.z, this.lastSeen.x, this.lastSeen.z); this.path = p || []; if (!p) this.loseT = 0; }
      moving = this.follow(dt, spd);
      aimYaw = this.moveYaw; aimPitch = 0;
      if (!moving || this.loseT <= 0) { this.target = null; this.path = []; }
    } else {
      this.goalWait = (this.goalWait || 0) - dt;
      if (!this.path.length && this.goalWait <= 0) this.pickGoal();
      moving = this.follow(dt, spd * 0.9);
      aimYaw = this.moveYaw; aimPitch = 0;
    }

    // turning
    const ts = (6 + this.skill * 6) * dt;
    const dyaw = angDiff(this.yaw, aimYaw); this.yaw += Math.max(-ts, Math.min(ts, dyaw));
    this.pitch += Math.max(-ts, Math.min(ts, aimPitch - this.pitch));

    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1) {
      const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
      if (moving && moved < 0.5) { if (this.onGround) this.vy = 8.6; this.path = []; this.strafe *= -1; }
      this.lastX = this.x; this.lastZ = this.z; this.stuckT = 0;
    }

    // firing in bursts
    this.fireT -= dt;
    if (this.burstPause > 0) this.burstPause -= dt;
    if (wantFire && this.fireT <= 0 && this.burstPause <= 0) {
      this.fireT = 0.14 + (1 - this.skill) * 0.07;
      g.botShoot(this);
      if (--this.burst <= 0) { this.burst = (3 + Math.random() * 4) | 0; this.burstPause = rnd(0.25, 0.75) * (1.4 - this.skill); }
    }

    moveBody(this, dt, g.boxes);
    if (this.landed > 12) this.vy = 0;
    // clamp inside arena
    this.x = Math.max(-41.4, Math.min(41.4, this.x)); this.z = Math.max(-41.4, Math.min(41.4, this.z));

    // ---- animation ----
    const sp = Math.hypot(this.vx, this.vz);
    this.phase += sp * dt * 1.9;
    const sw = Math.sin(this.phase) * Math.min(1, sp / 4) * 0.9;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.root.position.set(this.x, this.y + Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, sp / 4), this.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.upper.rotation.z = this.strafe * -0.04 * (tgt ? 1 : 0);
    this.head.rotation.x = this.pitch * 0.9;
    this.armR.rotation.x = -1.35 + this.pitch; this.armL.rotation.x = -1.3 + this.pitch;
    this.armR.rotation.z = -0.05; this.armL.rotation.z = 0.5;
    this.gun.rotation.x = this.pitch;
    this.gun.position.set(0.1, 0.18 + Math.sin(this.pitch) * -0.1, -0.4);
    if (this.recoil > 0) { this.recoil -= dt * 8; this.upper.rotation.x = Math.max(0, this.recoil) * 0.08; } else this.upper.rotation.x = 0;
    if (this.tagDirty) this.drawTag();
    this.tag.visible = true;
    // blink while spawn-protected
    this.root.visible = !(this.protT > 0 && Math.floor(this.protT * 12) % 2 === 0);
  }
}
