// Warbattle world: procedural island "Kestrel Island" with towns, roads, forests,
// buildings and CC0 props. Provides height queries and collision/raycast helpers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm, mulberry32, clamp, lerp, smoothstep } from './noise.js';

export const MAP_SIZE = 1600;           // metres, square
export const HALF = MAP_SIZE / 2;
const N = 320;                          // terrain grid segments
const CELL = MAP_SIZE / N;
const GRID_CELL = 16;                   // collision hash cell size
const GW = Math.ceil(MAP_SIZE / GRID_CELL);

const TOWN_NAMES = ['Harrowgate', 'Millbrook', 'Stonereach', 'Pike Landing', 'Eastmoor', 'Copper Quarry', 'Fenwick', 'Ridgeback Base', 'Larkspur', 'Old Saltworks'];

export class World {
  constructor(scene, assets, quality, seed = 7319) {
    this.scene = scene;
    this.assets = assets;
    this.q = quality;
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed * 3 + 11);
    this.boxes = [];       // {min:Vector3,max:Vector3,mat}
    this.trees = [];       // {x,z,r,h}
    this.grid = Array.from({ length: GW * GW }, () => ({ b: [], t: [] }));
    this.stamp = 0; this.boxStamp = []; this.treeStamp = [];
    this.lootSpots = [];   // {pos:Vector3, tier}
    this.towns = [];
    this.roads = [];       // [ax,az,bx,bz]
    this.buildings = [];   // {x,z,w,d,rot}
    this.uniforms = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() } };
  }

  // ---------- height field ----------
  rawHeight(x, z) {
    const n = this.noise;
    const r = Math.hypot(x, z);
    const coastNoise = fbm(n, x * 0.0021 + 40, z * 0.0021 - 13, 4) * 0.16;
    const rn = r / 690 + coastNoise;
    const land = 1 - smoothstep(0.78, 1.02, rn);
    const hills = fbm(n, x * 0.0024, z * 0.0024, 5) * 0.5 + 0.5;
    let h = 3 + hills * 34;
    // ridged mountains in the north-west
    const ridge = 1 - Math.abs(fbm(this.noise2, x * 0.0019, z * 0.0019, 4));
    const mMask = smoothstep(120, -320, z + x * 0.35) * smoothstep(0.85, 0.45, rn);
    h += Math.pow(ridge, 3) * 95 * mMask;
    // small detail
    h += fbm(this.noise2, x * 0.02, z * 0.02, 3) * 1.6;
    // beach shelf
    h = lerp(-16, h, land);
    if (h > -1 && h < 3) h = lerp(h, 1.2, 0.35);
    return h;
  }

  buildHeights() {
    // choose towns first (need raw heights)
    const rand = this.rand;
    let tries = 0;
    while (this.towns.length < TOWN_NAMES.length && tries < 4000) {
      tries++;
      const x = (rand() * 2 - 1) * 560, z = (rand() * 2 - 1) * 560;
      const h = this.rawHeight(x, z);
      if (h < 6 || h > 55) continue;
      const slope = Math.abs(this.rawHeight(x + 20, z) - h) + Math.abs(this.rawHeight(x, z + 20) - h);
      if (slope > 9) continue;
      if (this.towns.some(t => Math.hypot(t.x - x, t.z - z) < 230)) continue;
      const i = this.towns.length;
      const isBase = TOWN_NAMES[i] === 'Ridgeback Base';
      this.towns.push({ name: TOWN_NAMES[i], x, z, h, R: isBase ? 70 : 55 + rand() * 30, military: isBase });
    }
    // roads: chain towns by nearest neighbour + a few extra links
    const pts = this.towns.slice();
    const used = new Set([0]);
    while (used.size < pts.length) {
      let best = null;
      for (const i of used) for (let j = 0; j < pts.length; j++) {
        if (used.has(j)) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        if (!best || d < best.d) best = { i, j, d };
      }
      used.add(best.j);
      this.addRoad(pts[best.i], pts[best.j]);
    }
    for (let k = 0; k < 3; k++) {
      const a = pts[Math.floor(rand() * pts.length)], b = pts[Math.floor(rand() * pts.length)];
      if (a !== b && Math.hypot(a.x - b.x, a.z - b.z) < 600) this.addRoad(a, b);
    }

    const S = N + 1;
    this.h = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      let h = this.rawHeight(x, z);
      for (const t of this.towns) {
        const d = Math.hypot(x - t.x, z - t.z);
        const w = smoothstep(t.R + 60, t.R * 0.7, d);
        h = lerp(h, t.h, w);
      }
      // gently flatten along roads
      const rd = this.roadDist(x, z);
      if (rd.d < 14 && h > 0.5) {
        const target = lerp(rd.ha, rd.hb, rd.t);
        h = lerp(h, Math.max(target, h - 2.5), smoothstep(14, 4, rd.d) * 0.5);
      }
      this.h[j * S + i] = h;
    }
  }

  addRoad(a, b) {
    // subdivide with slight meander
    const segs = Math.max(2, Math.floor(Math.hypot(a.x - b.x, a.z - b.z) / 60));
    let px = a.x, pz = a.z;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      let x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
      if (s < segs) { x += this.noise(t * 3, a.x * 0.01) * 25; z += this.noise(a.z * 0.01, t * 3) * 25; }
      this.roads.push([px, pz, x, z, this.rawHeight(px, pz), this.rawHeight(x, z)]);
      px = x; pz = z;
    }
  }

  roadDist(x, z) {
    let best = { d: 1e9, t: 0, ha: 0, hb: 0 };
    for (const r of this.roads) {
      const [ax, az, bx, bz] = r;
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = clamp(t, 0, 1);
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best.d) best = { d, t, ha: r[4], hb: r[5] };
    }
    return best;
  }

  getHeight(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = clamp(Math.floor(fx), 0, N - 1), j = clamp(Math.floor(fz), 0, N - 1);
    const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
    const S = N + 1, H = this.h;
    const a = H[j * S + i], b = H[j * S + i + 1], c = H[(j + 1) * S + i], d = H[(j + 1) * S + i + 1];
    // match the triangle split used by PlaneGeometry (a,c,b) / (c,d,b)
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    out.set(this.getHeight(x - e, z) - this.getHeight(x + e, z), 2 * e, this.getHeight(x, z - e) - this.getHeight(x, z + e));
    return out.normalize();
  }

  forestMask(x, z) {
    return smoothstep(0.02, 0.28, fbm(this.noise2, x * 0.0035 + 100, z * 0.0035 - 50, 4));
  }

  // ---------- build everything ----------
  build(onProgress = () => {}) {
    this.buildHeights(); onProgress(0.1);
    this.buildTerrain(); onProgress(0.25);
    this.buildWater(); onProgress(0.3);
    this.buildBuildings(); onProgress(0.5);
    this.buildTrees(); onProgress(0.7);
    this.buildProps(); onProgress(0.85);
    this.buildGrass(); onProgress(0.92);
    this.buildMapImage(); onProgress(1);
  }

  buildTerrain() {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const S = N + 1;
    const splat = new Float32Array(pos.count * 4);
    const tint = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const i = k % S, j = Math.floor(k / S);
      const x = pos.getX(k), z = pos.getZ(k);
      const h = this.h[j * S + i];
      pos.setY(k, h);
      const hx = this.h[j * S + Math.min(i + 1, N)] - this.h[j * S + Math.max(i - 1, 0)];
      const hz = this.h[Math.min(j + 1, N) * S + i] - this.h[Math.max(j - 1, 0) * S + i];
      const slope = Math.hypot(hx, hz) / (2 * CELL);
      let rock = smoothstep(0.45, 0.85, slope) + smoothstep(70, 95, h) * 0.8;
      let dirt = 0;
      const rd = this.roadDist(x, z).d;
      dirt += smoothstep(5.5, 2.5, rd);
      for (const t of this.towns) dirt += smoothstep(t.R * 0.9, t.R * 0.3, Math.hypot(x - t.x, z - t.z)) * (0.55 + 0.45 * this.noise(x * 0.05, z * 0.05));
      if (h < 2.2) dirt += smoothstep(2.2, 0.8, h);
      rock = clamp(rock, 0, 1);
      dirt = clamp(dirt, 0, 1);
      const forest = this.forestMask(x, z) * (1 - rock);
      const grass = Math.max(0, 1 - rock - forest);
      const sum = grass + forest + rock + dirt * 1.5 + 1e-4;
      splat[k * 4] = grass / sum; splat[k * 4 + 1] = forest / sum; splat[k * 4 + 2] = rock / sum; splat[k * 4 + 3] = dirt * 1.5 / sum;
      tint[k] = fbm(this.noise, x * 0.008, z * 0.008, 3);
    }
    this.splat = splat;
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
    geo.computeVertexNormals();

    const T = this.assets.tex;
    const layers = ['grass', 'forest', 'rock', 'dirt'];
    const mat = new THREE.MeshStandardMaterial({ map: T.grass.diff, normalMap: T.grass.nor, roughness: 1, metalness: 0 });
    mat.normalScale.set(1.2, 1.2);
    const uniforms = {};
    layers.forEach((l, i) => { uniforms['tD' + i] = { value: T[l].diff }; uniforms['tN' + i] = { value: T[l].nor }; });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat; attribute float tint; varying vec4 vSplat; varying float vTint; varying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vTint = tint; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tD0,tD1,tD2,tD3,tN0,tN1,tN2,tN3;
varying vec4 vSplat; varying float vTint; varying vec3 vWPos;
vec4 tri(sampler2D t, vec2 uv){ return mix(texture2D(t, uv), texture2D(t, uv*0.231+0.37), 0.45); }
vec4 splatW(){ vec4 w = vSplat; w.w *= 1.0; return w / max(dot(w, vec4(1.0)), 1e-3); }`)
        .replace('#include <map_fragment>', `
vec2 tUv = vWPos.xz / 6.0;
vec4 w = splatW();
vec3 c0 = tri(tD0, tUv*0.5).rgb * vec3(0.78,1.0,0.66), c1 = tri(tD1, tUv).rgb, c2 = tri(tD2, tUv*0.7).rgb, c3 = tri(tD3, tUv).rgb;
c2 = mix(c2, vec3(dot(c2, vec3(0.33))) * vec3(1.05,1.02,0.98), 0.65);
vec3 tcol = c0*w.x + c1*w.y + c2*w.z + c3*w.w;
tcol *= 0.82 + vTint*0.28;
float sandW = smoothstep(2.6, 1.0, vWPos.y);
tcol = mix(tcol, vec3(0.62,0.55,0.42) * (0.85+0.3*c3.r), sandW*0.85);
tcol = mix(tcol, tcol*vec3(0.55,0.6,0.62), smoothstep(0.6,-1.5,vWPos.y));
diffuseColor.rgb *= tcol;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.97, 0.55, smoothstep(0.4,-0.8,vWPos.y));')
        .replace('#include <normal_fragment_maps>', `
{ vec4 w2 = splatW();
  vec3 n0 = texture2D(tN0, tUv*0.5).xyz, n1 = texture2D(tN1, tUv).xyz, n2 = texture2D(tN2, tUv*0.7).xyz, n3 = texture2D(tN3, tUv).xyz;
  vec3 mapN = (n0*w2.x + n1*w2.y + n2*w2.z + n3*w2.w) * 2.0 - 1.0;
  mapN.xy *= normalScale;
  mat3 tbn2 = getTangentFrame( - vViewPosition, normal, tUv );
  normal = normalize( tbn2 * mapN ); }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  buildWater() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    const n = createNoise2D(99);
    const hgt = (x, y) => {
      const f = (a, b, s) => n(Math.cos(a / 256 * Math.PI * 2) * s + 9, Math.sin(a / 256 * Math.PI * 2) * s) * 0.5 + n(Math.cos(b / 256 * Math.PI * 2) * s, Math.sin(b / 256 * Math.PI * 2) * s + 3) * 0.5;
      return f(x, y, 1.2) + f(x * 2 % 256, y * 2 % 256, 2.4) * 0.5;
    };
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const dx = hgt((x + 1) % 256, y) - hgt((x + 255) % 256, y);
      const dy = hgt(x, (y + 1) % 256) - hgt(x, (y + 255) % 256);
      const v = new THREE.Vector3(-dx * 2.5, -dy * 2.5, 1).normalize();
      const k = (y * 256 + x) * 4;
      img.data[k] = (v.x * 0.5 + 0.5) * 255; img.data[k + 1] = (v.y * 0.5 + 0.5) * 255; img.data[k + 2] = (v.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const nt = new THREE.CanvasTexture(c);
    nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
    nt.repeat.set(220, 220);
    const nt2 = nt.clone(); nt2.repeat.set(90, 90); nt2.needsUpdate = true;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0d3442, roughness: 0.06, metalness: 0.0, normalMap: nt, clearcoat: 1, clearcoatRoughness: 0.08,
      clearcoatNormalMap: nt2, transparent: true, opacity: 0.9, envMapIntensity: 1.2,
    });
    mat.normalScale.set(0.35, 0.35);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 1, 1).rotateX(-Math.PI / 2), mat);
    water.position.y = 0;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water; this.waterTex = [nt, nt2];
  }

  // ---------- collision registry ----------
  cellIndex(x, z) {
    const i = clamp(Math.floor((x + HALF) / GRID_CELL), 0, GW - 1);
    const j = clamp(Math.floor((z + HALF) / GRID_CELL), 0, GW - 1);
    return j * GW + i;
  }
  addBox(min, max, mat = 'stone') {
    const id = this.boxes.length;
    this.boxes.push({ min: min.clone(), max: max.clone(), mat });
    const i0 = clamp(Math.floor((min.x + HALF) / GRID_CELL), 0, GW - 1), i1 = clamp(Math.floor((max.x + HALF) / GRID_CELL), 0, GW - 1);
    const j0 = clamp(Math.floor((min.z + HALF) / GRID_CELL), 0, GW - 1), j1 = clamp(Math.floor((max.z + HALF) / GRID_CELL), 0, GW - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * GW + i].b.push(id);
    return id;
  }
  addTree(x, z, r, h) {
    const id = this.trees.length;
    this.trees.push({ x, z, r, h, y: this.getHeight(x, z) });
    this.grid[this.cellIndex(x, z)].t.push(id);
  }
  nearby(x, z, rad, fn) {
    const i0 = clamp(Math.floor((x - rad + HALF) / GRID_CELL), 0, GW - 1), i1 = clamp(Math.floor((x + rad + HALF) / GRID_CELL), 0, GW - 1);
    const j0 = clamp(Math.floor((z - rad + HALF) / GRID_CELL), 0, GW - 1), j1 = clamp(Math.floor((z + rad + HALF) / GRID_CELL), 0, GW - 1);
    this.stamp++;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.grid[j * GW + i];
      for (const b of c.b) { if (this.boxStamp[b] === this.stamp) continue; this.boxStamp[b] = this.stamp; fn('b', b); }
      for (const t of c.t) { if (this.treeStamp[t] === this.stamp) continue; this.treeStamp[t] = this.stamp; fn('t', t); }
    }
  }

  // Resolve a vertical capsule (feet at pos) against boxes and trees in XZ.
  collide(pos, radius, height) {
    this.nearby(pos.x, pos.z, radius + 2, (k, id) => {
      if (k === 'b') {
        const b = this.boxes[id];
        if (pos.y + height <= b.min.y + 0.01 || pos.y >= b.max.y - 0.45) return; // step over low boxes
        const cx = clamp(pos.x, b.min.x, b.max.x), cz = clamp(pos.z, b.min.z, b.max.z);
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = cx + dx / d * radius; pos.z = cz + dz / d * radius;
          } else {
            // inside: push out on smallest axis
            const px1 = pos.x - b.min.x, px2 = b.max.x - pos.x, pz1 = pos.z - b.min.z, pz2 = b.max.z - pos.z;
            const m = Math.min(px1, px2, pz1, pz2);
            if (m === px1) pos.x = b.min.x - radius; else if (m === px2) pos.x = b.max.x + radius;
            else if (m === pz1) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
          }
        }
      } else {
        const t = this.trees[id];
        if (pos.y > t.y + t.h) return;
        const dx = pos.x - t.x, dz = pos.z - t.z, rr = radius + t.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = t.x + dx / d * rr; pos.z = t.z + dz / d * rr; }
      }
    });
  }

  // Highest walkable surface at (x,z) not above y+step.
  groundAt(x, z, y, step = 0.55, radius = 0.25) {
    let g = this.getHeight(x, z);
    this.nearby(x, z, 1, (k, id) => {
      if (k !== 'b') return;
      const b = this.boxes[id];
      if (x < b.min.x - radius || x > b.max.x + radius || z < b.min.z - radius || z > b.max.z + radius) return;
      if (b.max.y <= y + step && b.max.y > g) g = b.max.y;
    });
    return g;
  }
  ceilingAt(x, z, y) {
    let c = Infinity;
    this.nearby(x, z, 1, (k, id) => {
      if (k !== 'b') return;
      const b = this.boxes[id];
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) return;
      if (b.min.y >= y && b.min.y < c) c = b.min.y;
    });
    return c;
  }

  // Segment cast a->b against terrain, boxes and trees. Returns nearest hit or null.
  raycast(a, b, ignoreTerrain = false) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return null;
    dir.divideScalar(len);
    let best = null;
    const consider = (t, normal, type, mat) => { if (t >= 0 && t <= len && (!best || t < best.t)) best = { t, normal, type, mat }; };
    // gather cells along segment
    const steps = Math.ceil(len / (GRID_CELL * 0.5)) + 1;
    this.stamp++;
    const visit = (ci) => {
      const c = this.grid[ci];
      for (const id of c.b) {
        if (this.boxStamp[id] === this.stamp) continue; this.boxStamp[id] = this.stamp;
        const bx = this.boxes[id];
        const r = rayBox(a, dir, bx.min, bx.max);
        if (r) consider(r.t, r.n, 'box', bx.mat);
      }
      for (const id of c.t) {
        if (this.treeStamp[id] === this.stamp) continue; this.treeStamp[id] = this.stamp;
        const tr = this.trees[id];
        const t = rayCyl(a, dir, tr.x, tr.z, tr.r);
        if (t !== null) { const y = a.y + dir.y * t; if (y > tr.y - 1 && y < tr.y + tr.h) consider(t, new THREE.Vector3(a.x + dir.x * t - tr.x, 0, a.z + dir.z * t - tr.z).normalize(), 'tree', 'wood'); }
      }
    };
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(len, (s / steps) * len);
      const x = a.x + dir.x * t, z = a.z + dir.z * t;
      for (let ox = -1; ox <= 1; ox += 2) for (let oz = -1; oz <= 1; oz += 2) {
        const ci = this.cellIndex(x + ox * 1.2, z + oz * 1.2);
        if (!seen.has(ci)) { seen.add(ci); visit(ci); }
      }
    }
    if (!ignoreTerrain) {
      const maxT = best ? best.t : len;
      const st = 1.5;
      let prevT = 0, prevAbove = a.y - this.getHeight(a.x, a.z);
      if (prevAbove < 0) consider(0, new THREE.Vector3(0, 1, 0), 'terrain', 'ground');
      else for (let t = st; t <= maxT + st; t += st) {
        const tt = Math.min(t, maxT);
        const x = a.x + dir.x * tt, y = a.y + dir.y * tt, z = a.z + dir.z * tt;
        const above = y - this.getHeight(x, z);
        if (above < 0) {
          let lo = prevT, hi = tt;
          for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; const yy = a.y + dir.y * m; if (yy - this.getHeight(a.x + dir.x * m, a.z + dir.z * m) < 0) hi = m; else lo = m; }
          const hx = a.x + dir.x * hi, hz = a.z + dir.z * hi;
          consider(hi, this.getNormal(hx, hz), a.y + dir.y * hi < 0.05 ? 'water' : 'terrain', 'ground');
          break;
        }
        prevT = tt; prevAbove = above;
        if (tt >= maxT) break;
      }
    }
    if (!best) return null;
    best.point = a.clone().addScaledVector(dir, best.t);
    best.dist = best.t;
    return best;
  }

  // ---------- buildings ----------
  buildBuildings() {
    const T = this.assets.tex;
    const mk = (k, rep = 1, extra = {}) => new THREE.MeshStandardMaterial({ map: T[k].diff, normalMap: T[k].nor, roughness: 0.92, metalness: 0, ...extra });
    this.mats = {
      brick: mk('brick'), plaster: mk('plaster'), concrete: mk('concrete'), wood: mk('wood'),
      roof: mk('roof', 1, { metalness: 0.55, roughness: 0.6 }),
      darkwood: mk('wood', 1, { color: 0x6b5847 }),
      paintedPlaster: mk('plaster', 1, { color: 0xc9b9a0 }),
      bluePlaster: mk('plaster', 1, { color: 0x9fb3b8 }),
    };
    this.buckets = {};
    const rand = this.rand;
    for (const town of this.towns) {
      const count = town.military ? 9 : Math.floor(10 + rand() * 8);
      let placed = 0, tries = 0;
      while (placed < count && tries < 400) {
        tries++;
        const ang = rand() * Math.PI * 2, dist = 10 + rand() * town.R;
        const x = town.x + Math.cos(ang) * dist, z = town.z + Math.sin(ang) * dist;
        let type;
        if (town.military) type = rand() < 0.45 ? 'hangar' : (rand() < 0.5 ? 'barracks' : 'tower');
        else { const r = rand(); type = r < 0.42 ? 'house' : r < 0.67 ? 'twostory' : r < 0.82 ? 'shed' : r < 0.93 ? 'warehouse' : 'ruin'; }
        const dims = { house: [9 + rand() * 3, 7 + rand() * 2], twostory: [10, 8], shed: [5, 4], warehouse: [20, 12], ruin: [8, 7], hangar: [22, 14], barracks: [16, 7], tower: [4, 4] }[type];
        const rot = Math.floor(rand() * 4);
        const [w, d] = rot % 2 ? [dims[1], dims[0]] : dims;
        const rad = Math.hypot(w, d) / 2 + 3;
        if (this.buildings.some(b => Math.hypot(b.x - x, b.z - z) < b.rad + rad)) continue;
        if (this.roadDist(x, z).d < rad + 3) continue;
        if (this.getHeight(x, z) < 3) continue;
        this.buildings.push({ x, z, w, d, rot, rad, type, town });
        placed++;
      }
    }
    // isolated cabins and ruins in the wilds
    for (let k = 0; k < 26; k++) {
      const x = (rand() * 2 - 1) * 600, z = (rand() * 2 - 1) * 600;
      const h = this.getHeight(x, z);
      if (h < 4 || h > 70) continue;
      const n = this.getNormal(x, z);
      if (n.y < 0.93) continue;
      if (this.buildings.some(b => Math.hypot(b.x - x, b.z - z) < 30)) continue;
      const type = rand() < 0.6 ? 'shed' : rand() < 0.5 ? 'ruin' : 'house';
      const dims = { shed: [5, 4], ruin: [8, 7], house: [9, 7] }[type];
      const rot = Math.floor(rand() * 4);
      const [w, d] = rot % 2 ? [dims[1], dims[0]] : dims;
      this.buildings.push({ x, z, w, d, rot, rad: Math.hypot(w, d) / 2 + 3, type, town: null });
    }
    for (const b of this.buildings) this.makeBuilding(b);
    // military perimeter walls
    for (const t of this.towns.filter(t => t.military)) {
      const R = t.R + 12, segs = 28;
      for (let i = 0; i < segs; i++) {
        if (i % 7 === 0) continue; // gates
        const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
        const x0 = t.x + Math.cos(a0) * R, z0 = t.z + Math.sin(a0) * R, x1 = t.x + Math.cos(a1) * R, z1 = t.z + Math.sin(a1) * R;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
        const g = this.getHeight(cx, cz);
        const geo = boxUV(len + 0.3, 5.5, 0.4, 3);
        const m = new THREE.Matrix4().makeRotationY(-Math.atan2(z1 - z0, x1 - x0)).setPosition(cx, g + 0.05, cz);
        geo.applyMatrix4(m);
        this.push('concrete', geo);
        // approximate collider as a few boxes along the segment
        const pieces = Math.ceil(len / 2);
        for (let p = 0; p < pieces; p++) {
          const t2 = (p + 0.5) / pieces; const px = lerp(x0, x1, t2), pz = lerp(z0, z1, t2);
          this.addBox(new THREE.Vector3(px - 1.1, g - 0.4, pz - 1.1), new THREE.Vector3(px + 1.1, g + 2.8, pz + 1.1), 'stone');
        }
      }
    }
    for (const [k, list] of Object.entries(this.buckets)) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, this.mats[k]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    this.buckets = null;
  }

  push(mat, geo) { (this.buckets[mat] ||= []).push(geo); }

  // Add an oriented box in building-local space (rot multiple of 90deg) and register a collider.
  bbox(B, mat, lx, ly, lz, sx, sy, sz, collide = true, colMat) {
    const geo = boxUV(sx, sy, sz, mat === 'roof' ? 2 : 2.5);
    const m = new THREE.Matrix4().makeRotationY(-B.rot * Math.PI / 2);
    const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(m);
    m.setPosition(B.x + p.x, B.y + p.y, B.z + p.z);
    geo.applyMatrix4(m);
    this.push(mat, geo);
    if (collide) {
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      this.addBox(bb.min, bb.max, colMat || (mat === 'roof' ? 'metal' : mat === 'wood' || mat === 'darkwood' ? 'wood' : 'stone'));
    }
  }

  // wall along local X axis from x0..x1 at z, with openings [{c,w,y0,y1}]
  wallX(B, mat, x0, x1, z, y0, h, openings = [], th = 0.25) {
    let cur = x0;
    const ops = openings.slice().sort((a, b) => a.c - b.c);
    for (const o of ops) {
      const a = o.c - o.w / 2, b = o.c + o.w / 2;
      if (a > cur) this.bbox(B, mat, (cur + a) / 2, y0 + h / 2, z, a - cur, h, th);
      if (o.y0 > 0.01) this.bbox(B, mat, o.c, y0 + o.y0 / 2, z, o.w, o.y0, th);
      if (o.y1 < h) this.bbox(B, mat, o.c, y0 + (o.y1 + h) / 2, z, o.w, h - o.y1, th);
      cur = b;
    }
    if (x1 > cur) this.bbox(B, mat, (cur + x1) / 2, y0 + h / 2, z, x1 - cur, h, th);
  }
  wallZ(B, mat, z0, z1, x, y0, h, openings = [], th = 0.25) {
    let cur = z0;
    const ops = openings.slice().sort((a, b) => a.c - b.c);
    for (const o of ops) {
      const a = o.c - o.w / 2, b = o.c + o.w / 2;
      if (a > cur) this.bbox(B, mat, x, y0 + h / 2, (cur + a) / 2, th, h, a - cur);
      if (o.y0 > 0.01) this.bbox(B, mat, x, y0 + o.y0 / 2, o.c, th, o.y0, o.w);
      if (o.y1 < h) this.bbox(B, mat, x, y0 + (o.y1 + h) / 2, o.c, th, h - o.y1, o.w);
      cur = b;
    }
    if (z1 > cur) this.bbox(B, mat, x, y0 + h / 2, (cur + z1) / 2, th, h, z1 - cur);
  }

  gable(B, W, D, y, mat) {
    // pitched roof along local X (ridge along X); W along x, D along z
    const pitch = 0.5, half = D / 2 + 0.35;
    const rise = half * Math.tan(pitch);
    const len = half / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const geo = boxUV(W + 0.7, 0.12, len, 2);
      const m = new THREE.Matrix4().makeRotationX(s * pitch);
      m.premultiply(new THREE.Matrix4().makeTranslation(0, y + rise / 2, s * half / 2));
      m.premultiply(new THREE.Matrix4().makeRotationY(-B.rot * Math.PI / 2));
      m.premultiply(new THREE.Matrix4().makeTranslation(B.x, B.y, B.z));
      geo.applyMatrix4(m);
      this.push(mat, geo);
    }
    // gable end triangles
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, rise - 0.05)]);
      const geo = new THREE.ShapeGeometry(shape);
      const uv = geo.attributes.uv, p = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 2.5, p.getY(i) / 2.5);
      const m = new THREE.Matrix4().makeRotationY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
      m.premultiply(new THREE.Matrix4().makeTranslation(s * W / 2, y, 0));
      m.premultiply(new THREE.Matrix4().makeRotationY(-B.rot * Math.PI / 2));
      m.premultiply(new THREE.Matrix4().makeTranslation(B.x, B.y, B.z));
      geo.applyMatrix4(m);
      geo.deleteAttribute('normal'); geo.computeVertexNormals();
      this.push('plaster', toNonIndexedCompat(geo));
    }
    // approximate roof collider so bullets stop
    this.bbox(B, mat, 0, y + rise * 0.4, 0, W, rise * 0.8, D * 0.8, true, 'metal');
    this.buckets[mat].pop(); // collider only
  }

  door(B, lx, lz) {
    const m = new THREE.Matrix4().makeRotationY(-B.rot * Math.PI / 2);
    const [W, D] = B.rot % 2 ? [B.d, B.w] : [B.w, B.d];
    const out = new THREE.Vector3(lx, 0, lz + 1.6).applyMatrix4(m).add(new THREE.Vector3(B.x, 0, B.z));
    const inn = new THREE.Vector3(lx, 0, lz - 1.4).applyMatrix4(m).add(new THREE.Vector3(B.x, 0, B.z));
    (B.doors ||= []).push({ out, in: inn });
    // front step so the threshold is easy to walk onto
    const g = this.getHeight(out.x, out.z);
    if (B.y - g > 0.25) this.bbox(B, 'concrete', lx, -(B.y - g) / 2 - 0.12, lz + 0.55, 1.6, B.y - g + 0.0, 0.7);
  }

  // building whose footprint contains (x,z)
  buildingAt(x, z, pad = 0) {
    for (const b of this.buildings) if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return b;
    return null;
  }

  loot(B, lx, ly, lz, tier = 1) {
    const m = new THREE.Matrix4().makeRotationY(-B.rot * Math.PI / 2);
    const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(m);
    this.lootSpots.push({ pos: new THREE.Vector3(B.x + p.x, B.y + p.y, B.z + p.z), tier });
  }

  makeBuilding(B) {
    const rand = this.rand;
    // local dims (before rotation): W along x, D along z
    const [W, D] = B.rot % 2 ? [B.d, B.w] : [B.w, B.d];
    // foundation height
    let gmin = Infinity, gmax = -Infinity;
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const g = this.getHeight(B.x + cx * B.w / 2, B.z + cz * B.d / 2);
      gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
    }
    B.y = gmax + 0.3;
    const fh = B.y - gmin + 0.6;
    const t = B.type;
    const wallMat = t === 'warehouse' || t === 'hangar' ? 'roof' : t === 'shed' ? 'darkwood' : t === 'barracks' || t === 'tower' ? 'concrete' : ['brick', 'plaster', 'paintedPlaster', 'bluePlaster'][Math.floor(rand() * 4)];
    // foundation / floor slab
    this.bbox(B, 'concrete', 0, -fh / 2, 0, W + 0.3, fh, D + 0.3);
    const tier = B.town?.military ? 2 : 1;
    if (t === 'house' || t === 'barracks') {
      const H = 3.1;
      const door = { c: 0, w: 1.15, y0: 0, y1: 2.2 };
      const win = (c) => ({ c, w: 1.3, y0: 0.95, y1: 2.15 });
      this.wallX(B, wallMat, -W / 2, W / 2, D / 2, 0, H, [door, win(-W / 3.2), win(W / 3.2)]);
      this.door(B, 0, D / 2);
      this.wallX(B, wallMat, -W / 2, W / 2, -D / 2, 0, H, [win(-W / 4), win(W / 4), { c: W / 2 - 1.2, w: 1.0, y0: 0, y1: 2.15 }]);
      this.wallZ(B, wallMat, -D / 2 + 0.125, D / 2 - 0.125, -W / 2, 0, H, [win(0)]);
      this.wallZ(B, wallMat, -D / 2 + 0.125, D / 2 - 0.125, W / 2, 0, H, [win(0)]);
      // interior partition with doorway
      this.wallZ(B, 'plaster', -D / 2 + 0.125, D / 2 - 0.125, -W / 6, 0, H, [{ c: D / 4, w: 1.0, y0: 0, y1: 2.15 }], 0.15);
      this.bbox(B, 'plaster', 0, H + 0.08, 0, W, 0.16, D);
      if (t === 'barracks') this.bbox(B, 'concrete', 0, H + 0.4, 0, W + 0.4, 0.5, D + 0.4);
      else this.gable(B, W, D, H + 0.16, 'roof');
      this.loot(B, -W / 3, 0.02, -D / 5, tier); this.loot(B, W / 4, 0.02, D / 6, tier); this.loot(B, W / 5, 0.02, -D / 4, tier);
    } else if (t === 'twostory') {
      const H = 3.0;
      const win = (c) => ({ c, w: 1.2, y0: 0.95, y1: 2.1 });
      for (let f = 0; f < 2; f++) {
        const y0 = f * (H + 0.2);
        this.wallX(B, wallMat, -W / 2, W / 2, D / 2, y0, H, f === 0 ? [{ c: 1, w: 1.15, y0: 0, y1: 2.2 }, win(-3)] : [win(-2.5), win(2.5)]);
        if (f === 0) this.door(B, 1, D / 2);
        this.wallX(B, wallMat, -W / 2, W / 2, -D / 2, y0, H, [win(-2.5), win(2.5)]);
        this.wallZ(B, wallMat, -D / 2 + 0.125, D / 2 - 0.125, -W / 2, y0, H, [win(1)]);
        this.wallZ(B, wallMat, -D / 2 + 0.125, D / 2 - 0.125, W / 2, y0, H, f === 0 ? [] : [win(0)]);
      }
      // stairs along +x wall, rising toward -z
      const steps = 16, sw = 1.1, x = W / 2 - 0.75;
      for (let s = 0; s < steps; s++) {
        const top = (s + 1) * (H + 0.2) / steps;
        this.bbox(B, 'wood', x, top / 2, D / 2 - 1.0 - s * 0.32, sw, top, 0.32);
      }
      // upper floor slab with stair hole (hole x in [W/2-1.4, W/2], z in [D/2-6.3, D/2-0.6])
      const hx = W / 2 - 1.4;
      this.bbox(B, 'concrete', (-W / 2 + hx) / 2, H + 0.1, 0, hx + W / 2, 0.2, D);
      this.bbox(B, 'concrete', (hx + W / 2) / 2, H + 0.1, -D / 2 + 0.5, W / 2 - hx, 0.2, 1.0);
      this.bbox(B, 'concrete', (hx + W / 2) / 2, H + 0.1, D / 2 - 0.25, W / 2 - hx, 0.2, 0.5);
      this.bbox(B, 'plaster', 0, 2 * H + 0.3, 0, W, 0.16, D);
      this.gable(B, W, D, 2 * H + 0.38, 'roof');
      this.loot(B, -W / 3, 0.02, 0, tier); this.loot(B, 0, 0.02, -D / 4, tier);
      this.loot(B, -W / 3, H + 0.22, D / 5, tier); this.loot(B, 0, H + 0.22, -D / 4, tier);
    } else if (t === 'shed') {
      const H = 2.6;
      this.wallX(B, wallMat, -W / 2, W / 2, D / 2, 0, H, [{ c: 0, w: 1.1, y0: 0, y1: 2.1 }], 0.12);
      this.door(B, 0, D / 2);
      this.wallX(B, wallMat, -W / 2, W / 2, -D / 2, 0, H, [{ c: 0, w: 0.9, y0: 1.0, y1: 1.8 }], 0.12);
      this.wallZ(B, wallMat, -D / 2, D / 2, -W / 2, 0, H, [], 0.12);
      this.wallZ(B, wallMat, -D / 2, D / 2, W / 2, 0, H, [], 0.12);
      this.bbox(B, 'roof', 0, H + 0.1, 0, W + 0.6, 0.1, D + 0.6);
      this.loot(B, 0, 0.02, -D / 6, tier);
    } else if (t === 'warehouse' || t === 'hangar') {
      const H = t === 'hangar' ? 8 : 6.5;
      const big = { c: 0, w: t === 'hangar' ? 8 : 5, y0: 0, y1: t === 'hangar' ? 6 : 4.5 };
      this.wallX(B, 'roof', -W / 2, W / 2, D / 2, 0, H, [big], 0.15);
      this.door(B, 0, D / 2);
      this.wallX(B, 'roof', -W / 2, W / 2, -D / 2, 0, H, [{ c: -W / 4, w: 1.2, y0: 0, y1: 2.2 }], 0.15);
      this.wallZ(B, 'roof', -D / 2, D / 2, -W / 2, 0, H, [{ c: 0, w: 1.2, y0: 0, y1: 2.2 }], 0.15);
      this.wallZ(B, 'roof', -D / 2, D / 2, W / 2, 0, H, [], 0.15);
      this.bbox(B, 'roof', 0, H + 0.1, 0, W + 0.4, 0.15, D + 0.4);
      // shelving / catwalk
      for (let i = -1; i <= 1; i += 2) this.bbox(B, 'wood', i * W / 4, 1.1, -D / 2 + 1.2, W / 3, 2.2, 1.2);
      this.bbox(B, 'concrete', W / 2 - 2, 2.2, 0, 3.5, 0.2, D - 2);
      for (let s = 0; s < 10; s++) this.bbox(B, 'wood', W / 2 - 4.4 + s * 0, (s + 1) * 0.22 / 2, D / 2 - 2 - s * 0.35 - 2, 1.0, (s + 1) * 0.22, 0.35);
      this.loot(B, -W / 4, 2.21, -D / 2 + 1.2, tier + 1); this.loot(B, W / 4, 2.21, -D / 2 + 1.2, tier);
      this.loot(B, 0, 0.02, 0, tier); this.loot(B, W / 2 - 2, 2.31, 0, tier + 1); this.loot(B, -W / 3, 0.02, D / 4, tier);
    } else if (t === 'ruin') {
      const H = 1.2 + rand() * 2;
      this.wallX(B, 'brick', -W / 2, W / 2 * 0.3, D / 2, 0, H, [{ c: -1, w: 1.2, y0: 0, y1: 2.2 }], 0.3);
      this.wallZ(B, 'brick', -D / 2, D / 2, -W / 2, 0, H + 0.8, [{ c: 0, w: 1.2, y0: 0.9, y1: 2.0 }], 0.3);
      this.wallX(B, 'brick', -W / 2 * 0.2, W / 2, -D / 2, 0, H * 0.7, [], 0.3);
      this.loot(B, 0, 0.02, 0, tier);
    } else if (t === 'tower') {
      // watchtower: concrete legs + platform reachable by stepped ramp
      const H = 7;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.bbox(B, 'concrete', sx * 1.6, H / 2, sz * 1.6, 0.4, H, 0.4);
      this.bbox(B, 'concrete', 0, H, 0, 4, 0.25, 4);
      this.wallX(B, 'concrete', -2, 2, 2, H + 0.12, 1.1, [], 0.15);
      this.wallX(B, 'concrete', -2, 2, -2, H + 0.12, 1.1, [], 0.15);
      this.wallZ(B, 'concrete', -2, 2, 2, H + 0.12, 1.1, [], 0.15);
      this.bbox(B, 'roof', 0, H + 2.6, 0, 4.6, 0.1, 4.6, false);
      const steps = 22;
      for (let s = 0; s < steps; s++) { const top = (s + 1) * H / steps; this.bbox(B, 'wood', -2.6, top - 0.1, 1.8 - s * 0.36 + 3.4 - 3.4, 0.9, 0.2, 0.36); }
      this.loot(B, 0, H + 0.13, 0, 3);
    }
  }

  // ---------- vegetation ----------
  buildTrees() {
    const rand = this.rand;
    const T = this.assets.tex;
    const barkMat = new THREE.MeshStandardMaterial({ map: T.bark.diff, normalMap: T.bark.nor, roughness: 0.95 });
    const needle = makeFoliageTexture();
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, map: needle.map, normalMap: needle.nor, alphaTest: 0.45, side: THREE.DoubleSide });
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: needle.leafMap, normalMap: needle.nor, alphaTest: 0.45, side: THREE.DoubleSide });
    windify(pineMat, this.uniforms); windify(leafMat, this.uniforms);
    const pine = makePine(rand), broad = makeBroadleaf(rand);
    const types = [
      { trunk: pine.trunk, crown: pine.crown, crownMat: pineMat, r: 0.3, h: 14 },
      { trunk: broad.trunk, crown: broad.crown, crownMat: leafMat, r: 0.35, h: 10 },
    ];
    const target = { low: 2200, medium: 4200, high: 6500, ultra: 9000 }[this.q] || 4200;
    const CH = 8, chunk = MAP_SIZE / CH;
    const lists = types.map(() => Array.from({ length: CH * CH }, () => []));
    let n = 0, tries = 0;
    const tmp = new THREE.Vector3();
    while (n < target && tries < target * 12) {
      tries++;
      const x = (rand() * 2 - 1) * HALF * 0.92, z = (rand() * 2 - 1) * HALF * 0.92;
      const h = this.getHeight(x, z);
      if (h < 2.5 || h > 92) continue;
      const fm = this.forestMask(x, z);
      if (rand() > fm * 0.95 + 0.035) continue;
      if (this.getNormal(x, z, tmp).y < 0.8) continue;
      if (this.roadDist(x, z).d < 7) continue;
      if (this.buildings.some(b => Math.abs(b.x - x) < b.w / 2 + 3 && Math.abs(b.z - z) < b.d / 2 + 3)) continue;
      if (this.towns.some(t => Math.hypot(t.x - x, t.z - z) < t.R * 0.85)) continue;
      const type = rand() < (h > 30 ? 0.85 : 0.55) ? 0 : 1;
      const s = 0.75 + rand() * 0.6;
      const ci = Math.min(CH - 1, Math.floor((x + HALF) / chunk)) + Math.min(CH - 1, Math.floor((z + HALF) / chunk)) * CH;
      lists[type][ci].push({ x, y: h - 0.2, z, s, r: rand() * Math.PI * 2 });
      this.addTree(x, z, types[type].r * s, types[type].h * s);
      n++;
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    types.forEach((tp, ti) => {
      for (const list of lists[ti]) {
        if (!list.length) continue;
        const trunk = new THREE.InstancedMesh(tp.trunk, barkMat, list.length);
        const crown = new THREE.InstancedMesh(tp.crown, tp.crownMat, list.length);
        list.forEach((it, i) => {
          q.setFromAxisAngle(up, it.r); sc.set(it.s, it.s * (0.9 + (i % 5) * 0.05), it.s); p.set(it.x, it.y, it.z);
          m.compose(p, q, sc); trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
        });
        for (const im of [trunk, crown]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.scene.add(im); }
      }
    });
  }

  buildGrass() {
    const S = N + 1;
    // height + mask textures for the GPU grass field
    const hdata = new Uint16Array(S * S), mdata = new Uint8Array(S * S * 4);
    for (let k = 0; k < S * S; k++) {
      hdata[k] = THREE.DataUtils.toHalfFloat(this.h[k]);
      const g = this.splat[k * 4], f = this.splat[k * 4 + 1], d = this.splat[k * 4 + 3];
      mdata[k * 4] = clamp((g * 1.1 + f * 0.45 - d * 1.2) * 255, 0, 255);
      mdata[k * 4 + 1] = clamp(f * 255, 0, 255);
      mdata[k * 4 + 3] = 255;
    }
    // carve grass out of building footprints
    for (const b of this.buildings) {
      for (let z = b.z - b.d / 2; z <= b.z + b.d / 2; z += CELL / 2) for (let x = b.x - b.w / 2; x <= b.x + b.w / 2; x += CELL / 2) {
        const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
        if (i >= 0 && j >= 0 && i < S && j < S) mdata[(j * S + i) * 4] = 0;
      }
    }
    const ht = new THREE.DataTexture(hdata, S, S, THREE.RedFormat, THREE.HalfFloatType);
    ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    const mt = new THREE.DataTexture(mdata, S, S, THREE.RGBAFormat);
    mt.magFilter = mt.minFilter = THREE.LinearFilter; mt.needsUpdate = true;

    const count = { low: 0, medium: 70000, high: 130000, ultra: 200000 }[this.q] ?? 70000;
    if (!count) return;
    const R = { medium: 32, high: 42, ultra: 52 }[this.q] || 36;
    const segs = 4; // vertices: 2 per row + tip
    const vpb = segs * 2 + 1;
    const pos = new Float32Array(count * vpb * 3), off = new Float32Array(count * vpb * 2), rnd = new Float32Array(count * vpb * 3);
    const idx = [];
    const rand = mulberry32(42);
    for (let b = 0; b < count; b++) {
      const ox = (rand() * 2 - 1) * R, oz = (rand() * 2 - 1) * R;
      const r1 = rand(), r2 = rand(), r3 = rand();
      for (let v = 0; v < vpb; v++) {
        const k = b * vpb + v;
        const row = Math.floor(v / 2), side = v % 2;
        const tip = v === vpb - 1;
        const y = tip ? 1 : row / segs;
        const w = tip ? 0 : (1 - y * 0.85) * (side ? 0.5 : -0.5);
        pos[k * 3] = w; pos[k * 3 + 1] = y; pos[k * 3 + 2] = 0;
        off[k * 2] = ox; off[k * 2 + 1] = oz;
        rnd[k * 3] = r1; rnd[k * 3 + 1] = r2; rnd[k * 3 + 2] = r3;
      }
      const base = b * vpb;
      for (let r = 0; r < segs - 1; r++) { const a = base + r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const a = base + (segs - 1) * 2; idx.push(a, a + 1, base + vpb - 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 3));
    geo.setIndex(count * vpb > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    this.grassUniforms = {
      uTime: this.uniforms.uTime, uPlayer: this.uniforms.uPlayer,
      uH: { value: ht }, uM: { value: mt }, uR: { value: R }, uSize: { value: MAP_SIZE },
      uSun: { value: new THREE.Vector3(0.5, 0.8, 0.3) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uAmb: { value: new THREE.Color(0.35, 0.42, 0.5) },
      fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.002 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.grassUniforms, side: THREE.DoubleSide,
      vertexShader: `
uniform float uTime, uR, uSize; uniform vec3 uPlayer; uniform sampler2D uH, uM;
attribute vec2 aOff; attribute vec3 aRnd;
varying float vY; varying vec3 vCol; varying float vFog; varying vec3 vN;
void main(){
  vec2 wp = aOff + 2.0*uR*floor((uPlayer.xz - aOff)/(2.0*uR) + 0.5);
  vec2 uv = (wp + uSize*0.5)/uSize;
  float h = texture2D(uH, uv).r;
  vec4 m = texture2D(uM, uv);
  float dist = length(wp - uPlayer.xz);
  float fade = 1.0 - smoothstep(uR*0.6, uR, dist);
  float dens = step(aRnd.z, m.r*1.15);
  float bh = (0.22 + aRnd.y*0.42 + m.g*0.2) * fade * dens;
  float ang = aRnd.x*6.2831;
  vec3 p = position;
  float bw = 0.07 + aRnd.z*0.05;
  vec3 local = vec3(cos(ang)*p.x*bw, p.y*bh, sin(ang)*p.x*bw);
  float wind = sin(uTime*1.6 + wp.x*0.17 + wp.y*0.11)*0.5 + sin(uTime*3.1 + wp.x*0.5)*0.15;
  vec2 bend = vec2(0.6,0.35)*(wind*0.28 + 0.12) + vec2(cos(ang*1.7), sin(ang*1.3))*0.12;
  // push away from player
  vec2 away = wp - uPlayer.xz; float ad = length(away);
  bend += (ad < 1.2 && ad > 0.001) ? normalize(away)*(1.2-ad)*0.9 : vec2(0.0);
  local.xz += bend * p.y*p.y * bh;
  vec3 world = vec3(wp.x, h, wp.y) + local;
  vY = p.y;
  vN = normalize(vec3(-sin(ang), 0.6, cos(ang)));
  vec3 baseC = mix(vec3(0.10,0.14,0.04), vec3(0.17,0.19,0.07), aRnd.y);
  vec3 tipC = mix(vec3(0.36,0.42,0.16), vec3(0.52,0.5,0.26), aRnd.x*aRnd.x);
  vCol = mix(baseC, tipC, p.y) * mix(1.0, 0.7, m.g);
  vec4 mv = viewMatrix * vec4(world,1.0);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `
uniform vec3 uSun, uSunCol, uAmb, fogColor; uniform float fogDensity;
varying float vY; varying vec3 vCol; varying float vFog; varying vec3 vN;
void main(){
  float diff = clamp(abs(dot(normalize(vN), normalize(uSun))), 0.0, 1.0);
  float ao = mix(0.35, 1.0, vY);
  vec3 c = vCol * (uAmb*1.1 + uSunCol*diff*0.95) * ao;
  float f = 1.0 - exp(-fogDensity*fogDensity*vFog*vFog);
  c = mix(c, fogColor, f);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    const grass = new THREE.Mesh(geo, mat);
    grass.frustumCulled = false;
    this.scene.add(grass);
    this.grass = grass;
  }

  // ---------- props from CC0 models ----------
  buildProps() {
    const M = this.assets.models;
    const rand = this.rand;
    const tmpBox = new THREE.Box3();
    const place = (name, x, z, { s = 1, rot = rand() * Math.PI * 2, collide = true, y, mat = 'wood', sink = 0, tilt = false } = {}) => {
      const src = M[name]; if (!src) return null;
      const o = src.clone();
      o.scale.setScalar(s);
      o.rotation.y = rot;
      const gy = y ?? this.getHeight(x, z);
      o.position.set(x, gy - sink, z);
      if (tilt) { const n = this.getNormal(x, z); o.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)); }
      o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.scene.add(o);
      if (collide) {
        o.updateMatrixWorld(true);
        tmpBox.setFromObject(o);
        const shrink = name.includes('boulder') || name.includes('rock') ? 0.78 : 0.95;
        const c = tmpBox.getCenter(new THREE.Vector3()), sz = tmpBox.getSize(new THREE.Vector3()).multiplyScalar(shrink / 2);
        if (sz.x > 0.15 && sz.y > 0.2) this.addBox(c.clone().sub(sz), c.clone().add(sz), mat);
      }
      return o;
    };
    // town clutter
    for (const t of this.towns) {
      const n = t.military ? 40 : 18;
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = rand() * t.R * 1.1;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (this.buildings.some(b => Math.abs(b.x - x) < b.w / 2 + 1.5 && Math.abs(b.z - z) < b.d / 2 + 1.5)) continue;
        if (this.roadDist(x, z).d < 4) continue;
        const pool = t.military ? ['old_military_crate', 'wooden_military_crate', 'metal_jerrycan_green', 'Barrel_01', 'old_tyre', 'ammo_box'] : ['wooden_crate_01', 'Barrel_01', 'old_tyre', 'metal_jerrycan_green', 'wooden_crate_01'];
        const name = pool[Math.floor(rand() * pool.length)];
        const big = name.includes('military_crate') ? 1.6 : name === 'wooden_crate_01' ? 1.3 : 1;
        place(name, x, z, { s: big, mat: name === 'Barrel_01' || name.includes('jerry') ? 'metal' : 'wood' });
        if (t.military && rand() < 0.3) this.lootSpots.push({ pos: new THREE.Vector3(x + 1.5, this.getHeight(x + 1.5, z), z), tier: 2 });
      }
      // cars along the roads through town
      for (let i = 0; i < 3; i++) {
        const a = rand() * Math.PI * 2, d = 10 + rand() * t.R;
        let x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        const rd = this.roadDist(x, z);
        if (rd.d > 20) continue;
        if (this.buildings.some(b => Math.hypot(b.x - x, b.z - z) < b.rad + 2)) continue;
        place('covered_car', x, z, { mat: 'metal', tilt: true });
      }
      // street lamps
      for (let i = 0; i < 5; i++) {
        const a = rand() * Math.PI * 2, d = 8 + rand() * t.R * 0.8;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (this.buildings.some(b => Math.hypot(b.x - x, b.z - z) < b.rad)) continue;
        place('street_lamp_01', x, z, { collide: false });
        this.addBox(new THREE.Vector3(x - 0.15, this.getHeight(x, z), z - 0.15), new THREE.Vector3(x + 0.15, this.getHeight(x, z) + 5, z + 0.15), 'metal');
      }
    }
    // nature props
    const nRocks = { low: 120, medium: 220, high: 320, ultra: 420 }[this.q] || 220;
    for (let i = 0; i < nRocks; i++) {
      const x = (rand() * 2 - 1) * 680, z = (rand() * 2 - 1) * 680;
      const h = this.getHeight(x, z);
      if (h < 0.5) continue;
      if (this.towns.some(t => Math.hypot(t.x - x, t.z - z) < t.R + 10)) continue;
      if (this.roadDist(x, z).d < 6) continue;
      const pick = rand();
      if (pick < 0.35) place(rand() < 0.5 ? 'boulder_01' : 'namaqualand_boulder_02', x, z, { s: 0.8 + rand() * 2.6, mat: 'stone', sink: 0.4 });
      else if (pick < 0.55) place('rock_moss_set_01', x, z, { s: 1 + rand() * 1.5, mat: 'stone', sink: 0.2 });
      else if (pick < 0.7) place('dead_tree_trunk', x, z, { s: 1 + rand() * 0.4, mat: 'wood', sink: 0.1, tilt: true });
      else if (pick < 0.82) place('tree_stump_01', x, z, { s: 1 + rand(), mat: 'wood' });
      else place('shrub_01', x, z, { s: 0.8 + rand() * 0.8, collide: false });
    }
    // forest floor ferns
    const nFerns = { low: 150, medium: 500, high: 900, ultra: 1400 }[this.q] || 500;
    let placed = 0, tries = 0;
    while (placed < nFerns && tries < nFerns * 10) {
      tries++;
      const x = (rand() * 2 - 1) * 680, z = (rand() * 2 - 1) * 680;
      if (this.forestMask(x, z) < 0.5 || this.getHeight(x, z) < 2) continue;
      place(rand() < 0.75 ? 'fern_02' : 'shrub_01', x, z, { s: 0.9 + rand() * 0.9, collide: false });
      placed++;
    }
  }

  // ---------- map image ----------
  buildMapImage() {
    const R = 1024;
    const c = document.createElement('canvas'); c.width = c.height = R;
    const g = c.getContext('2d');
    const img = g.createImageData(R, R);
    for (let py = 0; py < R; py++) for (let px = 0; px < R; px++) {
      const x = -HALF + (px + 0.5) / R * MAP_SIZE, z = -HALF + (py + 0.5) / R * MAP_SIZE;
      const h = this.getHeight(x, z);
      let col;
      if (h < 0) { const d = clamp(-h / 15, 0, 1); col = [lerp(70, 28, d), lerp(120, 64, d), lerp(132, 88, d)]; }
      else {
        const f = this.forestMask(x, z);
        const base = h < 2.2 ? [196, 182, 140] : h > 75 ? [150, 146, 136] : [lerp(132, 92, f), lerp(150, 118, f), lerp(92, 70, f)];
        const n = this.getNormal(x, z);
        const shade = clamp(0.65 + (n.x * -0.6 + n.z * -0.5 + n.y * 0.6) * 0.55, 0.45, 1.25);
        col = base.map(v => v * shade);
      }
      const k = (py * R + px) * 4;
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const s = R / MAP_SIZE, tx = (x) => (x + HALF) * s;
    g.strokeStyle = 'rgba(214,196,160,0.85)'; g.lineWidth = 3; g.lineCap = 'round';
    for (const r of this.roads) { g.beginPath(); g.moveTo(tx(r[0]), tx(r[1])); g.lineTo(tx(r[2]), tx(r[3])); g.stroke(); }
    g.fillStyle = 'rgba(40,38,36,0.85)';
    for (const b of this.buildings) g.fillRect(tx(b.x - b.w / 2), tx(b.z - b.d / 2), b.w * s, b.d * s);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    for (let i = 1; i < 8; i++) { const p = i * R / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, R); g.moveTo(0, p); g.lineTo(R, p); g.stroke(); }
    g.font = '600 17px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center';
    for (const t of this.towns) {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(t.name.toUpperCase(), tx(t.x) + 1, tx(t.z) - t.R * s - 5);
      g.fillStyle = '#f2ede0'; g.fillText(t.name.toUpperCase(), tx(t.x), tx(t.z) - t.R * s - 6);
    }
    this.mapCanvas = c;
  }

  update(dt, playerPos) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uPlayer.value.copy(playerPos);
    if (this.waterTex) { this.waterTex[0].offset.x += dt * 0.004; this.waterTex[0].offset.y += dt * 0.002; this.waterTex[1].offset.x -= dt * 0.003; }
  }
}

// ---------- helpers ----------
function boxUV(sx, sy, sz, tile = 2.5) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return g.toNonIndexed();
}
function toNonIndexedCompat(g) { return g.index ? g.toNonIndexed() : g; }

function rayBox(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity, nAxis = -1, nSign = 0;
  for (let a = 0; a < 3; a++) {
    const k = ['x', 'y', 'z'][a];
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return null; continue; }
    let t1 = (min[k] - o[k]) / d[k], t2 = (max[k] - o[k]) / d[k];
    let s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, n: new THREE.Vector3(-d.x, -d.y, -d.z) };
  const n = new THREE.Vector3(); n.setComponent(nAxis, nSign);
  return { t: tmin, n };
}
function rayCyl(o, d, cx, cz, r) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z; if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c; if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 ? t : null;
}

function windify(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 ip = vec3(0.0);
#endif
  float sway = sin(uTime*0.9 + ip.x*0.05 + ip.z*0.07)*0.5 + sin(uTime*2.3 + ip.x*0.3)*0.12;
  transformed.x += sway * 0.018 * transformed.y * transformed.y * 0.1;
  transformed.z += sway * 0.012 * transformed.y * transformed.y * 0.1;`);
  };
}

function makeFoliageTexture() {
  const size = 256;
  const mk = (leaf) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    const rand = mulberry32(leaf ? 5 : 3);
    for (let i = 0; i < (leaf ? 260 : 900); i++) {
      const x = rand() * size, y = rand() * size;
      const l = 40 + rand() * 60;
      const shade = 150 + rand() * 105;
      g.strokeStyle = `rgb(${shade},${shade},${shade})`;
      g.fillStyle = g.strokeStyle;
      if (leaf) {
        g.beginPath(); g.ellipse(x, y, 7 + rand() * 6, 3.5 + rand() * 3, rand() * Math.PI, 0, Math.PI * 2); g.fill();
      } else {
        const a = rand() * Math.PI * 2;
        g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l * 0.35, y + Math.sin(a) * l * 0.35); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  };
  const nc = document.createElement('canvas'); nc.width = nc.height = 64;
  const ng = nc.getContext('2d'); const nd = ng.createImageData(64, 64); const rr = mulberry32(8);
  for (let i = 0; i < 64 * 64; i++) { nd.data[i * 4] = 128 + (rr() - 0.5) * 90; nd.data[i * 4 + 1] = 128 + (rr() - 0.5) * 90; nd.data[i * 4 + 2] = 255; nd.data[i * 4 + 3] = 255; }
  ng.putImageData(nd, 0, 0);
  const nor = new THREE.CanvasTexture(nc); nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
  return { map: mk(false), leafMap: mk(true), nor };
}

function colorize(geo, fn) {
  const p = geo.attributes.position; const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const c = fn(p.getX(i), p.getY(i), p.getZ(i)); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function makePine(rand) {
  const trunk = new THREE.CylinderGeometry(0.09, 0.32, 13, 9, 4, true).translate(0, 6.5, 0);
  const tu = trunk.attributes.uv; for (let i = 0; i < tu.count; i++) tu.setXY(i, tu.getX(i) * 2, tu.getY(i) * 6);
  const parts = [];
  const layers = 9;
  for (let l = 0; l < layers; l++) {
    const t = l / (layers - 1);
    const rad = lerp(2.9, 0.6, t) * (0.9 + rand() * 0.2);
    const y = lerp(3.2, 12.2, t);
    const g = new THREE.ConeGeometry(rad, 2.6 - t * 0.6, 16, 3, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i), py = p.getY(i);
      const a = Math.atan2(pz, px);
      const jag = 1 + Math.sin(a * 7 + l) * 0.12 + (rand() - 0.5) * 0.18;
      const droop = py < 0 ? -0.35 * Math.hypot(px, pz) / rad : 0;
      p.setXYZ(i, px * jag, py + droop, pz * jag);
    }
    g.translate(0, y, 0);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 1.5);
    parts.push(g.toNonIndexed());
  }
  const crown = mergeGeometries(parts.map(g => { g.deleteAttribute('normal'); return g; }));
  crown.computeVertexNormals();
  // bias normals outward for softer canopy lighting
  const n = crown.attributes.normal, p = crown.attributes.position;
  for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3(p.getX(i), 0.35, p.getZ(i)).normalize(); n.setXYZ(i, (n.getX(i) + v.x) * 0.5, (n.getY(i) + v.y) * 0.5 + 0.2, (n.getZ(i) + v.z) * 0.5); }
  colorize(crown, (x, y, z) => { const k = 0.55 + y / 30 + Math.hypot(x, z) * 0.06; return [0.09 * k, 0.17 * k, 0.07 * k]; });
  return { trunk, crown };
}

function makeBroadleaf(rand) {
  const trunk = new THREE.CylinderGeometry(0.14, 0.38, 6.5, 9, 3, true).translate(0, 3.25, 0);
  const tu = trunk.attributes.uv; for (let i = 0; i < tu.count; i++) tu.setXY(i, tu.getX(i) * 2, tu.getY(i) * 3);
  const parts = [];
  for (let k = 0; k < 9; k++) {
    const g = new THREE.IcosahedronGeometry(1.4 + rand() * 1.1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const s = 1 + (rand() - 0.5) * 0.35; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.85, p.getZ(i) * s); }
    const a = rand() * Math.PI * 2, r = k === 0 ? 0 : 1.1 + rand() * 1.3;
    g.translate(Math.cos(a) * r, 6.2 + rand() * 2.8, Math.sin(a) * r);
    parts.push(g);
  }
  const crown = mergeGeometries(parts);
  crown.computeVertexNormals();
  const uv = crown.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
  colorize(crown, (x, y, z) => { const k = 0.6 + (y - 5) / 8; return [0.16 * k, 0.24 * k, 0.07 * k]; });
  return { trunk, crown };
}
