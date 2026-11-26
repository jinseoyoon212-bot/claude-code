// Warbattle — main game. Original battle royale built on three.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Effects } from './fx.js';
import { World, MAP_SIZE, HALF } from './world.js';
import { Soldier, makeWeapon, makePlane, makeParachute, makeArmorPickup } from './models.js';
import { Audio3D } from './audio.js';
import { clamp, lerp, mulberry32 } from './noise.js';

const $ = (id) => document.getElementById(id);
const V3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const GRAV = 18;

export const WEAPONS = {
  carbine: { name: 'KR-9 Carbine', ammo: '5.56', mag: 30, rpm: 720, dmg: 41, vel: 870, auto: true, spread: 0.014, ads: 0.0012, recoil: 0.011, reload: 2.4, zoom: 1.4, prim: true },
  smg: { name: 'VX-45 SMG', ammo: '9mm', mag: 32, rpm: 900, dmg: 27, vel: 380, auto: true, spread: 0.018, ads: 0.004, recoil: 0.007, reload: 2.0, zoom: 1.25, prim: true },
  marksman: { name: 'Halden M62', ammo: '7.62', mag: 5, rpm: 42, dmg: 88, vel: 790, auto: false, spread: 0.025, ads: 0.0002, recoil: 0.045, reload: 3.4, zoom: 4, prim: true, scope: true },
  pistol: { name: 'P-11 Sidearm', ammo: '9mm', mag: 15, rpm: 420, dmg: 31, vel: 360, auto: false, spread: 0.016, ads: 0.004, recoil: 0.022, reload: 1.6, zoom: 1.15, prim: false },
};
const AMMO_PACK = { '5.56': 30, '9mm': 30, '7.62': 10 };
const BOT_NAMES = ['Varga', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Novak', 'Haddad', 'Silva', 'Kowalski', 'Brennan', 'Ivanova', 'Mbeki', 'Castillo', 'Ferreira', 'Holm', 'Rahimi', 'Duarte', 'Petrov', 'Nakamura', 'Quinn', 'Achterberg', 'Sato', 'Vidal', 'Kaur', 'Reyes', 'Bauer', 'Osei', 'Larsen', 'Costa', 'Yilmaz', 'Abara', 'Lund', 'Marsh', 'Ortega', 'Pike', 'Voss', 'Wren', 'Zane', 'Ruiz', 'Hale'];

const ZONE_PHASES = [
  { delay: 150, shrink: 80, r: 430, dps: 0.6 },
  { delay: 75, shrink: 55, r: 250, dps: 1.2 },
  { delay: 60, shrink: 45, r: 140, dps: 2.5 },
  { delay: 50, shrink: 40, r: 70, dps: 5 },
  { delay: 40, shrink: 30, r: 30, dps: 8 },
  { delay: 30, shrink: 30, r: 0, dps: 12 },
];

class Game {
  constructor() {
    this.settings = loadSettings();
    this.audio = new Audio3D();
    this.keys = {};
    this.mouse = { dx: 0, dy: 0, fire: false, ads: false };
    this.touch = { mx: 0, my: 0, active: false };
    this.state = 'menu';
    this.clock = new THREE.Clock();
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.bindMenu();
  }

  // ---------------- boot ----------------
  bindMenu() {
    const s = this.settings;
    $('quality').value = s.quality; $('sens').value = s.sens; $('fov').value = s.fov; $('view').value = s.view; $('bots').value = s.bots;
    const sync = () => { $('sensVal').textContent = (+$('sens').value).toFixed(2); $('fovVal').textContent = $('fov').value + '°'; $('botsVal').textContent = $('bots').value; };
    ['sens', 'fov', 'bots'].forEach(id => $(id).addEventListener('input', sync)); sync();
    $('playBtn').addEventListener('click', () => this.boot());
    if (this.isTouch) document.body.classList.add('touch');
  }

  async boot() {
    const s = this.settings;
    s.quality = $('quality').value; s.sens = +$('sens').value; s.fov = +$('fov').value; s.view = $('view').value; s.bots = +$('bots').value;
    saveSettings(s);
    this.audio.start();
    $('menu').hidden = true; $('loading').hidden = false;
    if (this.world) { this.newMatch(); return; }
    try {
      await this.init();
    } catch (e) {
      console.error(e);
      $('loadtext').textContent = 'Could not start: ' + e.message + '. Check that WebGL 2 is enabled in this browser.';
      return;
    }
    this.newMatch();
  }

  progress(p, label) { $('loadbar').style.width = Math.round(p * 100) + '%'; if (label) $('loadtext').textContent = label; }

  async init() {
    const q = this.settings.quality;
    const renderer = new THREE.WebGLRenderer({ antialias: q === 'low', powerPreference: 'high-performance', stencil: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is not available');
    renderer.setPixelRatio(Math.min(devicePixelRatio, { low: 0.75, medium: 1, high: 1.5, ultra: 2 }[q]));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    $('view3d').appendChild(renderer.domElement);
    this.renderer = renderer;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.04, 3000);
    scene.add(this.camera);

    // ---- assets ----
    this.progress(0.02, 'Loading sky');
    const rgbe = new RGBELoader().setDataType(THREE.HalfFloatType).parse(await loadPacked('assets/hdri/sky.json'));
    const hdr = new THREE.DataTexture(rgbe.data, rgbe.width, rgbe.height, THREE.RGBAFormat, rgbe.type);
    Object.assign(hdr, { colorSpace: THREE.LinearSRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, flipY: true });
    hdr.needsUpdate = true;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.background = hdr;
    scene.backgroundIntensity = 1.0;
    const sky = analyzeHDR(hdr);
    this.sunDir = sky.sunDir;

    this.progress(0.08, 'Loading textures');
    const tl = new THREE.TextureLoader();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const loadTex = (url, srgb) => new Promise((res, rej) => tl.load(url, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, maxAniso); if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
    const texNames = ['grass', 'forest', 'rock', 'dirt', 'brick', 'plaster', 'concrete', 'wood', 'roof', 'bark'];
    const tex = {};
    await Promise.all(texNames.map(async n => { tex[n] = { diff: await loadTex(`assets/tex/${n}_diff.jpg`, true), nor: await loadTex(`assets/tex/${n}_nor.jpg`, false) }; }));

    this.progress(0.2, 'Loading models');
    const draco = new DRACOLoader(); draco.setDecoderPath('vendor/jsm/libs/draco/gltf/'); draco.setDecoderConfig({ type: 'js' });
    const gl = new GLTFLoader(); gl.setDRACOLoader(draco);
    // decode embedded textures through <img> elements (works under strict content policies)
    gl.register(parser => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'wb_img_textures' }; });
    const modelNames = ['soldier', 'fir_tree_01', 'island_tree_02', 'grass_medium_01', 'grass_medium_02', 'shrub_02', 'shrub_03', 'shrub_04', 'WoodenTable_03', 'wooden_stool_01', 'sofa_02', 'drawer_cabinet', 'steel_frame_shelves_01', 'wooden_bookshelf_worn', 'metal_office_desk', 'plastic_monobloc_chair_01', 'wooden_picnic_table', 'metal_trash_can', 'utility_box_01', 'fire_hydrant', 'old_bed_frame', 'wooden_barrels_01', 'Barrel_01', 'ammo_box', 'bolt_action_rifle_7_62', 'boulder_01', 'covered_car', 'dead_tree_trunk', 'fern_02', 'medical_box', 'metal_jerrycan_green', 'namaqualand_boulder_02', 'old_military_crate', 'old_tyre', 'rock_moss_set_01', 'service_pistol', 'shrub_01', 'stick_grenade', 'street_lamp_01', 'tree_stump_01', 'wooden_crate_01', 'wooden_military_crate'];
    const models = {}; let done = 0;
    await Promise.all(modelNames.map(async n => {
      const g = await gl.parseAsync(await loadPacked(`assets/models/${n}.json`), '');
      models[n] = g.scene; models[n].scene = g.scene;
      if (n === 'soldier') Soldier.init(g);
      this.progress(0.2 + 0.35 * (++done / modelNames.length), 'Loading models ' + done + '/' + modelNames.length);
    }));
    this.models = models;

    // ---- lighting ----
    const sun = new THREE.DirectionalLight(sky.sunColor, 4.2);
    const shadowSize = { low: 1024, medium: 2048, high: 4096, ultra: 4096 }[q];
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const ext = { low: 50, medium: 70, high: 90, ultra: 110 }[q];
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 900 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun; this.shadowExt = ext; this.shadowSize = shadowSize;
    const hemi = new THREE.HemisphereLight(0xbcd2e8, 0x4a4030, 0.25); scene.add(hemi);
    scene.fog = new THREE.FogExp2(sky.horizon, 0.0011);

    // ---- world ----
    this.progress(0.6, 'Building Kestrel Island');
    await tick();
    const world = new World(scene, { tex, models, renderer }, q, 7319);
    world.build((p) => this.progress(0.6 + p * 0.35, 'Building Kestrel Island'));
    this.world = world;
    // balance sky fill against direct sun so shadows read clearly
    scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (m.isMeshStandardMaterial && o !== world.water) m.envMapIntensity = 0.5; });
    if (world.grassUniforms) {
      world.grassUniforms.uSun.value.copy(this.sunDir);
      world.grassUniforms.uSunCol.value.copy(sky.sunColor).multiplyScalar(1.0);
      world.grassUniforms.uAmb.value.copy(sky.ambient);
      world.grassUniforms.fogColor.value.copy(scene.fog.color);
      world.grassUniforms.fogDensity.value = scene.fog.density;
    }

    // ---- post ----
    if (q !== 'low') {
      const pr = renderer.getPixelRatio(), w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
      const comp = new EffectComposer(renderer, rt);
      comp.renderTarget2.depthTexture = comp.renderTarget1.depthTexture;   // both buffers share the scene depth
      comp.addPass(new RenderPass(scene, this.camera));
      // ambient occlusion from the main depth buffer, so grass and leaves occlude correctly
      const ao = new GTAOPass(scene, this.camera, w, h, { depthTexture: comp.renderTarget1.depthTexture },
        { radius: 1.1, distanceExponent: 1.2, thickness: 2.5, scale: 1.25, samples: q === 'medium' ? 8 : 16, distanceFallOff: 1, screenSpaceRadius: false });
      ao.blendIntensity = 1.0;
      comp.addPass(ao);
      this.ao = ao;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.22, 0.5, 0.9);
      comp.addPass(this.bloom);
      this.grade = new ShaderPass(GRADE_SHADER);
      comp.addPass(this.grade);
      comp.addPass(new OutputPass());
      if (q === 'high' || q === 'ultra') comp.addPass(new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()));
      this.composer = comp;
    }

    this.setupFX();
    this.fx = new Effects(scene, this.world);
    this.fx.setFog(scene.fog.color, scene.fog.density);
    this.setupInput();
    this.setupZoneMesh();
    this.plane = makePlane(); scene.add(this.plane);
    addEventListener('resize', () => this.resize());
    this.progress(1, 'Ready');
    renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    if (!this.renderer) return;
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  // ---------------- match ----------------
  newMatch() {
    const scene = this.scene, world = this.world;
    // clear old
    for (const a of this.actors || []) { scene.remove(a.soldier.root, a.soldier.gunSocket); if (a.chute) scene.remove(a.chute); }
    for (const l of this.loot || []) scene.remove(l.mesh);
    for (const b of this.bullets || []) if (b.tracer) b.tracer.visible = false;
    for (const g of this.grenadesLive || []) scene.remove(g.mesh);
    this.actors = []; this.loot = []; this.bullets = []; this.grenadesLive = [];
    this.time = 0; this.ended = false; this.killfeed = [];
    $('killfeed').innerHTML = '';
    this.rand = mulberry32((Math.random() * 1e9) | 0);
    const rand = this.rand;
    // loot
    for (const spot of world.lootSpots) {
      const n = rand() < 0.75 ? 1 : 2;
      for (let i = 0; i < n; i++) this.spawnLoot(this.rollLoot(spot.tier), spot.pos.clone().add(new THREE.Vector3((rand() - 0.5) * 1.6, 0, (rand() - 0.5) * 1.6)));
    }
    // flight path
    const ang = rand() * Math.PI * 2;
    const off = (rand() - 0.5) * 500;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    this.flight = { a: perp.clone().multiplyScalar(off).addScaledVector(dir, -1050).setY(460), dir, speed: 72, len: 2100 };
    this.plane.visible = true;
    this.planeT = 0;
    // actors
    const player = this.makeActor(0, 'You', true);
    this.player = player;
    for (let i = 0; i < this.settings.bots; i++) this.makeActor(i + 1, BOT_NAMES[i % BOT_NAMES.length], false);
    for (const a of this.actors) {
      if (!a.isPlayer) {
        // choose a drop target near a town or a random spot
        const t = rand() < 0.8 ? world.towns[Math.floor(rand() * world.towns.length)] : { x: (rand() - 0.5) * 900, z: (rand() - 0.5) * 900, R: 40 };
        a.ai.drop = new THREE.Vector3(t.x + (rand() - 0.5) * t.R * 1.4, 0, t.z + (rand() - 0.5) * t.R * 1.4);
        const rel = a.ai.drop.clone().sub(this.flight.a); const along = clamp(rel.x * dir.x + rel.z * dir.z, 80, this.flight.len - 80);
        a.ai.jumpAt = along / this.flight.speed + (rand() - 0.5) * 6;
      }
    }
    // zone
    this.zone = { phase: -1, c: new THREE.Vector2(0, 0), r: 1150, c0: new THREE.Vector2(0, 0), r0: 1150, nc: null, nr: 1150, t: 0, stage: 'wait', dps: 0.4 };
    this.nextZone();
    this.viewMode = this.settings.view;
    this.camYaw = 0; this.camPitch = -0.3;
    $('loading').hidden = true; $('endscreen').hidden = true; $('hud').hidden = false;
    $('jumpPrompt').hidden = false;
    this.state = 'playing';
    this.toast('Board the transport. Press F to jump.');
    this.requestLock();
  }

  makeActor(id, name, isPlayer) {
    const soldier = new Soldier(id + 1, isPlayer);
    this.scene.add(soldier.root, soldier.gunSocket);
    const a = {
      id, name, isPlayer, soldier,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
      hp: 100, alive: true, state: 'plane', grounded: false, crouch: false, ads: false, lean: 0,
      armor: 0, armorHp: 0, helmet: 0, helmetHp: 0,
      weapons: [null, null, null], cur: -1, ammo: { '5.56': 0, '9mm': 0, '7.62': 0 },
      bandages: 0, medkits: 0, grenades: 0,
      lastShot: 0, reloadT: 0, healT: 0, healKind: null, boltT: 0,
      kills: 0, dmgDealt: 0, stepAcc: 0, recoil: 0, height: 1.78, freeT: 0,
      ai: isPlayer ? null : { state: 'drop', think: 0, enemy: null, react: 0, err: 0.06 + Math.random() * 0.05, strafe: 1, strafeT: 0, wp: null, stuckT: 0, lastPos: new THREE.Vector3(), skill: 0.4 + Math.random() * 0.6, burst: 0, engaged: 0, sees: false },
    };
    soldier.root.visible = false;
    this.actors.push(a);
    return a;
  }

  rollLoot(tier) {
    const r = this.rand();
    const wPool = tier >= 2 ? ['carbine', 'carbine', 'marksman', 'smg'] : ['pistol', 'smg', 'carbine', 'pistol', 'marksman'];
    if (r < 0.37) return { kind: 'weapon', sub: wPool[Math.floor(this.rand() * wPool.length)] };
    if (r < 0.6) return { kind: 'ammo', sub: ['5.56', '9mm', '7.62', '5.56', '9mm'][Math.floor(this.rand() * 5)] };
    if (r < 0.7) return { kind: this.rand() < 0.7 ? 'bandage' : 'medkit' };
    if (r < 0.8) return { kind: 'vest', lvl: tier >= 2 && this.rand() < 0.5 ? 2 : 1 };
    if (r < 0.9) return { kind: 'helmet', lvl: tier >= 2 && this.rand() < 0.5 ? 2 : 1 };
    return this.rand() < 0.5 ? { kind: 'grenade' } : { kind: 'smoke' };
  }

  lootMesh(item) {
    const M = this.models;
    let m;
    if (item.kind === 'weapon') { m = makeWeapon(item.sub, M); m.rotation.set(0, this.rand() * 6.28, Math.PI / 2); m.position.y = 0.04; const g = new THREE.Group(); g.add(m); m = g; }
    else if (item.kind === 'ammo') { m = M.ammo_box.clone(); m.scale.setScalar(0.9); }
    else if (item.kind === 'medkit') { m = M.medical_box.clone(); m.scale.setScalar(0.8); }
    else if (item.kind === 'grenade' || item.kind === 'smoke') { m = makeWeapon(item.kind === 'smoke' ? 'smoke' : 'grenade', M); m.rotation.z = Math.PI / 2; m.position.y = 0.04; const g = new THREE.Group(); g.add(m); m = g; }
    else m = makeArmorPickup(item.kind, item.lvl || 1);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return m;
  }

  spawnLoot(item, pos) {
    const g = this.world.groundAt(pos.x, pos.z, pos.y + 0.3, 0.6, 0);
    pos.y = Math.max(g, pos.y > g + 0.05 ? pos.y : g);
    item.mesh = this.lootMesh(item);
    item.mesh.position.copy(pos);
    item.mesh.rotation.y = this.rand() * 6.28;
    item.pos = pos;
    if (item.kind === 'weapon') item.mag = item.mag ?? Math.floor(WEAPONS[item.sub].mag * (0.3 + this.rand() * 0.7));
    if (item.kind === 'ammo') item.amount = item.amount ?? AMMO_PACK[item.sub];
    this.scene.add(item.mesh);
    this.loot.push(item);
  }

  itemLabel(it) {
    switch (it.kind) {
      case 'weapon': return WEAPONS[it.sub].name;
      case 'ammo': return `${it.sub} ammo ×${it.amount}`;
      case 'bandage': return 'Bandage';
      case 'medkit': return 'Field medkit';
      case 'vest': return `Plate carrier L${it.lvl}`;
      case 'helmet': return `Combat helmet L${it.lvl}`;
      case 'grenade': return 'Stick grenade';
      case 'smoke': return 'Smoke canister';
    }
  }

  pickup(a, it) {
    switch (it.kind) {
      case 'weapon': {
        const w = { kind: it.sub, mag: it.mag };
        let slot = WEAPONS[it.sub].prim ? (a.weapons[0] ? (a.weapons[1] ? (a.cur === 1 ? 1 : 0) : 1) : 0) : 2;
        const old = a.weapons[slot];
        a.weapons[slot] = w;
        if (!a.isPlayer) a.ammo[WEAPONS[it.sub].ammo] += WEAPONS[it.sub].mag * 2;   // bots carry a basic load-out with each gun
        if (old) this.spawnLoot({ kind: 'weapon', sub: old.kind, mag: old.mag }, a.pos.clone().add(new THREE.Vector3(0.6, 0, 0.3)));
        if (a.cur < 0 || a.cur === slot || !a.weapons[a.cur]) this.equip(a, slot);
        break;
      }
      case 'ammo': a.ammo[it.sub] += it.amount; break;
      case 'bandage': a.bandages += 3; break;
      case 'medkit': a.medkits += 1; break;
      case 'grenade': a.grenades += 1; break;
      case 'smoke': a.smokes = (a.smokes || 0) + 1; break;
      case 'vest': if (it.lvl < a.armor && a.armorHp > 0) return false; if (a.armor) this.spawnLoot({ kind: 'vest', lvl: a.armor }, a.pos.clone().add(new THREE.Vector3(-0.5, 0, 0.4))); a.armor = it.lvl; a.armorHp = it.lvl === 2 ? 220 : 160; break;
      case 'helmet': if (it.lvl < a.helmet && a.helmetHp > 0) return false; if (a.helmet) this.spawnLoot({ kind: 'helmet', lvl: a.helmet }, a.pos.clone().add(new THREE.Vector3(-0.5, 0, -0.4))); a.helmet = it.lvl; a.helmetHp = it.lvl === 2 ? 150 : 90; break;
    }
    a.soldier.setGear(a.armor, a.helmet);
    this.scene.remove(it.mesh);
    this.loot.splice(this.loot.indexOf(it), 1);
    if (a.isPlayer) { this.audio.click(1200, 0.06, 0.3); this.toast('Picked up ' + this.itemLabel(it)); }
    return true;
  }

  equip(a, slot) {
    if (!a.weapons[slot]) return;
    a.cur = slot; a.reloadT = 0; a.boltT = 0;
    const w = a.weapons[slot];
    a.soldier.setWeapon(makeWeapon(w.kind, this.models));
    if (a.isPlayer) this.buildViewModel();
  }

  // ---------------- zone ----------------
  nextZone() {
    const z = this.zone;
    z.phase++;
    const P = ZONE_PHASES[z.phase];
    if (!P) { z.stage = 'final'; return; }
    let nc;
    for (let i = 0; i < 40; i++) {
      const ang = this.rand() * Math.PI * 2, d = this.rand() * Math.max(0, (z.phase === 0 ? 300 : z.r - P.r));
      nc = new THREE.Vector2(z.c.x + Math.cos(ang) * d, z.c.y + Math.sin(ang) * d);
      if (this.world.getHeight(nc.x, nc.y) > 2) break;
    }
    z.nc = nc; z.nr = P.r; z.stage = 'wait'; z.t = P.delay; z.P = P;
    z.c0 = z.c.clone(); z.r0 = z.r;
  }

  updateZone(dt) {
    const z = this.zone;
    if (z.stage === 'final') return;
    z.t -= dt;
    if (z.stage === 'wait' && z.t <= 0) { z.stage = 'shrink'; z.t = z.P.shrink; this.toast('The firestorm is closing in'); }
    else if (z.stage === 'shrink') {
      const k = 1 - Math.max(0, z.t) / z.P.shrink;
      z.c.lerpVectors(z.c0, z.nc, k); z.r = lerp(z.r0, z.nr, k);
      z.dps = z.P.dps;
      if (z.t <= 0) { z.dps = z.P.dps; this.nextZone(); }
    }
    this.zoneMesh.position.set(z.c.x, 0, z.c.y);
    this.zoneMesh.scale.set(Math.max(z.r, 0.1), 1, Math.max(z.r, 0.1));
  }

  outsideZone(p) { return Math.hypot(p.x - this.zone.c.x, p.z - this.zone.c.y) > this.zone.r; }

  setupZoneMesh() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: this.world.uniforms.uTime },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
        void main(){ float a = atan(vW.z, vW.x);
          float s = sin(a*180.0 + vW.y*0.08 - uTime*1.5)*0.5+0.5;
          float h = smoothstep(1.0, 0.0, vUv.y);
          float flick = 0.75 + 0.25*sin(uTime*3.0 + a*40.0 + vW.y*0.2);
          vec3 c = mix(vec3(0.95,0.32,0.08), vec3(1.0,0.62,0.22), s);
          float dCam = distance(cameraPosition.xz, vW.xz);
          float near = smoothstep(520.0, 40.0, dCam);
          gl_FragColor = vec4(c, (0.18 + 0.14*s) * h * flick * near); }`,
    });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 700, 160, 1, true), mat);
    m.geometry.translate(0, 300, 0);
    m.renderOrder = 10; m.frustumCulled = false;
    this.scene.add(m); this.zoneMesh = m;
  }

  // ---------------- FX ----------------
  setupFX() {
    const mk = (additive) => {
      const cap = 3000;
      const geo = new THREE.BufferGeometry();
      const f = (n) => new THREE.BufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', f(3)); geo.setAttribute('aCol', f(4)); geo.setAttribute('aSize', f(1));
      geo.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uScale: { value: innerHeight / 2 }, uTex: { value: softDot() } },
        vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol; void main(){ vCol=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uScale/max(-mv.z,0.1); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'uniform sampler2D uTex; varying vec4 vCol; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vCol.rgb, vCol.a*t.a); }',
      });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
      this.scene.add(pts);
      return { pts, list: [], cap };
    };
    this.fxN = mk(false); this.fxA = mk(true);
    // decals
    this.decals = []; this.decalGeo = new THREE.CircleGeometry(0.035, 8);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x15110d, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    // tracers
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true).rotateX(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerPool = [];
    // muzzle flash light
    this.flashLight = new THREE.PointLight(0xffb060, 0, 14, 2); this.scene.add(this.flashLight);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flashSprite.scale.setScalar(0.35); this.flashSprite.visible = false;
    this.explLight = new THREE.PointLight(0xff8a3a, 0, 40, 2); this.scene.add(this.explLight);
  }

  particle(sys, p, v, col, size, life, grow = 0, grav = 0, drag = 0) {
    if (sys.list.length >= sys.cap) sys.list.shift();
    sys.list.push({ p: p.clone(), v: v.clone(), col, size, life, max: life, grow, grav, drag });
  }

  updateFX(dt) {
    for (const sys of [this.fxN, this.fxA]) {
      const L = sys.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const q = L[i];
        q.life -= dt;
        if (q.life <= 0) { L.splice(i, 1); continue; }
        q.v.y -= q.grav * dt; q.v.multiplyScalar(1 - q.drag * dt);
        q.p.addScaledVector(q.v, dt); q.size += q.grow * dt;
      }
      const g = sys.pts.geometry; const P = g.attributes.position.array, C = g.attributes.aCol.array, S = g.attributes.aSize.array;
      for (let i = 0; i < L.length; i++) {
        const q = L[i]; const k = q.life / q.max;
        P[i * 3] = q.p.x; P[i * 3 + 1] = q.p.y; P[i * 3 + 2] = q.p.z;
        C[i * 4] = q.col[0]; C[i * 4 + 1] = q.col[1]; C[i * 4 + 2] = q.col[2]; C[i * 4 + 3] = q.col[3] * Math.min(1, k * 1.5);
        S[i] = q.size;
      }
      g.setDrawRange(0, L.length);
      g.attributes.position.needsUpdate = g.attributes.aCol.needsUpdate = g.attributes.aSize.needsUpdate = true;
      sys.pts.material.uniforms.uScale.value = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * this.renderer.getPixelRatio();
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 400);
    this.explLight.intensity = Math.max(0, this.explLight.intensity - dt * 300);
    if (this.flashSprite.visible && (this.flashT -= dt) <= 0) this.flashSprite.visible = false;
  }

  impactFX(hit, dir) {
    const p = hit.point, n = hit.normal || UP;
    const r = Math.random;
    if (hit.type === 'water') {
      for (let i = 0; i < 10; i++) this.particle(this.fxN, p, new THREE.Vector3((r() - 0.5) * 1.5, 3 + r() * 4, (r() - 0.5) * 1.5), [0.8, 0.85, 0.88, 0.7], 0.08, 0.6, 0.1, 12);
      return;
    }
    const dust = hit.mat === 'wood' ? [0.42, 0.33, 0.22, 0.8] : hit.mat === 'metal' ? [0.5, 0.5, 0.5, 0.5] : hit.mat === 'ground' ? [0.45, 0.38, 0.28, 0.85] : [0.62, 0.58, 0.52, 0.8];
    for (let i = 0; i < 7; i++) {
      const v = n.clone().multiplyScalar(1.5 + r() * 3).add(new THREE.Vector3((r() - 0.5) * 1.6, r() * 1.2, (r() - 0.5) * 1.6));
      this.particle(this.fxN, p, v, dust, 0.12 + r() * 0.12, 0.6 + r() * 0.8, 0.9, 1.5, 2.5);
    }
    if (hit.mat === 'metal' || hit.mat === 'stone') for (let i = 0; i < 6; i++) {
      const v = n.clone().multiplyScalar(4 + r() * 6).add(new THREE.Vector3((r() - 0.5) * 6, (r() - 0.2) * 5, (r() - 0.5) * 6));
      this.particle(this.fxA, p, v, [1, 0.75, 0.35, 1], 0.03, 0.15 + r() * 0.25, 0, 9.8, 0);
    }
    if (p.distanceTo(this.camera.position) < 120) this.fx.dust(p, n, hit.mat);
    if (hit.type !== 'terrain') {
      const d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.position.copy(p).addScaledVector(n, 0.012);
      d.lookAt(p.clone().add(n));
      this.scene.add(d); this.decals.push(d);
      if (this.decals.length > 160) this.scene.remove(this.decals.shift());
    }
    const dist = p.distanceTo(this.camera.position);
    if (dist < 80) this.audio.impact(p, hit.mat);
  }

  bloodFX(p, dir) {
    const r = Math.random;
    for (let i = 0; i < 10; i++) this.particle(this.fxN, p, dir.clone().multiplyScalar(2 + r() * 3).add(new THREE.Vector3((r() - 0.5) * 2, r() * 1.5, (r() - 0.5) * 2)), [0.38, 0.03, 0.02, 0.9], 0.05 + r() * 0.06, 0.4 + r() * 0.3, 0.2, 9, 1);
    this.particle(this.fxN, p, new THREE.Vector3(0, 0.3, 0), [0.45, 0.06, 0.04, 0.55], 0.25, 0.5, 0.8, 0, 0);
  }

  explosion(p, owner) {
    const r = Math.random;
    this.fx.explosion(p);
    for (let i = 0; i < 40; i++) this.particle(this.fxA, p, new THREE.Vector3((r() - 0.5) * 18, r() * 14, (r() - 0.5) * 18), [1, 0.6, 0.25, 1], 0.4 + r() * 0.6, 0.25 + r() * 0.3, 2, 6, 3);
    for (let i = 0; i < 40; i++) this.particle(this.fxN, p.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3((r() - 0.5) * 7, 1 + r() * 6, (r() - 0.5) * 7), [0.22, 0.2, 0.18, 0.75], 1 + r() * 1.5, 2.5 + r() * 2.5, 2.2, -0.4, 1.4);
    for (let i = 0; i < 20; i++) this.particle(this.fxN, p, new THREE.Vector3((r() - 0.5) * 14, 4 + r() * 10, (r() - 0.5) * 14), [0.3, 0.25, 0.2, 1], 0.07, 1.4, 0, 12, 0.5);
    this.explLight.position.copy(p).y += 1.5; this.explLight.intensity = 400;
    const d = p.distanceTo(this.camera.position);
    this.audio.explosion(p, d);
    if (d < 40) this.shake = Math.max(this.shake || 0, (40 - d) / 40 * 1.2);
    for (const a of this.actors) {
      if (!a.alive || a.state !== 'ground') continue;
      const c = a.pos.clone(); c.y += 1;
      const dd = c.distanceTo(p);
      if (dd > 9) continue;
      const hit = this.world.raycast(p.clone().add(new THREE.Vector3(0, 0.3, 0)), c);
      if (hit && hit.dist < dd - 0.5) continue;
      this.damage(a, Math.round(130 * Math.pow(1 - dd / 9, 1.4)), owner, 'body', 'Stick grenade', true);
    }
  }

  // ---------------- combat ----------------
  fire(a, dir, origin) {
    const w = a.weapons[a.cur]; if (!w) return false;
    const W = WEAPONS[w.kind];
    const now = this.time;
    if (now - a.lastShot < 60 / W.rpm || a.reloadT > 0 || a.boltT > 0 || a.healT > 0) return false;
    if (w.mag <= 0) { if (a.isPlayer && !this.dryClick) { this.audio.dryFire(); this.dryClick = true; } return false; }
    w.mag--; a.lastShot = now;
    if (W.scope || w.kind === 'marksman') a.boltT = 60 / W.rpm;
    const moving = Math.hypot(a.vel.x, a.vel.z);
    let spread = (a.ads ? W.ads : W.spread) * (1 + moving * 0.12) * (a.crouch ? 0.75 : 1) * (a.grounded || !a.isPlayer ? 1 : 3);
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * 2 * spread; d.y += (Math.random() - 0.5) * 2 * spread; d.z += (Math.random() - 0.5) * 2 * spread;
    d.normalize();
    const b = { p: origin.clone(), v: d.multiplyScalar(W.vel), owner: a, dmg: W.dmg, kind: w.kind, life: 2.5, travelled: 0, whizzed: false };
    if (Math.random() < 0.45 || a.isPlayer) b.tracer = this.getTracer();
    this.bullets.push(b);
    // muzzle effects
    const mz = this.muzzleWorld(a);
    const dist = mz.distanceTo(this.camera.position);
    if (dist < 45 && w.kind !== 'marksman') {
      const gq = a.soldier.gunSocket.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(gq), rt = new THREE.Vector3(1, 0, 0).applyQuaternion(gq), up = new THREE.Vector3(0, 1, 0).applyQuaternion(gq);
      this.fx.casing(mz.clone().addScaledVector(fwd, -0.55).addScaledVector(rt, 0.04).addScaledVector(up, 0.03), rt, up);
    }
    if (dist < 90) this.fx.muzzleSmoke(mz, dir.clone().normalize());
    this.audio.shot(mz, w.kind, dist, a.isPlayer);
    if (dist < 120) {
      this.flashLight.position.copy(mz); this.flashLight.intensity = 30;
      for (let i = 0; i < 2; i++) this.particle(this.fxN, mz, new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5, (Math.random() - 0.5) * 0.4), [0.7, 0.7, 0.7, 0.18], 0.12, 0.9, 0.6, -0.2, 1);
      if (!(a.isPlayer && a.ads && WEAPONS[w.kind].scope)) { this.flashSprite.position.copy(mz); this.flashSprite.visible = true; this.flashT = 0.04; this.flashSprite.material.rotation = Math.random() * 6; if (!this.flashSprite.parent) this.scene.add(this.flashSprite); }
    }
    if (a.isPlayer) {
      this.recoilKick = (this.recoilKick || 0) + W.recoil;
      this.camPitch += W.recoil * (a.ads ? 0.55 : 0.8) * (a.crouch ? 0.8 : 1);
      this.camYaw += (Math.random() - 0.5) * W.recoil * 0.5;
      this.vmFlash = 0.05;
      if (w.mag === 0 && this.ammoFor(a) > 0) setTimeout(() => this.reload(a), 250);
    }
    return true;
  }

  muzzleWorld(a) {
    const g = a.soldier.gunSocket.children[0];
    if (g?.userData.muzzle) { a.soldier.gunSocket.updateMatrixWorld(true); return g.localToWorld(g.userData.muzzle.clone()); }
    return a.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
  }

  getTracer() {
    let t = this.tracerPool.find(t => !t.visible);
    if (!t) { t = new THREE.Mesh(this.tracerGeo, this.tracerMat); t.frustumCulled = false; this.scene.add(t); this.tracerPool.push(t); }
    t.visible = true; return t;
  }

  ammoFor(a) { const w = a.weapons[a.cur]; return w ? a.ammo[WEAPONS[w.kind].ammo] : 0; }

  reload(a) {
    const w = a.weapons[a.cur]; if (!w || a.reloadT > 0) return;
    const W = WEAPONS[w.kind];
    if (w.mag >= W.mag || a.ammo[W.ammo] <= 0) return;
    a.reloadT = W.reload; a.healT = 0; a.ads = false;
    if (a.isPlayer || a.pos.distanceTo(this.camera.position) < 30) this.audio.reload(W.reload);
  }

  finishReload(a) {
    const w = a.weapons[a.cur]; if (!w) return;
    const W = WEAPONS[w.kind];
    const need = W.mag - w.mag, take = Math.min(need, a.ammo[W.ammo]);
    w.mag += take; a.ammo[W.ammo] -= take;
  }

  startHeal(a) {
    if (a.healT > 0 || a.reloadT > 0) return;
    if (a.medkits > 0 && a.hp < 90) { a.healKind = 'medkit'; a.healT = 6; }
    else if (a.bandages > 0 && a.hp < 75) { a.healKind = 'bandage'; a.healT = 3.5; }
    else { if (a.isPlayer) this.toast(a.hp >= 75 && a.bandages ? 'Bandages only heal up to 75' : 'No medical supplies'); return; }
    a.healMax = a.healT; a.ads = false;
  }
  finishHeal(a) {
    if (a.healKind === 'medkit') { a.medkits--; a.hp = 100; } else { a.bandages--; a.hp = Math.min(75, a.hp + 15); }
    a.healKind = null;
  }

  throwGrenade(a, dir, smoke = false) {
    if (a.state !== 'ground') return;
    if (smoke) { if (!a.smokes) return; a.smokes--; } else { if (a.grenades <= 0) return; a.grenades--; }
    const mesh = makeWeapon(smoke ? 'smoke' : 'grenade', this.models); this.scene.add(mesh);
    const p = a.pos.clone().add(new THREE.Vector3(0, a.height - 0.2, 0)).addScaledVector(dir, 0.6);
    const v = dir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4, 0)).add(a.vel);
    this.grenadesLive.push({ mesh, p, v, t: smoke ? 1.8 : 4.2, smoke, owner: a, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0) });
  }

  updateGrenades(dt) {
    for (let i = this.grenadesLive.length - 1; i >= 0; i--) {
      const g = this.grenadesLive[i];
      g.t -= dt;
      g.v.y -= 9.81 * dt;
      const np = g.p.clone().addScaledVector(g.v, dt);
      const hit = this.world.raycast(g.p, np);
      if (hit) {
        const n = hit.normal || UP;
        g.v.reflect(n).multiplyScalar(0.38);
        g.p.copy(hit.point).addScaledVector(n, 0.05);
        if (g.v.length() > 2) this.audio.click(900, 0.05, 0.25);
      } else g.p.copy(np);
      g.mesh.position.copy(g.p);
      g.mesh.rotation.x += g.spin.x * dt * Math.min(1, g.v.length() / 4); g.mesh.rotation.y += g.spin.y * dt * Math.min(1, g.v.length() / 4);
      if (g.t <= 0) { this.scene.remove(g.mesh); this.grenadesLive.splice(i, 1); if (g.smoke) { this.fx.smokeGrenade(g.p); this.audio.click(500, 0.4, 0.3); } else this.explosion(g.p, g.owner); }
    }
  }

  actorHit(a0, a1, shooter) {
    // returns {actor, t, part} for the closest actor along segment a0->a1
    const seg = new THREE.Vector3().subVectors(a1, a0); const L = seg.length(); if (L < 1e-5) return null;
    const d = seg.clone().divideScalar(L);
    let best = null;
    for (const a of this.actors) {
      if (!a.alive || a === shooter || a.state === 'plane') continue;
      const px = a.pos.x, pz = a.pos.z;
      // quick reject: distance from segment to actor in XZ
      const tx = clamp(((px - a0.x) * d.x + (pz - a0.z) * d.z) / Math.max(1e-6, d.x * d.x + d.z * d.z), -1, L + 1);
      const cx = a0.x + d.x * tx, cz = a0.z + d.z * tx;
      if ((cx - px) ** 2 + (cz - pz) ** 2 > 2.5) continue;
      const h = a.state === 'ground' ? a.height : 1.6;
      const headC = new THREE.Vector3(px, a.pos.y + h - 0.13, pz);
      const tHead = raySphere(a0, d, headC, 0.14);
      if (tHead !== null && tHead <= L && (!best || tHead < best.t)) { best = { actor: a, t: tHead, part: 'head' }; continue; }
      const tb = segCapsule(a0, d, L, new THREE.Vector3(px, a.pos.y + 0.15, pz), new THREE.Vector3(px, a.pos.y + h - 0.3, pz), a.crouch ? 0.3 : 0.26);
      if (tb !== null && (!best || tb < best.t)) best = { actor: a, t: tb, part: 'body' };
    }
    return best;
  }

  updateBullets(dt) {
    const player = this.player;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let remaining = dt, dead = false;
      while (remaining > 0 && !dead) {
        const h = Math.min(remaining, 1 / 90); remaining -= h;
        const prev = b.p.clone();
        b.v.y -= 9.81 * h;
        b.v.multiplyScalar(1 - 0.06 * h);
        const next = prev.clone().addScaledVector(b.v, h);
        const wh = this.world.raycast(prev, next);
        const ah = this.actorHit(prev, next, b.owner);
        const wl = wh ? wh.dist : Infinity;
        if (ah && ah.t < wl) {
          const pt = prev.clone().addScaledVector(b.v.clone().normalize(), ah.t);
          const falloff = clamp(1 - (b.travelled - 120) / 900, 0.55, 1);
          this.damage(ah.actor, b.dmg * falloff, b.owner, ah.part, WEAPONS[b.kind].name);
          this.bloodFX(pt, b.v.clone().normalize());
          dead = true; b.p.copy(pt);
        } else if (wh) {
          this.impactFX(wh, b.v);
          dead = true; b.p.copy(wh.point);
        } else {
          b.travelled += prev.distanceTo(next);
          b.p.copy(next);
          // near-miss whiz for the player
          if (!b.whizzed && b.owner !== player && player.alive) {
            const c = player.pos.clone(); c.y += 1.4;
            const dd = distPointSeg(c, prev, next);
            if (dd < 2.5) { b.whizzed = true; this.audio.whiz(c); this.suppress = Math.min(1, (this.suppress || 0) + 0.35); }
          }
        }
      }
      b.life -= dt;
      if (b.tracer) {
        const dir = b.v.clone().normalize();
        const len = Math.min(10, b.travelled + 0.01);
        b.tracer.position.copy(b.p).addScaledVector(dir, -len / 2);
        b.tracer.scale.set(1, 1, len);
        b.tracer.lookAt(b.p);
        if (dead) b.tracer.visible = false;
      }
      if (dead || b.life <= 0 || b.p.y < -20) { if (b.tracer) b.tracer.visible = false; this.bullets.splice(i, 1); }
    }
  }

  damage(t, dmg, src, part, weapon, explosive = false) {
    if (!t.alive) return;
    let d = dmg;
    if (part === 'head') {
      d *= 2.3;
      if (t.helmet && t.helmetHp > 0) { const red = t.helmet === 2 ? 0.45 : 0.32; t.helmetHp -= d * red; d *= 1 - red; if (t.helmetHp <= 0) { t.helmet = 0; t.soldier.setGear(t.armor, 0); } }
    } else if (!explosive && t.armor && t.armorHp > 0) {
      const red = t.armor === 2 ? 0.42 : 0.3; t.armorHp -= d * red; d *= 1 - red; if (t.armorHp <= 0) { t.armor = 0; t.soldier.setGear(0, t.helmet); }
    }
    t.hp -= d;
    t.healT = 0;
    if (src && src !== t) {
      src.dmgDealt += Math.min(d, t.hp + d);
      if (t.ai && !t.ai.enemy) { t.ai.enemy = src; t.ai.react = 0.3; }
    }
    if (src === this.player) { this.hitMarker(part === 'head', t.hp <= 0); }
    if (t.ai && t.smokes && t.hp < 45 && t.hp > 0 && src) { const d = src.pos.clone().sub(t.pos).setY(0).normalize(); this.throwGrenade(t, d.setY(0.15).normalize(), true); }
    if (t === this.player) {
      this.damageFlash = Math.min(1, (this.damageFlash || 0) + d / 40);
      if (src && src !== t) this.lastHitDir = src.pos.clone();
    }
    if (t.hp <= 0) this.kill(t, src, weapon, part === 'head');
  }

  kill(t, src, weapon, head) {
    t.alive = false; t.hp = 0; t.state = 'dead';
    if (src && src !== t) src.kills++;
    const alive = this.actors.filter(a => a.alive).length;
    const text = src && src !== t ? `${src.name} <span>${head ? '⌖' : '›'} ${weapon}</span> ${t.name}` : `${t.name} <span>${weapon}</span>`;
    this.feed(text, src === this.player || t === this.player);
    if (src === this.player) this.toast(`Eliminated ${t.name}${head ? ' (headshot)' : ''} · ${alive} left`);
    // drop gear
    const drops = [];
    t.weapons.forEach(w => w && drops.push({ kind: 'weapon', sub: w.kind, mag: w.mag }));
    for (const [k, v] of Object.entries(t.ammo)) if (v > 0) drops.push({ kind: 'ammo', sub: k, amount: v });
    if (t.medkits) drops.push({ kind: 'medkit' });
    if (t.bandages) drops.push({ kind: 'bandage' });
    if (t.armor) drops.push({ kind: 'vest', lvl: t.armor });
    if (t.helmet) drops.push({ kind: 'helmet', lvl: t.helmet });
    if (t.grenades) drops.push({ kind: 'grenade' });
    if (t.smokes) drops.push({ kind: 'smoke' });
    drops.forEach((it, i) => { const ang = i / drops.length * Math.PI * 2; this.spawnLoot(it, t.pos.clone().add(new THREE.Vector3(Math.cos(ang) * 0.9, 0.3, Math.sin(ang) * 0.9))); });
    if (t === this.player) setTimeout(() => this.endMatch(false), 1800);
    else if (alive === 1 && this.player.alive) setTimeout(() => this.endMatch(true), 1500);
  }

  hitMarker(head, kill) {
    const el = $('hitmarker');
    el.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
    clearTimeout(this.hmT); this.hmT = setTimeout(() => (el.className = ''), 160);
    this.audio.hitmarker(head);
  }

  feed(html, mine) {
    const d = document.createElement('div'); d.className = 'kf' + (mine ? ' mine' : ''); d.innerHTML = html;
    const kf = $('killfeed'); kf.prepend(d);
    while (kf.children.length > 5) kf.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 6000); setTimeout(() => d.remove(), 7000);
  }

  toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(this.toastT); this.toastT = setTimeout(() => el.classList.remove('show'), 2600); }

  endMatch(win) {
    if (this.ended) return;
    this.ended = true; this.state = 'ended';
    document.exitPointerLock?.();
    const p = this.player;
    const rank = win ? 1 : this.actors.filter(a => a.alive).length + 1;
    $('endTitle').textContent = win ? 'Last one standing' : 'You were eliminated';
    $('endRank').innerHTML = `<b>#${rank}</b><span>of ${this.actors.length}</span>`;
    const mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60).toString().padStart(2, '0');
    $('endStats').innerHTML = `<div><b>${p.kills}</b><span>eliminations</span></div><div><b>${Math.round(p.dmgDealt)}</b><span>damage dealt</span></div><div><b>${mins}:${secs}</b><span>survived</span></div>`;
    $('endscreen').hidden = false; $('endscreen').classList.toggle('win', win);
    $('hud').hidden = true;
    $('againBtn').onclick = () => { $('endscreen').hidden = true; this.newMatch(); };
    $('menuBtn').onclick = () => { $('endscreen').hidden = true; $('menu').hidden = false; this.state = 'menu'; };
  }

  // ---------------- input ----------------
  requestLock() {
    if (this.isTouch) return;
    const el = this.renderer.domElement;
    try { const r = el.requestPointerLock?.(); r?.catch?.(() => {}); } catch { }
  }

  setupInput() {
    const el = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (this.state !== 'playing') return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.onKey(e.code);
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    el.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (!document.pointerLockElement && !this.isTouch) this.requestLock();
      if (e.button === 0) { this.mouse.fire = true; this.dryClick = false; }
      if (e.button === 2) this.toggleAds(true);
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.fire = false; if (e.button === 2 && this.settings.adsHold) this.toggleAds(false); });
    addEventListener('mousemove', (e) => {
      if (this.state !== 'playing') return;
      if (document.pointerLockElement || e.buttons) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.state !== 'playing') return; const p = this.player; const slots = [0, 1, 2].filter(s => p.weapons[s]); if (!slots.length) return; const i = slots.indexOf(p.cur); this.equip(p, slots[(i + (e.deltaY > 0 ? 1 : slots.length - 1)) % slots.length]); }, { passive: true });
    this.setupTouch();
  }

  toggleAds(v) {
    const p = this.player;
    if (!p || p.state !== 'ground' || !p.weapons[p.cur] || p.reloadT > 0 || p.healT > 0) { p && (p.ads = false); return; }
    p.ads = v === undefined ? !p.ads : (v === true && p.ads && !this.settings.adsHold ? false : v);
  }

  onKey(code) {
    const p = this.player;
    switch (code) {
      case 'KeyF': this.interact(); break;
      case 'KeyR': this.reload(p); break;
      case 'KeyC': case 'ControlLeft': p.crouch = !p.crouch; break;
      case 'KeyV': this.viewMode = this.viewMode === 'fpp' ? 'tpp' : 'fpp'; this.buildViewModel(); break;
      case 'Digit1': this.equip(p, 0); break;
      case 'Digit2': this.equip(p, 1); break;
      case 'Digit3': this.equip(p, 2); break;
      case 'KeyG': this.throwGrenade(p, this.aimDir()); break;
      case 'KeyT': this.throwGrenade(p, this.aimDir(), true); break;
      case 'KeyH': this.startHeal(p); break;
      case 'KeyM': this.toggleMap(); break;
      case 'Escape': this.mouse.fire = false; break;
    }
  }

  interact() {
    const p = this.player;
    if (p.state === 'plane') return this.jump(p);
    if (p.state === 'air' && p.freeT > 1) return this.openChute(p);
    if (p.state === 'ground' && this.nearItem) this.pickup(p, this.nearItem);
  }

  toggleMap() { const m = $('bigmap'); m.hidden = !m.hidden; if (!m.hidden) this.drawBigMap(); }

  setupTouch() {
    if (!this.isTouch) return;
    const stick = $('stick'), knob = $('knob');
    let stickId = null, lookId = null, lx = 0, ly = 0, sx = 0, sy = 0;
    const R = 55;
    stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; stickId = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    const look = $('lookpad');
    look.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
          knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.touch.mx = dx / R; this.touch.my = dy / R; this.touch.sprint = l > R * 1.4;
        } else if (t.identifier === lookId || this.fireTouch === t.identifier) {
          this.mouse.dx += (t.clientX - lx) * 1.6; this.mouse.dy += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: false });
    addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; knob.style.transform = ''; this.touch.mx = this.touch.my = 0; this.touch.sprint = false; }
        if (t.identifier === lookId) lookId = null;
        if (t.identifier === this.fireTouch) { this.fireTouch = null; this.mouse.fire = false; }
      }
    });
    const btn = (id, fn) => $(id).addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); }, { passive: false });
    btn('tFire', (e) => { const t = e.changedTouches[0]; this.fireTouch = t.identifier; lx = t.clientX; ly = t.clientY; this.mouse.fire = true; this.dryClick = false; });
    btn('tAds', () => this.toggleAds());
    btn('tJump', () => { if (this.player.state === 'ground') this.keys.Space = true, setTimeout(() => (this.keys.Space = false), 120); else this.interact(); });
    btn('tCrouch', () => (this.player.crouch = !this.player.crouch));
    btn('tReload', () => this.reload(this.player));
    btn('tUse', () => this.interact());
    btn('tHeal', () => this.startHeal(this.player));
    btn('tNade', () => this.throwGrenade(this.player, this.aimDir()));
    btn('tSmoke', () => this.throwGrenade(this.player, this.aimDir(), true));
    btn('tView', () => { this.viewMode = this.viewMode === 'fpp' ? 'tpp' : 'fpp'; this.buildViewModel(); });
    btn('tMap', () => this.toggleMap());
    btn('tSwap', () => { const p = this.player; const slots = [0, 1, 2].filter(s => p.weapons[s]); if (slots.length) this.equip(p, slots[(slots.indexOf(p.cur) + 1) % slots.length]); });
  }

  // ---------------- player ----------------
  aimDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); }

  jump(a) {
    if (a.state !== 'plane') return;
    a.state = 'air'; a.freeT = 0;
    a.pos.copy(this.planePos()).add(new THREE.Vector3(0, -4, 0)).addScaledVector(this.flight.dir, 14);
    a.vel.copy(this.flight.dir).multiplyScalar(this.flight.speed * 0.5);
    a.soldier.root.visible = true;
    if (a.isPlayer) { $('jumpPrompt').hidden = true; this.toast('Freefall: W to dive, F to open the canopy'); this.audio.setWind(0.3); }
  }
  openChute(a) {
    if (a.state !== 'air') return;
    a.state = 'chute';
    a.chute = makeParachute(a.id + 3); this.scene.add(a.chute);
    a.vel.y = Math.max(a.vel.y, -12);
    if (a.isPlayer) this.audio.click(300, 0.3, 0.6);
  }
  planePos() { return this.flight.a.clone().addScaledVector(this.flight.dir, this.planeT * this.flight.speed); }

  // movement for any actor; inp: {fx, fz, sprint, jump}
  move(a, dt, inp) {
    const W = this.world;
    if (a.state === 'air' || a.state === 'chute') {
      const chute = a.state === 'chute';
      const fwd = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)), right = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
      const hs = chute ? lerp(8, 17, Math.max(0, inp.fz)) : lerp(18, 42, Math.max(0, inp.fz));
      const want = fwd.multiplyScalar(chute ? Math.max(0.35, inp.fz) * hs : inp.fz * hs).addScaledVector(right, inp.fx * (chute ? 6 : 14));
      a.vel.x = lerp(a.vel.x, want.x, 1 - Math.exp(-dt * (chute ? 1.5 : 0.8)));
      a.vel.z = lerp(a.vel.z, want.z, 1 - Math.exp(-dt * (chute ? 1.5 : 0.8)));
      const term = chute ? (inp.fz > 0.3 ? -7.5 : -5) : (inp.fz > 0.3 ? -70 : -52);
      a.vel.y = lerp(a.vel.y, term, 1 - Math.exp(-dt * (chute ? 2 : 0.5)));
      a.pos.addScaledVector(a.vel, dt);
      a.pos.x = clamp(a.pos.x, -HALF + 5, HALF - 5); a.pos.z = clamp(a.pos.z, -HALF + 5, HALF - 5);
      a.freeT += dt;
      const g = W.groundAt(a.pos.x, a.pos.z, a.pos.y + 1);
      if (a.state === 'air' && a.pos.y - g < 140) this.openChute(a);
      if (a.pos.y <= g) {
        a.pos.y = g; a.state = 'ground'; a.vel.set(0, 0, 0);
        if (a.chute) { this.scene.remove(a.chute); a.chute = null; }
        if (a.isPlayer) { this.audio.setWind(0.07); this.toast('Landed. Find a weapon.'); }
      }
      if (a.chute) { a.chute.position.copy(a.pos); a.chute.rotation.y = a.yaw; a.chute.rotation.z = -inp.fx * 0.25; }
      return;
    }
    if (a.state !== 'ground') return;
    // crouch height
    const targetH = a.crouch ? 1.25 : 1.78;
    if (!a.crouch && a.height < 1.78) { const c = W.ceilingAt(a.pos.x, a.pos.z, a.pos.y + 0.5); if (a.pos.y + 1.78 > c) a.crouch = true; }
    a.height = lerp(a.height, targetH, 1 - Math.exp(-dt * 12));
    const swim = a.pos.y < -1.2;
    let speed = swim ? 2.6 : a.crouch ? 2.3 : inp.sprint && inp.fz > 0.5 && !a.ads ? 6.4 : 4.7;
    if (a.ads) speed *= 0.65;
    if (a.healT > 0) speed = Math.min(speed, 1.8);
    const fwd = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)), right = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    const wish = fwd.multiplyScalar(inp.fz).addScaledVector(right, inp.fx);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    const k = 1 - Math.exp(-dt * (a.grounded ? 11 : 1.5));
    a.vel.x = lerp(a.vel.x, wish.x, k); a.vel.z = lerp(a.vel.z, wish.z, k);
    a.vel.y -= GRAV * dt;
    if (inp.jump && a.grounded && !swim) { a.vel.y = 5.3; a.grounded = false; if (a.crouch) a.crouch = false; }
    const np = a.pos.clone().addScaledVector(a.vel, dt);
    W.collide(np, 0.32, a.height);
    np.x = clamp(np.x, -HALF + 5, HALF - 5); np.z = clamp(np.z, -HALF + 5, HALF - 5);
    const g = W.groundAt(np.x, np.z, a.pos.y, 0.6);
    const water = -1.25;
    const floor = Math.max(g, g < water ? water : -Infinity);
    if (np.y <= floor) { np.y = floor; a.vel.y = Math.max(0, a.vel.y) * 0; a.grounded = true; }
    else if (a.grounded && a.vel.y <= 0 && np.y - floor < 0.45) { np.y = floor; a.vel.y = 0; }
    else a.grounded = false;
    const ceil = W.ceilingAt(np.x, np.z, a.pos.y + 0.4);
    if (np.y + a.height > ceil) { np.y = Math.max(floor, ceil - a.height); a.vel.y = Math.min(0, a.vel.y); }
    const moved = Math.hypot(np.x - a.pos.x, np.z - a.pos.z);
    a.pos.copy(np);
    // footsteps
    if (a.grounded && moved > 0.001) {
      a.stepAcc += moved;
      const stride = a.crouch ? 0.9 : speed > 5.5 ? 1.6 : 1.3;
      if (a.stepAcc > stride) {
        a.stepAcc = 0;
        const d = a.pos.distanceTo(this.camera.position);
        if (d < 45 && !a.crouch) this.audio.footstep(a.pos, g > this.world.getHeight(a.pos.x, a.pos.z) + 0.1 ? 'wood' : 'ground', a.isPlayer, a.isPlayer ? 0.1 : 0.22);
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    const s = this.settings.sens * 0.0022 * (p.ads ? 1 / WEAPONS[p.weapons[p.cur]?.kind || 'pistol'].zoom : 1);
    this.camYaw -= this.mouse.dx * s; this.camPitch -= this.mouse.dy * s;
    this.mouse.dx = this.mouse.dy = 0;
    this.camPitch = clamp(this.camPitch, -1.45, 1.45);
    // recoil recovery
    if (this.recoilKick) { const r = Math.min(this.recoilKick, dt * 0.08); this.camPitch -= r * 0.5; this.recoilKick -= r; }
    const k = this.keys, t = this.touch;
    let fz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) - t.my, fx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + t.mx;
    fz = clamp(fz, -1, 1); fx = clamp(fx, -1, 1);
    const sprint = k.ShiftLeft || t.sprint || (this.isTouch && t.my < -0.95);
    if (p.state === 'plane') return;
    if (p.alive) {
      p.yaw = this.camYaw; p.pitch = this.camPitch;
      const lean = p.state === 'ground' ? ((k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0)) : 0;
      p.lean = lerp(p.lean, lean, 1 - Math.exp(-dt * 10));
      this.move(p, dt, { fx, fz, sprint, jump: k.Space });
      // timers
      this.updateTimers(p, dt);
      // firing
      const w = p.weapons[p.cur];
      if (this.mouse.fire && w && p.state === 'ground' && !this.mapOpen()) {
        const ok = this.fire(p, this.aimDir(), this.shotOrigin());
        if (ok && !WEAPONS[w.kind].auto) this.mouse.fire = this.isTouch ? this.mouse.fire && false : false;
      }
      if (p.ads && (p.state !== 'ground' || sprint && fz > 0.5)) p.ads = false;
      // nearest loot
      this.nearItem = null;
      if (p.state === 'ground') {
        let best = 2.4 * 2.4;
        const ad = this.aimDir();
        for (const it of this.loot) {
          const dx = it.pos.x - p.pos.x, dy = it.pos.y - p.pos.y, dz = it.pos.z - p.pos.z;
          const d2 = dx * dx + dz * dz + dy * dy * 0.5;
          if (d2 > 6 || Math.abs(dy) > 1.6) continue;
          const score = d2 - (dx * ad.x + dz * ad.z) * 0.8;
          if (score < best) { best = score; this.nearItem = it; }
        }
      }
      // zone damage
      if (p.state === 'ground' && this.outsideZone(p.pos)) { p.hp -= this.zone.dps * dt; if (p.hp <= 0) this.kill(p, null, 'the firestorm', false); }
    }
  }

  updateTimers(a, dt) {
    if (a.reloadT > 0) { a.reloadT -= dt; if (a.reloadT <= 0) { a.reloadT = 0; this.finishReload(a); } }
    if (a.boltT > 0) { a.boltT -= dt; if (a.isPlayer && a.boltT > 0 && a.boltT < 0.5 && !a.boltSnd) { a.boltSnd = true; this.audio.click(1100, 0.07, 0.3); this.audio.click(1800, 0.05, 0.3, 0.25); } if (a.boltT <= 0) a.boltSnd = false; }
    if (a.healT > 0) { a.healT -= dt; if (a.healT <= 0) { a.healT = 0; this.finishHeal(a); } }
  }

  shotOrigin() {
    const p = this.player;
    if (this.viewMode === 'fpp' || p.ads) return this.camera.position.clone();
    // TPP: fire from the eye toward the camera aim point
    return p.pos.clone().add(new THREE.Vector3(0, p.height - 0.15, 0)).addScaledVector(new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)), 0.25);
  }

  mapOpen() { return !$('bigmap').hidden; }

  // ---------------- AI ----------------
  updateBot(a, dt) {
    const ai = a.ai, W = this.world;
    if (a.state === 'plane') {
      if (this.planeT >= ai.jumpAt) this.jump(a);
      return;
    }
    if (a.state === 'air' || a.state === 'chute') {
      const to = ai.drop.clone().sub(a.pos); to.y = 0;
      a.yaw = Math.atan2(-to.x, -to.z);
      const d = to.length();
      this.move(a, dt, { fx: 0, fz: d > 30 ? 1 : 0.1 });
      if (a.state === 'air' && d < 220 && a.pos.y - W.getHeight(a.pos.x, a.pos.z) < 380) this.openChute(a);
      return;
    }
    this.updateTimers(a, dt);
    ai.think -= dt;
    const w = a.weapons[a.cur];
    const far = a.pos.distanceTo(this.camera.position) > 500;
    if (ai.think <= 0) {
      ai.think = (far ? 0.7 : 0.3) + Math.random() * 0.15;
      this.botThink(a);
    }
    let fx = 0, fz = 0, sprint = false, jump = false;
    const z = this.zone;
    // combat
    const e = ai.enemy && ai.enemy.alive ? ai.enemy : null;
    if (e && w && ai.sees) {
      const eye = a.pos.clone(); eye.y += a.height - 0.12;
      const tgt = e.pos.clone(); tgt.y += (e.state === 'ground' ? e.height : 1.6) * (Math.random() < 0.18 * a.ai.skill ? 0.93 : 0.6);
      const dist = eye.distanceTo(tgt);
      const travel = dist / WEAPONS[w.kind].vel;
      tgt.addScaledVector(e.vel, travel * 0.8);
      tgt.y += 0.5 * 9.81 * travel * travel;
      const dir = tgt.sub(eye).normalize();
      const wantYaw = Math.atan2(-dir.x, -dir.z), wantPitch = Math.asin(clamp(dir.y, -1, 1));
      const turn = 1 - Math.exp(-dt * (4 + a.ai.skill * 6));
      a.yaw += angDiff(wantYaw, a.yaw) * turn; a.pitch = lerp(a.pitch, wantPitch, turn);
      ai.react -= dt;
      ai.strafeT -= dt; if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = 0.6 + Math.random() * 1.4; if (Math.random() < 0.25) a.crouch = !a.crouch; }
      fx = dist > 12 ? ai.strafe * 0.8 : ai.strafe; fz = dist > 90 ? 0.6 : dist < 8 ? -0.5 : 0;
      a.ads = dist > 25;
      if (ai.react <= 0 && Math.abs(angDiff(wantYaw, a.yaw)) < 0.12 && w.mag > 0 && a.reloadT === 0) {
        const W = WEAPONS[w.kind];
        const range = w.kind === 'marksman' ? 400 : w.kind === 'carbine' ? 220 : 110;
        if (dist < range) {
          const err = ai.err * (1 - Math.min(0.6, ai.engaged * 0.12)) * (dist > 60 ? 0.6 : 1) / (0.7 + a.ai.skill * 0.6);
          const fd = new THREE.Vector3(-Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch), -Math.cos(a.yaw) * Math.cos(a.pitch));
          fd.x += (Math.random() - 0.5) * err; fd.y += (Math.random() - 0.5) * err; fd.z += (Math.random() - 0.5) * err;
          if (!W.auto || ai.burst > 0) {
            if (this.fire(a, fd.normalize(), eye)) { ai.burst--; ai.engaged += 0.15; }
          } else if (Math.random() < dt * 3) ai.burst = 3 + Math.floor(Math.random() * 6);
        }
      }
      if (w.mag === 0) {
        if (a.ammo[WEAPONS[w.kind].ammo] > 0) this.reload(a);
        else { const alt = [0, 1, 2].find(s => s !== a.cur && a.weapons[s] && (a.weapons[s].mag > 0 || a.ammo[WEAPONS[a.weapons[s].kind].ammo] > 0)); if (alt !== undefined) this.equip(a, alt); }
      }
    } else {
      a.ads = false;
      if (a.crouch && Math.random() < dt) a.crouch = false;
      if (w && w.mag < WEAPONS[w.kind].mag * 0.5 && a.ammo[WEAPONS[w.kind].ammo] > 0) this.reload(a);
      if (a.hp < 70 && (a.medkits || a.bandages) && a.healT <= 0) this.startHeal(a);
      if (ai.wp) {
        const to = ai.wp.clone().sub(a.pos); to.y = 0;
        const d = to.length();
        if (d < (ai.route?.length ? 1.0 : 1.5)) {
          if (ai.route?.length) ai.wp = ai.route.shift();
          else { if (ai.wpItem && this.loot.includes(ai.wpItem) && Math.abs(ai.wpItem.pos.y - a.pos.y) < 1.6) this.pickup(a, ai.wpItem); ai.wp = null; ai.wpItem = null; }
        }
        else {
          const wantYaw = Math.atan2(-to.x, -to.z);
          a.yaw += angDiff(wantYaw, a.yaw) * (1 - Math.exp(-dt * 6)); a.pitch = lerp(a.pitch, 0, dt * 3);
          fz = 1; sprint = d > 15 && a.healT <= 0;
          if (Math.abs(angDiff(wantYaw, a.yaw)) > 0.8) fz = 0.3;
        }
      }
      // stuck detection
      ai.stuckT += dt;
      if (ai.stuckT > 1.6) {
        if (ai.wp && a.pos.distanceTo(ai.lastPos) < 0.8) {
          ai.stuckN = (ai.stuckN || 0) + 1;
          if (ai.stuckN > 4) { if (ai.wpItem) (ai.bad ||= new Set()).add(ai.wpItem); ai.wp = null; ai.wpItem = null; ai.route = []; ai.stuckN = 0; }
          else if (ai.stuckN === 1) jump = true;
          else {
            // sidestep around the obstacle, then resume the route
            const to = ai.wp.clone().sub(a.pos); to.y = 0; to.normalize();
            const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (6 + ai.stuckN * 4));
            ai.route = [ai.wp.clone(), ...(ai.route || [])];
            ai.wp = a.pos.clone().add(side).addScaledVector(to, -2);
          }
        }
        ai.lastPos.copy(a.pos); ai.stuckT = 0;
      }
    }
    this.move(a, dt, { fx, fz, sprint, jump });
    if (this.outsideZone(a.pos)) { a.hp -= z.dps * dt; if (a.hp <= 0) this.kill(a, null, 'the firestorm', false); }
  }

  // set a destination, routing through a doorway when it is inside a building
  goTo(a, target, item = null) {
    const ai = a.ai, W = this.world;
    ai.route = [];
    const tb = W.buildingAt(target.x, target.z, 0.2);
    const ab = W.buildingAt(a.pos.x, a.pos.z, 0.2);
    if (ab && ab !== tb && ab.doors?.length) { const d = nearestDoor(ab, a.pos); ai.route.push(d.in.clone(), d.out.clone()); }
    if (tb && tb !== ab && tb.doors?.length) { const d = nearestDoor(tb, a.pos); ai.route.push(d.out.clone(), d.in.clone()); }
    ai.route.push(target.clone());
    ai.wp = ai.route.shift(); ai.wpItem = item; ai.stuckN = 0;
  }

  botThink(a) {
    const ai = a.ai, W = this.world;
    const eye = a.pos.clone(); eye.y += a.height - 0.12;
    // perception
    ai.sees = false;
    const cands = [];
    for (const o of this.actors) {
      if (o === a || !o.alive || o.state === 'plane') continue;
      const d = o.pos.distanceTo(a.pos);
      const range = o.state !== 'ground' ? 250 : (o.crouch ? 110 : 190) * (W.forestMask(o.pos.x, o.pos.z) > 0.5 ? 0.7 : 1);
      if (d < range) cands.push({ o, d });
    }
    cands.sort((x, y) => x.d - y.d);
    if (ai.enemy && ai.enemy.alive && !cands.find(c => c.o === ai.enemy)) {
      const d = ai.enemy.pos.distanceTo(a.pos);
      if (d < 220) cands.unshift({ o: ai.enemy, d });
    }
    for (const c of cands.slice(0, 2)) {
      const tp = c.o.pos.clone(); tp.y += (c.o.state === 'ground' ? c.o.height : 1.6) * 0.75;
      // field of view: bots notice things in front easily, behind only when close or if shot
      const to = tp.clone().sub(eye).normalize();
      const facing = -Math.sin(a.yaw) * to.x - Math.cos(a.yaw) * to.z;
      if (facing < -0.2 && c.d > 18 && c.o !== ai.enemy) continue;
      const hit = W.raycast(eye, tp) || (this.fx.blocksView(eye, tp) ? {} : null);
      if (!hit) {
        if (ai.enemy !== c.o) { ai.enemy = c.o; ai.react = 0.35 + (1 - ai.skill) * 0.7 + c.d / 400; ai.engaged = 0; }
        ai.sees = true; ai.lastSeen = c.o.pos.clone();
        break;
      }
    }
    if (ai.sees && !a.weapons[a.cur]) ai.sees = false;
    if (ai.sees) return;
    if (ai.enemy && (!ai.enemy.alive || ai.enemy.pos.distanceTo(a.pos) > 260)) ai.enemy = null;
    // decide where to go
    const z = this.zone;
    const nc = z.nc || z.c, nr = z.nr ?? z.r;
    const distIn = Math.hypot(a.pos.x - nc.x, a.pos.z - nc.y) - nr * 0.8;   // metres to walk to be safely inside the next circle
    const timeLeft = z.stage === 'wait' ? z.t + (z.P?.shrink || 0) * 0.5 : z.t * 0.5;
    const urgent = this.outsideZone(a.pos) || (distIn > 0 && distIn / 5.2 > timeLeft - 25);
    if (!urgent) ai.urgent = false;
    if (urgent) {
      if (!ai.wp || !ai.urgent || ai.wpItem) {
        const ang = Math.random() * Math.PI * 2, rr = Math.random() * nr * 0.6;
        this.goTo(a, new THREE.Vector3(nc.x + Math.cos(ang) * rr, 0, nc.y + Math.sin(ang) * rr)); ai.urgent = true;
      }
      return;
    }
    if (ai.lastSeen && ai.enemy && a.weapons[a.cur]) { this.goTo(a, ai.lastSeen); ai.lastSeen = null; return; }
    const needs = (it) => {
      if (it.kind === 'weapon') return !a.weapons[0] || (!a.weapons[1] && WEAPONS[it.sub].prim) || (!a.weapons[2] && it.sub === 'pistol');
      if (it.kind === 'ammo') return a.weapons.some(w => w && WEAPONS[w.kind].ammo === it.sub) && a.ammo[it.sub] < 90;
      if (it.kind === 'vest') return it.lvl > a.armor;
      if (it.kind === 'helmet') return it.lvl > a.helmet;
      if (it.kind === 'medkit') return a.medkits < 2;
      if (it.kind === 'bandage') return a.bandages < 6;
      if (it.kind === 'grenade') return a.grenades < 2;
      return false;
    };
    if (!ai.wp || !ai.wpItem) {
      const armed = !!a.weapons[a.cur];
      let best = null, bd = armed ? 50 : 400;
      for (const it of this.loot) {
        if (ai.bad?.has(it) || Math.abs(it.pos.y - a.pos.y) > 1.6) continue;   // bots do not plan stair routes
        if (!armed && it.kind !== 'weapon' && !(it.kind === 'ammo' && a.weapons.some(Boolean))) continue;
        const d = Math.abs(it.pos.x - a.pos.x) + Math.abs(it.pos.z - a.pos.z);
        if (d < bd && needs(it)) { bd = d; best = it; }
      }
      if (best) { this.goTo(a, best.pos, best); return; }
    }
    if (!ai.wp) {
      // wander: prefer buildings inside the safe area
      const bs = this.world.buildings;
      const b = bs[Math.floor(Math.random() * bs.length)];
      const inside = Math.hypot(b.x - nc.x, b.z - nc.y) < nr;
      if (inside && Math.hypot(b.x - a.pos.x, b.z - a.pos.z) < 350) this.goTo(a, new THREE.Vector3(b.x, 0, b.z));
      else { const ang = Math.random() * Math.PI * 2; this.goTo(a, a.pos.clone().add(new THREE.Vector3(Math.cos(ang) * 40, 0, Math.sin(ang) * 40))); }
    }
  }

  // ---------------- camera + view model ----------------
  buildViewModel() {}   // first person shows the character's own body and arms

  // Place the held weapon: in first person it hangs off the camera (hip or sights);
  // otherwise it sits at the chest, pointing along the aim direction.
  placeGun(a, dt) {
    const gs = a.soldier.gunSocket, w = a.weapons[a.cur];
    gs.visible = !!w && a.state === 'ground' && a.alive && a.healT <= 0;
    if (!gs.visible) return;
    if (a.isPlayer && this.viewMode === 'fpp' || a.isPlayer && a.ads) {
      const cam = this.camera;
      const W = WEAPONS[w.kind];
      const sp = Math.hypot(a.vel.x, a.vel.z);
      const off = a.ads ? new THREE.Vector3(0, -(gs.children[0]?.userData.sightY || 0.1), -0.38) : new THREE.Vector3(0.16, -0.2, -0.4);
      if (a.reloadT > 0) off.y -= 0.1;
      if (!a.ads && this.keys.ShiftLeft && sp > 5) { off.x -= 0.05; off.y -= 0.06; }
      off.z += (this.recoilKick || 0) * 2.2;
      off.y += Math.sin((this.bob || 0) * 2) * 0.008 * Math.min(1, sp / 5);
      this.gunOff = this.gunOff ? this.gunOff.lerp(off, 1 - Math.exp(-dt * 18)) : off.clone();
      gs.position.copy(this.gunOff).applyQuaternion(cam.quaternion).add(cam.position);
      gs.quaternion.copy(cam.quaternion);
      gs.rotateX((this.recoilKick || 0) * 3 + (a.reloadT > 0 ? -0.35 : 0));
      if (W.scope && a.ads) gs.visible = false;
    } else {
      const yaw = a.yaw, p = a.pitch;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      gs.position.copy(a.pos).add(new THREE.Vector3(0, a.height - 0.42, 0)).addScaledVector(right, 0.13).addScaledVector(dir, 0.32);
      gs.quaternion.setFromEuler(new THREE.Euler(p, yaw, 0, 'YXZ'));
    }
    gs.updateMatrixWorld(true);
  }

  updateCamera(dt) {
    const p = this.player, cam = this.camera;
    const z0 = this.settings.fov;
    let fov = z0;
    if (p.state === 'plane') {
      const pp = this.planePos();
      const off = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), -Math.sin(this.camPitch) + 0.15, Math.cos(this.camYaw) * Math.cos(this.camPitch)).multiplyScalar(48);
      cam.position.copy(pp).add(off); cam.lookAt(pp);
      p.soldier.hideHead(false);
    } else if (!p.alive) {
      const tgt = p.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      this.deathCam = (this.deathCam || 0) + dt * 0.2;
      cam.position.copy(tgt).add(new THREE.Vector3(Math.sin(this.deathCam) * 6, 3.5, Math.cos(this.deathCam) * 6));
      cam.lookAt(tgt);
      p.soldier.hideHead(false);
    } else {
      const fpp = this.viewMode === 'fpp' || p.ads;
      const eye = p.pos.clone(); eye.y += (p.state === 'ground' ? p.height : 1.7) - 0.1;
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      eye.addScaledVector(right, p.lean * 0.38); eye.y -= Math.abs(p.lean) * 0.08;
      const euler = new THREE.Euler(this.camPitch, this.camYaw, -p.lean * 0.14, 'YXZ');
      cam.quaternion.setFromEuler(euler);
      if (fpp && p.state === 'ground') {
        // head bob
        const sp = Math.hypot(p.vel.x, p.vel.z);
        this.bob = (this.bob || 0) + dt * sp * 1.9;
        eye.y += Math.sin(this.bob * 2) * 0.025 * Math.min(1, sp / 5) * (p.ads ? 0.3 : 1);
        eye.addScaledVector(right, Math.cos(this.bob) * 0.02 * Math.min(1, sp / 5) * (p.ads ? 0.3 : 1));
        cam.position.copy(eye);
      } else {
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
        const piv = p.pos.clone(); piv.y += (p.state === 'ground' ? p.height : 1.7) + 0.05;
        const air = p.state !== 'ground';
        const want = piv.clone().addScaledVector(right, air ? 0 : 0.62).addScaledVector(back, air ? (p.state === 'chute' ? 9 : 6) : 2.1).add(new THREE.Vector3(0, air ? 1 : -0.05, 0));
        const hit = this.world.raycast(piv, want);
        if (hit) want.copy(piv).lerp(hit.point, Math.max(0, (hit.dist - 0.3) / piv.distanceTo(want)));
        cam.position.copy(want);
      }
      const w = p.weapons[p.cur];
      if (p.ads && w) fov = z0 / WEAPONS[w.kind].zoom;
      // view model
      const scoped = p.ads && w && WEAPONS[w.kind].scope;
      p.soldier.root.visible = !scoped;
      p.soldier.hideHead(fpp && p.state === 'ground');
      if (this.vm) {
        this.vm.visible = fpp && p.state === 'ground' && p.healT <= 0 && !(p.ads && WEAPONS[w.kind].scope);
        const sp = Math.hypot(p.vel.x, p.vel.z);
        const target = p.ads ? new THREE.Vector3(0, -(this.vm.userData.sightY || 0.1), -0.42) : this.vmPos.clone();
        if (p.reloadT > 0) { target.y -= 0.12; target.x += 0.02; }
        if (this.keys.ShiftLeft && sp > 5) { target.x -= 0.06; target.y -= 0.05; }
        target.y += Math.sin((this.bob || 0) * 2) * 0.008 * Math.min(1, sp / 5);
        target.z += (this.recoilKick || 0) * 2.2;
        this.vm.position.lerp(target, 1 - Math.exp(-dt * 18));
        const rot = p.reloadT > 0 ? -0.5 : this.keys.ShiftLeft && sp > 5 ? 0.35 : 0;
        this.vm.rotation.z = lerp(this.vm.rotation.z, rot * 0.6, 1 - Math.exp(-dt * 10));
        this.vm.rotation.x = lerp(this.vm.rotation.x, (this.recoilKick || 0) * 3 + (p.reloadT > 0 ? -0.3 : 0), 1 - Math.exp(-dt * 14));
        if (this.vmFlash > 0) { this.vmFlash -= dt; const mz = this.vmGun.localToWorld(this.vm.userData.muzzle.clone()); this.flashSprite.position.copy(mz); this.flashSprite.visible = !p.ads || !WEAPONS[w.kind].scope; this.flashT = 0.03; if (!this.flashSprite.parent) this.scene.add(this.flashSprite); }
      }
      $('scope').hidden = !(p.ads && w && WEAPONS[w.kind].scope);
    }
    // shake
    if (this.shake > 0) { cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.2, (Math.random() - 0.5) * this.shake * 0.2, 0)); this.shake -= dt * 1.5; }
    cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 14));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // ---------------- HUD ----------------
  updateHUD(dt) {
    const p = this.player;
    this.hudT = (this.hudT || 0) - dt;
    $('hpfill').style.width = Math.max(0, p.hp) + '%';
    $('hpfill').className = p.hp < 30 ? 'low' : p.healT > 0 ? 'heal' : '';
    $('damageVig').style.opacity = this.damageFlash || 0; this.damageFlash = Math.max(0, (this.damageFlash || 0) - dt * 1.4);
    $('zoneVig').style.opacity = p.state === 'ground' && this.outsideZone(p.pos) ? 0.85 : 0;
    $('suppress').style.opacity = (this.suppress || 0) * 0.7; this.suppress = Math.max(0, (this.suppress || 0) - dt * 0.9);
    // compass
    const deg = ((-this.camYaw * 180 / Math.PI) % 360 + 360) % 360;
    $('compassStrip').style.transform = `translateX(${-deg * 4}px)`;
    $('compassDeg').textContent = Math.round(deg).toString().padStart(3, '0');
    // crosshair spread
    const w = p.weapons[p.cur];
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const spread = w ? (p.ads ? 0 : WEAPONS[w.kind].spread * (1 + sp * 0.12) * (p.crouch ? 0.75 : 1)) : 0.02;
    $('crosshair').style.setProperty('--gap', (6 + spread * 900) + 'px');
    $('crosshair').hidden = p.ads || p.state !== 'ground' || !p.alive;
    // heal bar
    if (p.healT > 0 || p.reloadT > 0) {
      $('actbar').hidden = false;
      const tot = p.healT > 0 ? p.healMax : WEAPONS[w.kind].reload, rem = p.healT > 0 ? p.healT : p.reloadT;
      $('actfill').style.width = (100 * (1 - rem / tot)) + '%';
      $('actlabel').textContent = p.healT > 0 ? (p.healKind === 'medkit' ? 'Using medkit' : 'Applying bandage') + ` ${rem.toFixed(1)}s` : `Reloading ${rem.toFixed(1)}s`;
    } else $('actbar').hidden = true;
    // prompt
    const pr = $('prompt');
    if (p.state === 'ground' && this.nearItem && p.alive) { pr.hidden = false; pr.innerHTML = `<kbd>${this.isTouch ? 'USE' : 'F'}</kbd> ${this.itemLabel(this.nearItem)}`; }
    else if (p.state === 'air' && p.freeT > 1) { pr.hidden = false; pr.innerHTML = `<kbd>${this.isTouch ? 'JUMP' : 'F'}</kbd> Open canopy · ${Math.round(p.pos.y - this.world.getHeight(p.pos.x, p.pos.z))} m`; }
    else if (p.state === 'chute') { pr.hidden = false; pr.innerHTML = `Altitude ${Math.round(p.pos.y - this.world.getHeight(p.pos.x, p.pos.z))} m`; }
    else pr.hidden = true;
    if (this.hudT > 0) return;
    this.hudT = 0.1;
    const alive = this.actors.filter(a => a.alive).length;
    $('alive').textContent = alive; $('kills').textContent = p.kills;
    // slots
    for (let s = 0; s < 3; s++) {
      const el = $('slot' + s), ws = p.weapons[s];
      el.classList.toggle('on', s === p.cur); el.classList.toggle('empty', !ws);
      el.querySelector('.wn').textContent = ws ? WEAPONS[ws.kind].name : ['Primary', 'Primary', 'Sidearm'][s];
    }
    if (w) { $('ammoMag').textContent = w.mag; $('ammoRes').textContent = p.ammo[WEAPONS[w.kind].ammo]; $('ammoType').textContent = WEAPONS[w.kind].ammo; $('ammo').hidden = false; }
    else $('ammo').hidden = true;
    $('vestIco').className = 'gear l' + p.armor; $('vestIco').style.setProperty('--d', p.armor ? clamp(p.armorHp / (p.armor === 2 ? 220 : 160), 0, 1) : 0);
    $('helmIco').className = 'gear l' + p.helmet; $('helmIco').style.setProperty('--d', p.helmet ? clamp(p.helmetHp / (p.helmet === 2 ? 150 : 90), 0, 1) : 0);
    $('meds').textContent = `${p.bandages} bandage${p.bandages === 1 ? '' : 's'} · ${p.medkits} medkit${p.medkits === 1 ? '' : 's'} · ${p.grenades} grenade${p.grenades === 1 ? '' : 's'} · ${p.smokes || 0} smoke`;
    const z = this.zone;
    const tt = Math.max(0, Math.ceil(z.t));
    $('zoneinfo').innerHTML = z.stage === 'final' ? 'Final zone' : `<b>${z.stage === 'wait' ? 'Zone closes in' : 'Closing'}</b> ${Math.floor(tt / 60)}:${(tt % 60).toString().padStart(2, '0')}`;
    if (p.state === 'ground' && this.outsideZone(p.pos)) $('zoneinfo').innerHTML += ` · <em>${Math.round(Math.hypot(p.pos.x - z.c.x, p.pos.z - z.c.y) - z.r)} m outside</em>`;
    this.drawMinimap();
    if (this.mapOpen()) this.drawBigMap();
  }

  drawMinimap() {
    const c = $('minimap'), g = c.getContext('2d'), W = c.width;
    const p = this.player, mc = this.world.mapCanvas;
    const view = 260; // metres across
    const s = mc.width / MAP_SIZE;
    const cx = p.state === 'plane' ? this.planePos() : p.pos;
    g.fillStyle = '#2c4f5a'; g.fillRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.rect(0, 0, W, W); g.clip();
    g.drawImage(mc, (cx.x + HALF - view / 2) * s, (cx.z + HALF - view / 2) * s, view * s, view * s, 0, 0, W, W);
    const toM = (x, z) => [(x - cx.x) / view * W + W / 2, (z - cx.z) / view * W + W / 2];
    this.drawZone(g, toM, W / view);
    // player arrow
    g.translate(W / 2, W / 2); g.rotate(-this.camYaw);
    g.fillStyle = '#f4e9c8'; g.strokeStyle = '#151515'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  drawZone(g, toM, scale) {
    const z = this.zone;
    g.lineWidth = 2;
    g.strokeStyle = '#ff7a2f'; g.beginPath(); const [a, b] = toM(z.c.x, z.c.y); g.arc(a, b, z.r * scale, 0, Math.PI * 2); g.stroke();
    if (z.nc && z.stage !== 'final') { g.strokeStyle = '#ffffff'; g.setLineDash([6, 4]); g.beginPath(); const [c, d] = toM(z.nc.x, z.nc.y); g.arc(c, d, z.nr * scale, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
  }

  drawBigMap() {
    const c = $('bigmapCanvas'), g = c.getContext('2d');
    const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
    const S = Math.min(W, H);
    g.drawImage(this.world.mapCanvas, 0, 0, S, S);
    const sc = S / MAP_SIZE;
    const toM = (x, z) => [(x + HALF) * sc, (z + HALF) * sc];
    this.drawZone(g, toM, sc);
    if (this.player.state === 'plane' || this.planeT * this.flight.speed < this.flight.len) {
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.setLineDash([10, 8]); g.lineWidth = 2;
      const [a, b] = toM(this.flight.a.x, this.flight.a.z), e = this.flight.a.clone().addScaledVector(this.flight.dir, this.flight.len), [cx, cy] = toM(e.x, e.z);
      g.beginPath(); g.moveTo(a, b); g.lineTo(cx, cy); g.stroke(); g.setLineDash([]);
    }
    const p = this.player.state === 'plane' ? this.planePos() : this.player.pos;
    const [px, py] = toM(p.x, p.z);
    g.save(); g.translate(px, py); g.rotate(-this.camYaw); g.fillStyle = '#ffe28a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
  }

  // ---------------- loop ----------------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state === 'playing' || this.state === 'ended') {
      this.time += this.state === 'playing' ? dt : 0;
      // plane
      if (this.plane.visible) {
        this.planeT += dt;
        const pp = this.planePos();
        this.plane.position.copy(pp);
        this.plane.rotation.y = Math.atan2(-this.flight.dir.x, -this.flight.dir.z);
        this.plane.userData.props.forEach(pr => (pr.rotation.z += dt * 40));
        const d = pp.distanceTo(this.camera.position);
        this.audio.setEngine(this.player.state === 'plane' ? 0.12 : Math.max(0, 0.12 - d / 3000));
        if (this.planeT * this.flight.speed > this.flight.len) {
          for (const a of this.actors) if (a.state === 'plane') this.jump(a);
          if (this.planeT * this.flight.speed > this.flight.len + 600) { this.plane.visible = false; this.audio.setEngine(0); }
        }
      }
      if (this.state === 'playing') {
        this.updateZone(dt);
        this.updatePlayer(dt);
        for (const a of this.actors) if (!a.isPlayer && a.alive) this.updateBot(a, dt);
        this.updateBullets(dt);
        this.updateGrenades(dt);
      }
      this.updateCamera(dt);
      for (const a of this.actors) {
        if (a.state === 'plane') { a.soldier.gunSocket.visible = false; continue; }
        const r = a.soldier.root;
        r.position.copy(a.pos); r.rotation.y = a.yaw;   // the character model faces -Z, like the camera
        const fppBody = a.isPlayer && this.viewMode === 'fpp' && a.state === 'ground' && a.alive;
        if (fppBody) r.position.add(new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(0.22));   // keep the torso behind the eye
        const far = a.pos.distanceTo(this.camera.position);
        if (!a.isPlayer) r.visible = far < 700;
        this.placeGun(a, dt);
        if (!r.visible) a.soldier.gunSocket.visible = false;
        // distant soldiers animate at a lower rate
        a.animAcc = (a.animAcc || 0) + dt;
        if (r.visible && (far < 120 || a.animAcc > 0.1)) { a.soldier.animate(a.animAcc, { armed: !!a.weapons[a.cur] && a.soldier.gunSocket.visible, speed: Math.hypot(a.vel.x, a.vel.z), crouch: a.crouch, pitch: fppBody ? 0 : a.pitch, dead: !a.alive, airborne: a.state === 'air', parachute: a.state === 'chute' }); a.animAcc = 0; }
      }
      const p = this.player;
      const lp = p.state === 'plane' ? this.planePos() : p.pos;
      this.world.update(dt, lp, this.camera.position);
      this.updateFX(dt);
      this.fx.update(dt, this.camera, this.renderer);
      if (this.grade) this.grade.uniforms.uTime.value += dt;
      // sun follows the camera; snap to shadow texels to prevent shimmer
      const tex = (this.shadowExt * 2) / this.shadowSize;
      const c = this.camera.position;
      const tgt = new THREE.Vector3(Math.round(c.x / tex) * tex, Math.round(c.y / tex) * tex, Math.round(c.z / tex) * tex);
      this.sun.target.position.copy(tgt);
      this.sun.position.copy(tgt).addScaledVector(this.sunDir, 400);
      this.audio.setListener(this.camera.position, this.aimDir(), new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion));
      this.audio.lastPos = this.camera.position; this.audio.ambientBirds = p.state === 'ground';
      if (this.state === 'playing') this.updateHUD(dt);
    }
    if (this.composer) this.composer.render(dt); else if (this.renderer) this.renderer.render(this.scene, this.camera);
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) { $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' fps'; this.fpsAcc = 0; this.fpsN = 0; }
  }
}

// ---------------- helpers ----------------
// Filmic grade in linear light: gentle contrast, warm highlights, cool shadows, vignette, fine grain.
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    void main(){
      vec4 src = texture2D(tDiffuse, vUv); vec3 c = max(src.rgb, 0.0);
      vec3 l = log2(c + 1e-4); l = (l - log2(0.18)) * 1.06 + log2(0.18); c = exp2(l);
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(lum), c, 0.9);
      c *= mix(vec3(0.94, 0.99, 1.05), vec3(1.05, 1.0, 0.92), smoothstep(0.05, 0.6, lum));
      vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.6;
      float n = fract(sin(dot(vUv * 1000.0 + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c *= 1.0 + (n - 0.5) * 0.035;
      gl_FragColor = vec4(c, src.a);
    }`,
};

function nearestDoor(b, p) { return b.doors.reduce((best, d) => (!best || d.out.distanceToSquared(p) < best.out.distanceToSquared(p) ? d : best), null); }
async function loadPacked(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} (${r.status})`);
  const s = (await r.json()).b64;
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function tick() { return new Promise(r => setTimeout(r, 0)); }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); return t >= 0 ? t : null;
}
function segCapsule(o, d, L, a, b, r) {
  // sample-based closest approach between ray segment and capsule axis
  const ab = new THREE.Vector3().subVectors(b, a);
  const steps = Math.max(2, Math.ceil(L / 0.15));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * L;
    const p = new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    const k = clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
    const q = a.clone().addScaledVector(ab, k);
    if (p.distanceToSquared(q) < r * r) return t;
  }
  return null;
}
function distPointSeg(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a); const t = clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function flashTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.translate(64, 64);
  for (let i = 0; i < 7; i++) { g.rotate(Math.PI * 2 / 7 + Math.random() * 0.3); const gr = g.createLinearGradient(0, 0, 60, 0); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,140,40,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -5); g.lineTo(58 * (0.6 + Math.random() * 0.4), 0); g.lineTo(0, 5); g.fill(); }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = gr; g.fillRect(-30, -30, 60, 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function analyzeHDR(tex) {
  const { data, width, height } = tex.image;
  const isHalf = data instanceof Uint16Array;
  const get = (i) => (isHalf ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const ch = data.length / (width * height);
  let best = -1, bi = 0;
  const hor = new THREE.Color(0, 0, 0), amb = new THREE.Color(0, 0, 0); let nh = 0, na = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * ch;
    const r = get(i), g = get(i + 1), b = get(i + 2);
    const l = r * 0.3 + g * 0.6 + b * 0.1;
    if (l > best) { best = l; bi = y * width + x; }
    const v = y / height;
    if (v > 0.44 && v < 0.5) { hor.r += Math.min(r, 4); hor.g += Math.min(g, 4); hor.b += Math.min(b, 4); nh++; }
    if (v < 0.4) { amb.r += Math.min(r, 3); amb.g += Math.min(g, 3); amb.b += Math.min(b, 3); na++; }
  }
  const sx = bi % width, sy = Math.floor(bi / width);
  const phi = (sx / width) * Math.PI * 2, theta = (sy / height) * Math.PI;
  // three's equirect mapping: u = atan(dir.z, dir.x)/(2pi)+0.5, v = asin(dir.y)/pi + 0.5 (flipY)
  const elev = Math.PI / 2 - theta;
  const az = phi - Math.PI;
  let sunDir = new THREE.Vector3(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)).normalize();
  if (sunDir.y < 0.25) sunDir.y = 0.25, sunDir.normalize();
  hor.multiplyScalar(1 / Math.max(1, nh)); amb.multiplyScalar(1 / Math.max(1, na));
  const horizon = new THREE.Color(hor.r, hor.g, hor.b);
  // fog colour must match the tone-mapped sky; approximate ACES-ish compression
  horizon.r = horizon.r / (1 + horizon.r); horizon.g = horizon.g / (1 + horizon.g); horizon.b = horizon.b / (1 + horizon.b);
  horizon.multiplyScalar(1.35);
  return { sunDir, sunColor: new THREE.Color(1.0, 0.95, 0.86), horizon, ambient: new THREE.Color(Math.min(1, amb.r * 0.6), Math.min(1, amb.g * 0.6), Math.min(1, amb.b * 0.6)) };
}
function loadSettings() {
  const def = { quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'high', sens: 1, fov: 80, view: 'tpp', bots: 29, adsHold: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem('warbattle.settings') || '{}') }; } catch { return def; }
}
function saveSettings(s) { try { localStorage.setItem('warbattle.settings', JSON.stringify(s)); } catch { } }

window.__game = new Game();
