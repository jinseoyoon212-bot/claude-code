import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildMap, skyMaterial, HALF } from './map.js';
import { moveBody, rayWorld, rayBox, raySphere, lineOfSight, makeBox } from './physics.js';
import { WEAPONS, buildViewmodel } from './weapons.js';
import { Bot, NAMES } from './bots.js';
import { Particles, Tracers, Decals, Casings, Spring } from './fx.js';
import * as A from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const QUALITY = { high: { pr: 2, shadow: 2048, bloom: true }, med: { pr: 1.5, shadow: 1536, bloom: true }, low: { pr: 1, shadow: 1024, bloom: false } };
const SCORE_LIMIT = 25, MATCH_TIME = 300, BOT_COUNT = 9;

// ======================= Renderer / scene =======================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
let qual = QUALITY.med;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x6a3a58, 55, 250);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 900);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.01, 10);

// sky + image based lighting
const skyMat = skyMaterial();
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat); sky.frustumCulled = false; scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const env = pm.fromScene(s, 0.02, 1, 1000).texture;
  scene.environment = env; scene.environmentIntensity = 0.65;
  vmScene.environment = env; vmScene.environmentIntensity = 0.9;
  pm.dispose();
}
scene.add(new THREE.HemisphereLight(0x9aa8ff, 0x40283f, 0.8));
const sunDir = skyMat.uniforms.sun.value.clone().normalize();
const sun = new THREE.DirectionalLight(0xffb078, 3.0);
sun.position.copy(sunDir).multiplyScalar(120);
sun.castShadow = true; sun.shadow.camera.left = -58; sun.shadow.camera.right = 58; sun.shadow.camera.top = 58; sun.shadow.camera.bottom = -58;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 280; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4fa8ff, 0.5); fill.position.set(60, 40, 60); scene.add(fill);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 16, 2); scene.add(muzzleLight);

vmScene.add(new THREE.HemisphereLight(0xbcc8ff, 0x2a2030, 1.1));
const vmSun = new THREE.DirectionalLight(0xffd2a8, 2.4); vmSun.position.set(-0.6, 1, 0.5); vmScene.add(vmSun);
const vmRim = new THREE.DirectionalLight(0x35e0ff, 1.6); vmRim.position.set(0.8, 0.2, 1); vmScene.add(vmRim);
vmScene.add(vmCam);

const world = buildMap(scene, 'med');
const boxes = world.boxes;

// composer
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const vmPass = new RenderPass(vmScene, vmCam); vmPass.clear = false; vmPass.clearDepth = true; composer.addPass(vmPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.6, 1.0);
composer.addPass(bloom); composer.addPass(new OutputPass());

function applyQuality(name) {
  qual = QUALITY[name] || QUALITY.med;
  renderer.setPixelRatio(Math.min(devicePixelRatio, qual.pr)); composer.setPixelRatio(Math.min(devicePixelRatio, qual.pr));
  sun.shadow.mapSize.set(qual.shadow, qual.shadow);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  bloom.enabled = qual.bloom;
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = vmCam.aspect = w / h; camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ======================= FX =======================
const addP = new Particles(scene, 1800, THREE.AdditiveBlending);
const smokeP = new Particles(scene, 500, THREE.NormalBlending);
const tracers = new Tracers(scene);
const decals = new Decals(scene);
const casings = new Casings(scene);

function sparks(p, n, nrm, col, speed = 5, size = 0.07) {
  for (let i = 0; i < n; i++) {
    const s = speed * (0.4 + Math.random());
    addP.emit(p.x, p.y, p.z, nrm.x * s + rnd(-1, 1) * speed * 0.5, nrm.y * s + rnd(-0.2, 1) * speed * 0.5, nrm.z * s + rnd(-1, 1) * speed * 0.5,
      rnd(0.2, 0.55), size, 0.01, [col[0], col[1], col[2], 1], [col[0] * 0.4, col[1] * 0.2, col[2] * 0.1, 0], 12, 1.2);
  }
}
function puff(p, nrm, n = 3) {
  for (let i = 0; i < n; i++) smokeP.emit(p.x, p.y, p.z, nrm.x * 0.8 + rnd(-.4, .4), nrm.y * 0.8 + rnd(0, .6), nrm.z * 0.8 + rnd(-.4, .4),
    rnd(0.5, 0.9), 0.2, 0.9, [0.55, 0.5, 0.52, 0.28], [0.4, 0.38, 0.42, 0], -0.2, 2.5);
}
function flashAt(p, size = 0.4, col = [3, 2.2, 1]) {
  addP.emit(p.x, p.y, p.z, 0, 0, 0, 0.07, size, size * 0.3, [col[0], col[1], col[2], 1], [1, 0.4, 0.1, 0]);
}

// ======================= Game state =======================
const P = {
  id: 0, name: 'YOU', isPlayer: true, x: 0, y: 0, z: 30, vx: 0, vy: 0, vz: 0, r: 0.4, h: 1.8, onGround: false,
  yaw: 0, pitch: 0, hp: 100, alive: true, kills: 0, deaths: 0, protT: 0, recoilPitch: 0, recoilYaw: 0, deathT: 0, lastHurt: -99, streak: 0,
};
const combatants = [P];
const game = {
  scene, boxes, nav: world.nav, combatants, player: P,
  los: (ax, ay, az, bx, by, bz) => lineOfSight(boxes, ax, ay, az, bx, by, bz),
  botShoot, respawn,
};
let state = 'menu', matchT = MATCH_TIME, time = 0;
const stats = { shots: 0, hits: 0, heads: 0 };

// viewmodels + weapon state
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);
const vms = WEAPONS.map(w => { const v = buildViewmodel(w.id); v.group.visible = false; vmRoot.add(v.group); return v; });
const ws = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }));
let cur = 0, switchT = 0, reloading = false, reloadT = 0, fireCd = 0, fireBuf = 0, adsT = 0, sprintT = 0, bloomSp = 0;
let mouseDown = false, adsHeld = false, flashT = 0, muzzleLightT = 0;
const keys = {};
let mdx = 0, mdy = 0, sens = 1;
vms[0].group.visible = true;

// view springs
const kickZ = new Spring(160, 14), kickRot = new Spring(180, 15), swayX = new Spring(90, 11), swayY = new Spring(90, 11);
const dip = new Spring(220, 18), rollS = new Spring(80, 12), fovKick = new Spring(120, 13);
let bobT = 0, stepAcc = 0, shake = 0, curFov = 78, spreadNow = 0.02;

// ======================= Match control =======================
function makeBots() {
  for (const c of combatants.slice(1)) { scene.remove(c.root); }
  combatants.length = 1;
  for (let i = 0; i < BOT_COUNT; i++) {
    const b = new Bot(game, i + 1, NAMES[i % NAMES.length], (i / BOT_COUNT + 0.02) % 1, rnd(0.55, 0.95));
    combatants.push(b);
  }
}
makeBots();

function pickSpawn(c) {
  const sp = world.spawns.map(([x, z]) => {
    let md = 1e9;
    for (const o of combatants) if (o !== c && o.alive) md = Math.min(md, Math.hypot(o.x - x, o.z - z));
    return { x, z, d: md + Math.random() * 6 };
  }).sort((a, b) => b.d - a.d);
  return sp[(Math.random() * Math.min(3, sp.length)) | 0];
}
function respawn(c) {
  const s = pickSpawn(c);
  if (c.isPlayer) {
    Object.assign(P, { x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, hp: 100, alive: true, protT: 2, recoilPitch: 0, recoilYaw: 0, deathT: 0 });
    P.yaw = Math.atan2(-s.x, -s.z); P.pitch = 0;
    ws.forEach((s2, i) => { s2.mag = WEAPONS[i].mag; s2.reserve = WEAPONS[i].reserve; });
    reloading = false; A.sndSpawn();
  } else c.spawn(s.x, s.z);
}
function resetMatch() {
  makeBots();
  P.kills = P.deaths = 0; P.streak = 0; stats.shots = stats.hits = stats.heads = 0;
  respawn(P);
  for (const b of combatants.slice(1)) respawn(b);
  matchT = MATCH_TIME; $('killfeed').innerHTML = ''; setWeapon(0, true); banner('FIGHT!');
  updateScoreHud(true);
}

function banner(t, color) {
  const b = $('banner'); b.textContent = t; b.style.textShadow = `0 0 22px ${color || 'var(--a)'}`; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function feed(killer, victim, head) {
  const d = document.createElement('div');
  d.className = 'kf' + (killer.isPlayer ? ' me' : victim.isPlayer ? ' died' : '');
  d.innerHTML = `${killer.name}<i>${head ? '◎' : '✕'}</i>${victim.name}`;
  const f = $('killfeed'); f.appendChild(d); if (f.children.length > 5) f.firstChild.remove();
  setTimeout(() => d.remove(), 5000);
}

// ======================= Combat =======================
const _nrm = { x: 0, y: 0, z: 0 };
const tmpBox = makeBox(0, 0, 0, 0, 0, 0);
function castRay(owner, ox, oy, oz, dx, dy, dz, range) {
  let t = rayWorld(boxes, ox, oy, oz, dx, dy, dz, range, _nrm);
  const res = { t: t < 0 ? range : t, target: null, head: false, nx: _nrm.x, ny: _nrm.y, nz: _nrm.z, world: t >= 0 };
  for (const c of combatants) {
    if (c === owner || !c.alive) continue;
    const hs = raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y + 1.64, c.z, 0.27, res.t);
    tmpBox.minX = c.x - 0.36; tmpBox.maxX = c.x + 0.36; tmpBox.minZ = c.z - 0.36; tmpBox.maxZ = c.z + 0.36; tmpBox.minY = c.y; tmpBox.maxY = c.y + 1.45;
    const bt = rayBox(ox, oy, oz, dx, dy, dz, tmpBox, res.t, null);
    if (hs >= 0 && hs < res.t) { res.t = hs; res.target = c; res.head = true; res.world = false; }
    else if (bt >= 0 && bt < res.t) { res.t = bt; res.target = c; res.head = false; res.world = false; }
  }
  return res;
}
function panFor(x, z) {
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz) || 1;
  return { pan: (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / d, vol: clamp(1 - d / 70, 0.05, 1) * (d < 3 ? 1 : 0.8) };
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _c = new THREE.Color();

function damage(target, amount, attacker, head, fromX, fromZ) {
  if (!target.alive || target.protT > 0) return false;
  target.hp -= amount;
  if (target.isPlayer) {
    P.lastHurt = time; A.sndHurt(); shake = Math.min(1.5, shake + amount * 0.02);
    $('dmg').classList.add('hit'); setTimeout(() => $('dmg').classList.remove('hit'), 60);
    const ang = Math.atan2(-(fromX - P.x), -(fromZ - P.z)) - P.yaw;
    const dd = document.createElement('div'); dd.className = 'dd'; dd.style.transform = `rotate(${-ang}rad)`; $('damageDirs').appendChild(dd); setTimeout(() => dd.remove(), 1200);
    rollS.kick((Math.random() - 0.5) * 2);
  } else target.onHurt(attacker);
  if (target.hp <= 0) {
    target.hp = 0; attacker.kills++; target.deaths += 0;
    if (target.isPlayer) { P.alive = false; P.deathT = 0; P.deaths++; P.streak = 0; banner(`${attacker.name} 에게 제압당했습니다`, 'var(--b)'); mouseDown = false; }
    else target.die();
    if (attacker.isPlayer) { P.streak++; A.sndKill(); banner(P.streak > 1 ? `${target.name} ELIMINATED · ${P.streak} STREAK` : `${target.name} ELIMINATED`); const s = ws[cur], w = WEAPONS[cur]; s.reserve = Math.min(w.reserve * 2, s.reserve + Math.ceil(w.mag / 2)); }
    feed(attacker, target, head);
    updateScoreHud();
    if (attacker.kills >= SCORE_LIMIT) endMatch();
  }
  return true;
}

function botShoot(b) {
  const spread = 0.012 + (1 - b.skill) * 0.03;
  const cp = Math.cos(b.pitch);
  _v1.set(-Math.sin(b.yaw) * cp + rnd(-1, 1) * spread, Math.sin(b.pitch) + rnd(-1, 1) * spread, -Math.cos(b.yaw) * cp + rnd(-1, 1) * spread).normalize();
  const ox = b.x, oy = b.y + 1.55, oz = b.z;
  const r = castRay(b, ox, oy, oz, _v1.x, _v1.y, _v1.z, 110);
  // visuals
  _v2.set(ox + (-Math.cos(b.yaw)) * -0.0 - Math.sin(b.yaw) * 0.55, oy - 0.2, oz - Math.cos(b.yaw) * 0.55);
  _v3.set(ox + _v1.x * r.t, oy + _v1.y * r.t, oz + _v1.z * r.t);
  _c.setHSL(b.hue, 1, 0.6).multiplyScalar(3);
  tracers.spawn(_v2, _v3, _c, 0.03, 7);
  flashAt(_v2, 0.45, [3, 2, 1]);
  const pv = panFor(b.x, b.z); A.sndShot('smg', pv.vol * 0.55, pv.pan);
  b.recoil = 1;
  if (r.target) {
    const dmg = r.head ? 15 : 8;
    const hit = damage(r.target, dmg, b, r.head, b.x, b.z);
    if (hit && r.target.isPlayer) { /* indicator handled in damage */ }
    sparks(_v3, 6, { x: -_v1.x, y: 0.3, z: -_v1.z }, [3, 1.2, 0.6], 4, 0.06);
  } else if (r.world) {
    const n = { x: r.nx, y: r.ny, z: r.nz };
    sparks(_v3, 4, n, [3, 2.2, 1], 4, 0.05); decals.add(_v3, n);
  }
}

function playerShoot() {
  const w = WEAPONS[cur], s = ws[cur], vm = vms[cur];
  s.mag--; fireCd = w.interval; stats.shots++;
  A.sndShot(w.id);
  camera.updateMatrixWorld(); vmScene.updateMatrixWorld(true);
  vm.muzzle.getWorldPosition(_v1); _v1.applyMatrix4(camera.matrixWorld);
  const mpos = _v1.clone();
  const fwd = _v2.set(0, 0, -1).applyQuaternion(camera.quaternion).clone();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const moving = Math.hypot(P.vx, P.vz) > 1;
  const scoped = w.scope && adsT > 0.85;
  let spread = lerp(w.hip, w.ads, adsT) + (moving ? w.moveSpread * (1 - adsT * 0.8) : 0) + (P.onGround ? 0 : 0.045) + bloomSp;
  if (scoped && !moving && P.onGround) spread = 0.0003;
  let anyHit = false, anyHead = false;
  const ex = camera.position.x, ey = camera.position.y, ez = camera.position.z;
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
    const dir = fwd.clone().addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
    const r = castRay(P, ex, ey, ez, dir.x, dir.y, dir.z, w.range);
    const hp3 = new THREE.Vector3(ex + dir.x * r.t, ey + dir.y * r.t, ez + dir.z * r.t);
    const start = mpos.clone().addScaledVector(dir, 0.3);
    tracers.spawn(start, hp3, _c.setRGB(w.color[0], w.color[1], w.color[2]).clone(), w.tr, w.pellets > 1 ? 4 : 9);
    if (r.target) {
      let dmg = w.dmg * (r.head ? w.head : 1);
      if (w.id === 'shotgun') dmg *= clamp(1.25 - r.t / 40, 0.3, 1);
      if (w.id === 'rifle' || w.id === 'smg') dmg *= clamp(1.15 - r.t / 150, 0.55, 1);
      const c = r.target; const hue = c.hue ?? 0.5;
      if (damage(c, dmg, P, r.head, P.x, P.z)) { anyHit = true; anyHead = anyHead || r.head; }
      _c.setHSL(hue, 1, 0.6).multiplyScalar(3.5);
      sparks(hp3, r.head ? 14 : 8, { x: -dir.x, y: 0.4, z: -dir.z }, [_c.r, _c.g, _c.b], 5, 0.07);
      flashAt(hp3, 0.3, [_c.r, _c.g, _c.b]);
    } else if (r.world) {
      const n = { x: r.nx, y: r.ny, z: r.nz };
      sparks(hp3, 7, n, [3.2, 2.2, 1], 5, 0.05); puff(hp3, n, 2); decals.add(hp3, n, w.pellets > 1 ? 0.15 : 0.24);
    }
  }
  if (anyHit) { stats.hits++; if (anyHead) stats.heads++; hitMarker(anyHead); A.sndHit(anyHead); }
  // recoil & feedback
  const k = 1 - adsT * 0.4;
  P.recoilPitch += w.kickP * k * (0.8 + Math.random() * 0.4); P.recoilYaw += (Math.random() - 0.5) * 2 * w.kickY * k;
  kickZ.kick(w.vmKick * 14 * (1 - adsT * 0.5)); kickRot.kick(w.vmKick * 9 * (1 - adsT * 0.4)); swayX.kick((Math.random() - 0.5) * 0.3); fovKick.kick(w.vmKick * 40);
  shake = Math.min(1.5, shake + w.shake * 0.35);
  bloomSp = Math.min(0.03, bloomSp + w.kickP * 0.9);
  flashT = 0.045; muzzleLightT = 0.07;
  muzzleLight.position.copy(mpos); muzzleLight.intensity = 38;
  flashAt(mpos, 0.22);
  for (let i = 0; i < 3; i++) addP.emit(mpos.x, mpos.y, mpos.z, fwd.x * 8 + rnd(-2, 2), fwd.y * 8 + rnd(-1, 2), fwd.z * 8 + rnd(-2, 2), 0.12, 0.05, 0.01, [3, 2, 0.8, 1], [1, 0.3, 0.1, 0], 0, 3);
  puff(mpos, { x: fwd.x, y: 0.2, z: fwd.z }, 1);
  if (w.id !== 'shotgun' || true) casings.eject(mpos.clone().addScaledVector(fwd, -0.5).addScaledVector(right, 0.08).addScaledVector(up, 0.02), right, up, w.id === 'shotgun');
  if (w.id === 'sniper') { setTimeout(() => A.sndReload(1), 450); }
  if (s.mag === 0 && s.reserve > 0) setTimeout(() => { if (state === 'playing' && ws[cur] === s && s.mag === 0) startReload(); }, 180);
}

function hitMarker(head) {
  const h = $('hitmarker'); h.classList.remove('on', 'head'); void h.offsetWidth; h.classList.add('on'); if (head) h.classList.add('head');
}

function startReload() {
  const w = WEAPONS[cur], s = ws[cur];
  if (reloading || s.mag >= w.mag || s.reserve <= 0 || switchT > 0.1) return;
  reloading = true; reloadT = 0; adsHeld = adsHeld; A.sndReload(0);
  $('reloadBar').classList.add('on');
}
function setWeapon(i, force) {
  if (!force && (i === cur || switchT > 0.25)) return;
  vms[cur].group.visible = false; cur = i; vms[cur].group.visible = true;
  switchT = 0.4; reloading = false; $('reloadBar').classList.remove('on'); fireCd = 0.15;
  A.sndSwitch(); buildSlots();
  $('scope').classList.add('hidden');
}
function buildSlots() {
  $('wslots').innerHTML = WEAPONS.map((w, i) => `<span class="${i === cur ? 'on' : ''}">${i + 1}</span>`).join('');
  $('wname').textContent = WEAPONS[cur].name;
}
buildSlots();

// ======================= Player update =======================
function updatePlayer(dt) {
  const w = WEAPONS[cur], s = ws[cur];
  if (!P.alive) {
    P.deathT += dt; if (P.deathT > 2.8) respawn(P);
    return;
  }
  if (P.protT > 0) P.protT -= dt;
  const fwdI = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), strI = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const sprinting = !!(keys.ShiftLeft || keys.ShiftRight) && fwdI > 0 && !adsHeld && !mouseDown && !reloading;
  let speed = sprinting ? 8.4 : adsHeld ? 3.8 : 6.2;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let wx = -sy * fwdI + cy * strI, wz = -cy * fwdI - sy * strI;
  const l = Math.hypot(wx, wz); if (l > 0) { wx /= l; wz /= l; }
  const acc = (P.onGround ? 75 : 13) * dt;
  P.vx += clamp(wx * speed - P.vx, -acc, acc); P.vz += clamp(wz * speed - P.vz, -acc, acc);
  if (keys.Space && P.onGround) { P.vy = 8.6; P.onGround = false; A.sndJump(); }
  moveBody(P, dt, boxes);
  P.x = clamp(P.x, -41.4, 41.4); P.z = clamp(P.z, -41.4, 41.4);
  if (P.landed) { dip.kick(-P.landed * 0.45); A.sndLand(); kickZ.kick(2); }
  const sp = Math.hypot(P.vx, P.vz);
  if (P.onGround && sp > 1.5) { stepAcc += sp * dt; if (stepAcc > (sprinting ? 2.9 : 2.3)) { stepAcc = 0; A.sndStep(sprinting ? 0.26 : 0.17, 0); } }
  sprintT = lerp(sprintT, sprinting && sp > 4 ? 1 : 0, Math.min(1, dt * 9));
  // regen
  if (time - P.lastHurt > 5 && P.hp < 100) P.hp = Math.min(100, P.hp + 28 * dt);
  // recoil recovery
  P.recoilPitch *= Math.max(0, 1 - dt * 7); P.recoilYaw *= Math.max(0, 1 - dt * 7);
  bloomSp = Math.max(0, bloomSp - dt * 0.09);

  // weapon timers
  fireCd -= dt; switchT -= dt; fireBuf -= dt;
  adsT = lerp(adsT, adsHeld && !sprinting && switchT < 0.2 ? 1 : 0, Math.min(1, dt * (w.scope ? 9 : 13)));
  if (reloading) {
    const prev = reloadT; reloadT += dt; const p = reloadT / w.reload;
    if (prev / w.reload < 0.45 && p >= 0.45) A.sndReload(1);
    if (prev / w.reload < 0.85 && p >= 0.85) A.sndReload(2);
    $('reloadBar').firstElementChild.style.width = Math.min(100, p * 100) + '%';
    if (reloadT >= w.reload) {
      const fill = Math.min(w.mag - s.mag, s.reserve); s.mag += fill; s.reserve -= fill; reloading = false; $('reloadBar').classList.remove('on');
    }
  }
  const wantShot = w.auto ? mouseDown : fireBuf > 0;
  if (wantShot && fireCd <= 0 && switchT <= 0 && !reloading) {
    if (s.mag > 0) { fireBuf = 0; playerShoot(); }
    else { fireBuf = 0; if (s.reserve > 0) startReload(); else { A.sndEmpty(); fireCd = 0.3; } }
  }
}

function updateCamera(dt) {
  const w = WEAPONS[cur];
  const sp = Math.hypot(P.vx, P.vz);
  const moveK = P.onGround ? clamp(sp / 6, 0, 1.4) : 0;
  bobT += dt * (3.2 + sp * 0.9) * (P.onGround ? 1 : 0.2);
  const bobY = Math.sin(bobT * 2) * 0.035 * moveK * (1 - adsT * 0.7), bobX = Math.cos(bobT) * 0.025 * moveK * (1 - adsT * 0.7);
  if (!P.alive) {
    const t = Math.min(1, P.deathT / 0.5);
    camera.position.set(P.x, P.y + lerp(1.62, 0.35, t), P.z);
    camera.rotation.set(P.pitch + t * 0.3, P.yaw, t * 0.9 * (Math.sign(Math.sin(P.deathT * 0 + 1)) || 1));
  } else {
    const dy = dip.update(dt);
    camera.position.set(P.x, P.y + 1.62 + bobY * 0.7 + dy, P.z);
    const strafeI = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const roll = rollS.update(dt);
    rollS.t = -strafeI * 0.012 * (P.onGround ? 1 : 0.4);
    const sh = shake * 0.006;
    camera.rotation.set(P.pitch + P.recoilPitch + bobY * 0.2 + (Math.random() - 0.5) * sh, P.yaw + P.recoilYaw + bobX * 0.1 + (Math.random() - 0.5) * sh, roll + (Math.random() - 0.5) * sh);
  }
  shake = Math.max(0, shake - dt * 5);
  const scoped = w.scope && adsT > 0.02;
  const baseFov = 78 + sprintT * 7;
  const adsFov = w.scope ? 78 * w.fov * 0.28 + 0 : baseFov * w.fov;
  const tf = lerp(baseFov, w.scope ? 18 : adsFov, adsT) + fovKick.update(dt);
  curFov = lerp(curFov, tf, Math.min(1, dt * 20)); camera.fov = curFov; camera.updateProjectionMatrix();
  void scoped;
  sky.position.copy(camera.position);
  // scope overlay
  const scopeOn = w.scope && adsT > 0.9 && P.alive;
  $('scope').classList.toggle('hidden', !scopeOn);
  vmRoot.visible = !scopeOn;
}

function updateViewmodel(dt, t) {
  const w = WEAPONS[cur], vm = vms[cur], g = vm.group;
  const sp = Math.hypot(P.vx, P.vz), moveK = P.onGround ? clamp(sp / 6, 0, 1.3) : 0;
  const ads = adsT;
  // mouse sway
  swayX.kick(-mdx * 0.0016); swayY.kick(mdy * 0.0016); mdx = mdy = 0;
  const sx = swayX.update(dt), sy = swayY.update(dt), kz = kickZ.update(dt), kr = kickRot.update(dt);
  let px = lerp(vm.hip[0], vm.ads[0], ads), py = lerp(vm.hip[1], vm.ads[1], ads), pz = lerp(vm.hip[2], vm.ads[2], ads);
  let rx = 0, ry = 0, rz = 0;
  const bobK = (1 - ads * 0.85);
  px += Math.cos(bobT) * 0.012 * moveK * bobK + sx * 0.5;
  py += Math.abs(Math.sin(bobT)) * -0.012 * moveK * bobK + sy * 0.5 + Math.sin(t * 1.5) * 0.0018;
  rz += sx * 1.6; rx += sy * 0.8; ry += sx * 0.5;
  // recoil
  pz += kz * 0.08; rx += kr * 0.12;
  // sprint pose
  px += -0.1 * sprintT; py += -0.06 * sprintT; pz += 0.02 * sprintT; ry += -0.75 * sprintT; rx += 0.25 * sprintT; rz += 0.2 * sprintT;
  // switch-in
  if (switchT > 0) { const k = clamp(switchT / 0.4, 0, 1); py -= 0.32 * k * k; rx -= 0.9 * k * k; }
  // reload
  if (reloading) {
    const p = clamp(reloadT / w.reload, 0, 1);
    const env = Math.sin(clamp(p * 1.05, 0, 1) * Math.PI);
    const e = Math.min(1, env * 2.2);
    py -= 0.1 * e; rz += 0.55 * e; rx += -0.35 * e; px -= 0.04 * e;
    if (vm.parts.mag) {
      const m = vm.parts.mag, b = m.userData.base;
      let off = 0, vis = true;
      if (p < 0.2) off = 0; else if (p < 0.4) { off = (p - 0.2) / 0.2 * 0.25; } else if (p < 0.55) { vis = false; } else if (p < 0.75) { off = 0.25 - (p - 0.55) / 0.2 * 0.25; }
      m.visible = vis; m.position.set(b.x, b.y - off, b.z);
    }
    if (vm.parts.pump) { const pp = vm.parts.pump, b = pp.userData.base; pp.position.z = b.z + Math.sin(p * Math.PI * 6) * 0.04; }
  } else {
    if (vm.parts.mag) { vm.parts.mag.visible = true; vm.parts.mag.position.copy(vm.parts.mag.userData.base); }
    if (vm.parts.pump) { const pp = vm.parts.pump, b = pp.userData.base; const k = clamp((w.interval - fireCd) / 0.5, 0, 1) < 1 && fireCd > 0 ? Math.sin(clamp(1 - fireCd / w.interval, 0, 1) * Math.PI) : 0; pp.position.z = b.z + 0.1 * k; }
    if (vm.parts.bolt) { const b = vm.parts.bolt, bb = b.userData.base; const k = fireCd > 0 && w.interval > 0.5 ? Math.sin(clamp(1 - fireCd / w.interval, 0, 1) * Math.PI) : 0; b.position.z = bb.z + 0.1 * k; b.position.x = bb.x - 0.03 * k; }
  }
  g.position.set(px, py, pz); g.rotation.set(rx, ry, rz);
  // flash
  const f = vm.parts.flash;
  if (flashT > 0) { flashT -= dt; f.visible = true; f.rotation.z = Math.random() * 6.28; f.scale.setScalar(0.6 + Math.random() * 0.4); } else f.visible = false;
  if (muzzleLightT > 0) { muzzleLightT -= dt; muzzleLight.intensity *= 0.55; if (muzzleLightT <= 0) muzzleLight.intensity = 0; }
}

// ======================= HUD =======================
const hud = { hp: -1, mag: -1, res: -1, t: -1, ms: -1, bs: -1 };
function updateScoreHud() {
  const best = combatants.slice(1).reduce((m, c) => Math.max(m, c.kills), 0);
  $('myScore').textContent = P.kills; $('botScore').textContent = best;
}
function updateHud(dt) {
  const hp = Math.ceil(P.hp);
  if (hp !== hud.hp) { hud.hp = hp; $('hpNum').textContent = hp; $('hpFill').style.width = hp + '%'; $('hpFill').style.background = hp < 30 ? 'linear-gradient(90deg,#ff2d6f,#ff7a9a)' : ''; }
  const s = ws[cur];
  if (s.mag !== hud.mag) { hud.mag = s.mag; $('mag').textContent = s.mag; $('ammo').classList.toggle('low', s.mag <= WEAPONS[cur].mag * 0.25); }
  if (s.reserve !== hud.res) { hud.res = s.reserve; $('reserve').textContent = s.reserve; }
  const tm = Math.max(0, Math.ceil(matchT)); if (tm !== hud.t) { hud.t = tm; $('timer').textContent = `${(tm / 60) | 0}:${String(tm % 60).padStart(2, '0')}`; }
  // crosshair
  const w = WEAPONS[cur], moving = Math.hypot(P.vx, P.vz) > 1;
  const target = lerp(w.hip, w.ads, adsT) + (moving ? w.moveSpread * (1 - adsT * 0.8) : 0) + (P.onGround ? 0 : 0.045) + bloomSp;
  spreadNow = lerp(spreadNow, target, Math.min(1, dt * 18));
  const px = spreadNow * (innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(curFov / 2));
  const ch = $('crosshair'); ch.style.setProperty('--g', clamp(px + 4, 4, 70) + 'px'); ch.classList.toggle('ads', adsT > 0.5);
  if (state === 'playing') $('hud').classList.toggle('hidden', false);
}
function buildScoreboard() {
  const rows = combatants.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  $('scoreboard').innerHTML = `<table><tr><th>PLAYER</th><th>K</th><th>D</th></tr>${rows.map(c => `<tr class="${c.isPlayer ? 'me' : ''}"><td>${c.name}</td><td>${c.kills}</td><td>${c.deaths}</td></tr>`).join('')}</table>`;
}

// ======================= Flow =======================
function endMatch() {
  if (state !== 'playing') return;
  state = 'ended'; document.exitPointerLock?.();
  const rows = combatants.slice().sort((a, b) => b.kills - a.kills);
  const rank = rows.indexOf(P) + 1;
  $('endTitle').textContent = rank === 1 ? 'VICTORY' : `RANK #${rank}`;
  $('endTitle').style.color = rank === 1 ? 'var(--y)' : '#fff';
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  $('endStats').textContent = `K ${P.kills}  /  D ${P.deaths}  ·  정확도 ${acc}%  ·  헤드샷 ${stats.heads}`;
  $('end').classList.remove('hidden'); $('hud').classList.add('hidden'); $('scoreboard').classList.add('hidden');
}
function lock() { try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch (e) { /* headless */ } }
function startGame() {
  qual = QUALITY[$('quality').value]; applyQuality($('quality').value);
  A.initAudio(); A.resumeAudio(); A.setVolume(+$('vol').value); sens = +$('sens').value;
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (state !== 'paused') { resetMatch(); A.sndStart(); }
  state = 'playing'; lock();
}
$('play').onclick = startGame;
$('again').onclick = () => { state = 'menu'; startGame(); };
$('sens').oninput = e => sens = +e.target.value;
$('vol').oninput = e => A.setVolume(+e.target.value);
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'playing') {
    state = 'paused'; mouseDown = false; adsHeld = false;
    $('menu').classList.remove('hidden'); $('play').textContent = 'RESUME'; $('hud').classList.add('hidden');
  }
});

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); if (state === 'playing') { buildScoreboard(); $('scoreboard').classList.remove('hidden'); } }
  if (state !== 'playing') return;
  if (e.code === 'KeyR') startReload();
  if (e.code >= 'Digit1' && e.code <= 'Digit4') setWeapon(+e.code.slice(5) - 1);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); });
addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  if (e.button === 0) { mouseDown = true; fireBuf = 0.2; }
  if (e.button === 2) adsHeld = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) adsHeld = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (state === 'playing') setWeapon((cur + (e.deltaY > 0 ? 1 : 3)) % 4); });
addEventListener('mousemove', e => {
  if (state !== 'playing' || document.pointerLockElement !== canvas) return;
  const w = WEAPONS[cur]; const zoom = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(39));
  const k = 0.0022 * sens * zoom * (w.scope && adsT > 0.5 ? 1 : 1);
  const mx = clamp(e.movementX, -160, 160), my = clamp(e.movementY, -160, 160);
  P.yaw -= mx * k; P.pitch = clamp(P.pitch - my * k, -1.5, 1.5);
  mdx += mx; mdy += my;
});

// ======================= Main loop =======================
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  if (state === 'playing') {
    matchT -= dt; if (matchT <= 0) endMatch();
    updatePlayer(dt);
    for (let i = 1; i < combatants.length; i++) combatants[i].update(dt);
  } else if (state === 'menu') {
    // cinematic idle camera orbit
    const a = time * 0.12;
    camera.position.set(Math.cos(a) * 30, 7 + Math.sin(time * 0.3) * 1.5, Math.sin(a) * 30);
    camera.lookAt(0, 2, 0); sky.position.copy(camera.position);
    vmRoot.visible = false;
  }
  if (state !== 'menu') { updateCamera(dt); if (state === 'ended') vmRoot.visible = false; else updateViewmodel(dt, time); }
  addP.update(dt, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  smokeP.update(dt, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  tracers.update(dt); casings.update(dt);
  if (state === 'playing') updateHud(dt);
  composer.render();
}
applyQuality('med');
resetMatch();
// menu backdrop: keep bots alive & visible while idle
frame();

window.__game = { P, combatants, game, get state() { return state; }, start: startGame, setWeapon, castRay, WEAPONS, ws };
