import * as THREE from 'three';
import { makeBox } from './physics.js';

export const HALF = 42; // arena half size

function canvasTex(size, draw, repeat = 1, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, s, n, a, light = 255) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 60 + (light - 30)) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: new THREE.Vector3(-0.5, 0.22, -0.8).normalize() } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 vP; uniform vec3 sun;
      void main(){
        vec3 d = normalize(vP);
        float h = d.y;
        vec3 top = vec3(0.03,0.05,0.20);
        vec3 mid = vec3(0.42,0.16,0.48);
        vec3 hor = vec3(1.25,0.55,0.38);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, top, smoothstep(0.12, 0.7, h));
        c = mix(vec3(0.12,0.07,0.16), c, smoothstep(-0.25, 0.0, h));
        float s = max(dot(d, normalize(sun)), 0.0);
        c += vec3(1.6,0.8,0.45) * pow(s, 8.0) * 0.55;
        c += vec3(5.0,3.2,2.0) * pow(s, 700.0);
        // stars
        vec3 q = floor(d*220.0);
        float r = fract(sin(dot(q, vec3(12.9898,78.233,37.719)))*43758.5453);
        c += step(0.9972, r) * smoothstep(0.25, 0.6, h) * 0.9;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function buildMap(scene, quality) {
  const boxes = [];
  const group = new THREE.Group(); scene.add(group);
  const T = 2048; void T;

  // ---------- Textures / materials ----------
  const concrete = canvasTex(512, (g, s) => {
    g.fillStyle = '#4a5160'; g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, 0.25, 130);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.strokeRect(5, 5, s - 10, s - 10);
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let i = 0; i < 4; i++) g.fillRect(0, (s / 4) * i + s / 8 - 1, s, 2);
  }, 1);
  const floorTex = canvasTex(1024, (g, s) => {
    g.fillStyle = '#2a2f3b'; g.fillRect(0, 0, s, s);
    speckle(g, s, 25000, 0.18, 110);
    const n = 4, t = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 36 + ((x * 7 + y * 13) % 5) * 3;
      g.fillStyle = `rgb(${v},${v + 4},${v + 14})`; g.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
    }
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 6;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke(); }
  }, HALF * 2 / 8);
  const floorEmit = canvasTex(1024, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#00cfff'; g.lineWidth = 5;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.strokeStyle = '#2a3f7a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, HALF * 2 / 8);
  const crateTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c47a2a'; g.fillRect(0, 0, s, s);
    speckle(g, s, 3000, 0.3, 150);
    g.strokeStyle = '#3b2108'; g.lineWidth = 14; g.strokeRect(7, 7, s - 14, s - 14);
    g.lineWidth = 10; g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.moveTo(s - 10, 10); g.lineTo(10, s - 10); g.stroke();
    g.fillStyle = '#ffd23f'; g.fillRect(s / 2 - 22, 18, 44, 10);
  }, 1);

  const M = {
    concrete: new THREE.MeshStandardMaterial({ map: concrete, bumpMap: concrete, bumpScale: 2.5, vertexColors: true, color: 0xffffff, roughness: 0.82, metalness: 0.08 }),
    dark: new THREE.MeshStandardMaterial({ map: concrete, bumpMap: concrete, bumpScale: 2.5, vertexColors: true, color: 0x7d8696, roughness: 0.6, metalness: 0.3 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 1.5, emissiveMap: floorEmit, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.25 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, bumpMap: crateTex, bumpScale: 2, vertexColors: true, roughness: 0.65, metalness: 0.15 }),
    cyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 1.7, 2.2) }),
    pink: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.9) }),
    gold: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.2) }),
  };

  // soft contact-shadow decal under every grounded block
  const csTex = canvasTex(64, (g, sz) => {
    const gr = g.createRadialGradient(sz / 2, sz / 2, sz * 0.18, sz / 2, sz / 2, sz / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.8)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.clearRect(0, 0, sz, sz); g.fillStyle = gr; g.fillRect(0, 0, sz, sz);
  }, 1, false);
  csTex.wrapS = csTex.wrapT = THREE.ClampToEdgeWrapping;
  const csGeo = new THREE.PlaneGeometry(1, 1);
  const csMat = new THREE.MeshBasicMaterial({ map: csTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  // Box with world-scale UVs
  function boxGeo(w, h, d, tile = 4) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const sc = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * sc[f][0] / tile, uv.getY(i) * sc[f][1] / tile);
    }
    // baked ambient occlusion: darker toward the ground / bottom edges
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + h / 2) / h; // 0 bottom .. 1 top
      const face = (i / 4) | 0;
      let v = face === 3 ? 0.35 : face === 2 ? 1 : 0.55 + 0.45 * Math.min(1, t * Math.max(1, 3 / h) * 0.9 + 0.1);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function solid(cx, cz, w, d, h, y0 = 0, mat = M.concrete, collide = true, tile = 4) {
    const m = new THREE.Mesh(boxGeo(w, h, d, tile), mat);
    m.position.set(cx, y0 + h / 2, cz);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    if (collide) boxes.push(makeBox(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2));
    if (y0 === 0 && collide && h > 0.5) {
      const cs = new THREE.Mesh(csGeo, csMat); cs.rotation.x = -Math.PI / 2;
      cs.scale.set(w + 1.8 + h * 0.15, d + 1.8 + h * 0.15, 1); cs.position.set(cx, 0.012, cz); cs.renderOrder = 1; group.add(cs);
    }
    return m;
  }
  function trim(cx, cz, w, d, y, mat) { // glowing strip (no collision)
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat);
    m.position.set(cx, y, cz); group.add(m);
  }
  function topTrim(cx, cz, w, d, h, y0, mat) {
    const y = y0 + h + 0.04;
    trim(cx, cz - d / 2 + 0.05, w, 0.1, y, mat); trim(cx, cz + d / 2 - 0.05, w, 0.1, y, mat);
    trim(cx - w / 2 + 0.05, cz, 0.1, d, y, mat); trim(cx + w / 2 - 0.05, cz, 0.1, d, y, mat);
  }
  function wall(cx, cz, w, d, h, accent) {
    solid(cx, cz, w, d, h, 0, M.concrete);
    topTrim(cx, cz, w, d, h, 0, accent);
    // low glowing base strip
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.07, d + 0.02), accent);
    m.position.set(cx, 0.45, cz); group.add(m);
  }
  function crate(cx, cz, s = 2, y0 = 0) { solid(cx, cz, s, s, s, y0, M.crate, true, s); }
  function platform(cx, cz, w, d, h, stairSide, accent) {
    solid(cx, cz, w, d, h, 0, M.dark);
    topTrim(cx, cz, w, d, h, 0, accent);
    const steps = Math.round(h / 0.4) - 1, tread = 0.9, sw = 4;
    for (let k = 1; k <= steps; k++) {
      const sh = h - 0.4 * k;
      if (stairSide === '+z') solid(cx, cz + d / 2 + tread * (k - 0.5), sw, tread, sh, 0, M.dark);
      if (stairSide === '-z') solid(cx, cz - d / 2 - tread * (k - 0.5), sw, tread, sh, 0, M.dark);
      if (stairSide === '+x') solid(cx + w / 2 + tread * (k - 0.5), cz, tread, sw, sh, 0, M.dark);
      if (stairSide === '-x') solid(cx - w / 2 - tread * (k - 0.5), cz, tread, sw, sh, 0, M.dark);
    }
  }

  // ---------- Ground ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);

  // ---------- Outer walls ----------
  const wt = 3, wh = 9;
  wall(0, -HALF - wt / 2, HALF * 2 + wt * 2, wt, wh, M.cyan);
  wall(0, HALF + wt / 2, HALF * 2 + wt * 2, wt, wh, M.cyan);
  wall(-HALF - wt / 2, 0, wt, HALF * 2, wh, M.pink);
  wall(HALF + wt / 2, 0, wt, HALF * 2, wh, M.pink);

  // ---------- Center tower ----------
  platform(0, 0, 12, 12, 2.4, '+z', M.cyan);
  // second stairs on the other side (-z)
  {
    const steps = 5, tread = 0.9;
    for (let k = 1; k <= steps; k++) solid(0, -6 - tread * (k - 0.5), 4, tread, 2.4 - 0.4 * k, 0, M.dark);
  }
  crate(-4.5, -4.5, 1.5, 2.4); crate(4.5, 4.5, 1.5, 2.4);
  solid(0, 0, 1.2, 1.2, 3.4, 2.4, M.dark); topTrim(0, 0, 1.2, 1.2, 3.4, 2.4, M.gold);
  solid(-5.5, 3, 0.6, 5, 1.2, 2.4, M.concrete); solid(5.5, -3, 0.6, 5, 1.2, 2.4, M.concrete);

  // ---------- Pinwheel walls ----------
  wall(-17, -8, 1, 16, 3.2, M.cyan);
  wall(17, 8, 1, 16, 3.2, M.cyan);
  wall(8, -17, 16, 1, 3.2, M.pink);
  wall(-8, 17, 16, 1, 3.2, M.pink);

  // ---------- Corner bases ----------
  platform(-31, 31, 9, 9, 2.0, '+x', M.pink);
  platform(31, -31, 9, 9, 2.0, '-x', M.cyan);
  crate(-31, 31, 1.5, 2.0); crate(31, -31, 1.5, 2.0);
  // L covers
  wall(30, 30, 12, 1, 3.2, M.gold); wall(35.5, 33.5, 1, 7, 3.2, M.gold);
  wall(-30, -30, 12, 1, 3.2, M.gold); wall(-35.5, -33.5, 1, 7, 3.2, M.gold);
  crate(29, 34, 2); crate(-29, -34, 2);

  // ---------- Scattered cover ----------
  const cr = [[-10, -11], [10, 11], [-25, 2], [25, -2], [1, -30], [-1, 30], [-12, 26], [12, -26], [-34, -10],
    [34, 10], [20, -14], [-20, 14], [-6, 20], [6, -20], [24, 20], [-24, -20]];
  cr.forEach(([x, z], i) => { crate(x, z, 2); if (i % 3 === 0) crate(x + 0.2, z - 0.1, 1.4, 2); if (i % 4 === 1) crate(x + 2, z + 0.5, 1.6); });
  // low walls (jump-over cover)
  const lw = [[-3, -22, 6, 0.8], [3, 22, 6, 0.8], [-22, -4, 0.8, 6], [22, 4, 0.8, 6], [13, 0, 0.8, 5], [-13, 0, 0.8, 5],
    [-28, 14, 5, 0.8], [28, -14, 5, 0.8]];
  lw.forEach(([x, z, w, d], i) => { solid(x, z, w, d, 1.2, 0, M.dark); topTrim(x, z, w, d, 1.2, 0, i % 2 ? M.pink : M.cyan); });
  // pillars
  [[-8, 8], [8, -8], [-38, 0], [38, 0], [0, -38], [0, 38]].forEach(([x, z]) => {
    solid(x, z, 1.6, 1.6, 6, 0, M.dark); topTrim(x, z, 1.6, 1.6, 6, 0, M.cyan);
  });

  // ---------- Skyline ----------
  const winTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#0a0d1a'; g.fillRect(0, 0, s, s);
    for (let y = 4; y < s; y += 8) for (let x = 4; x < s; x += 8) {
      if (Math.random() < 0.45) { const c = Math.random() < 0.5 ? '#ffd9a0' : (Math.random() < 0.5 ? '#6fe9ff' : '#ff6fb0'); g.fillStyle = c; g.fillRect(x, y, 5, 6); }
    }
  }, 1);
  const bMat = new THREE.MeshBasicMaterial({ map: winTex, color: new THREE.Color(1.6, 1.6, 1.6), fog: true });
  const n = quality === 'low' ? 30 : 70;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
    const r = 85 + Math.random() * 70;
    const w = 8 + Math.random() * 14, h = 25 + Math.random() * 75, d = 8 + Math.random() * 14;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 26, uv.getY(k) * h / 26);
    const m = new THREE.Mesh(g, bMat); m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); group.add(m);
    if (Math.random() < 0.4) { const t = new THREE.Mesh(new THREE.BoxGeometry(w + .2, .6, d + .2), Math.random() < 0.5 ? M.pink : M.cyan); t.position.set(m.position.x, h - 1.7, m.position.z); group.add(t); }
  }


  // ---------- Neon signs ----------
  function sign(text, sub, x, y, z, ry, w, color) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    g.font = 'italic 900 150px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 40; g.fillStyle = color;
    g.fillText(text, 512, 112); g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = 0.9; g.fillText(text, 512, 112);
    g.globalAlpha = 1; g.font = '700 46px "Segoe UI", Arial, sans-serif'; g.fillStyle = color; g.fillText(sub, 512, 220);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(1.5, 1.5, 1.5), depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry; group.add(m);
  }
  sign('HYPER ARENA', 'SEASON 01 · LIVE', 0, 6.4, -HALF + 0.02, 0, 16, '#00e5ff');
  sign('HYPER ARENA', 'SEASON 01 · LIVE', 0, 6.4, HALF - 0.02, Math.PI, 16, '#ff2d9a');
  sign('SECTOR A', 'NEON DISTRICT', -HALF + 0.02, 6.2, 0, Math.PI / 2, 12, '#ffd23f');
  sign('SECTOR B', 'NEON DISTRICT', HALF - 0.02, 6.2, 0, -Math.PI / 2, 12, '#7cf6ff');

  // ---------- Hologram + light beams ----------
  const rings = [];
  [[2.6, 0.07, M.cyan, 7.2], [2.0, 0.06, M.pink, 7.2], [1.4, 0.05, M.gold, 7.2]].forEach(([r, t, mat, y], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 64), mat); m.position.set(0, y, 0); m.userData.spin = (i + 1) * 0.6 * (i % 2 ? -1 : 1); group.add(m); rings.push(m);
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 3), wireframe: true }));
  core.position.set(0, 7.2, 0); group.add(core);
  function beam(x, z, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 60, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, 30, z); group.add(m);
  }
  beam(0, 0, new THREE.Color(0.1, 1.4, 2)); beam(-31, 31, new THREE.Color(2, 0.2, 1)); beam(31, -31, new THREE.Color(0.1, 1.4, 2));
  beam(-31, -31, new THREE.Color(1.8, 1.3, 0.2)); beam(31, 31, new THREE.Color(1.8, 1.3, 0.2));

  // coloured accent lights (no shadows)
  [[0x00e5ff, 0, 5, 0], [0xff2d9a, -31, 4, 31], [0x00e5ff, 31, 4, -31], [0xffc23a, 30, 4, 30], [0xffc23a, -30, 4, -30]].forEach(([c, x, y, z]) => {
    const l = new THREE.PointLight(c, 35, 30, 2); l.position.set(x, y, z); group.add(l);
  });

  // ---------- floating dust ----------
  const dN = 500, dPos = new Float32Array(dN * 3);
  for (let i = 0; i < dN; i++) { dPos[i * 3] = (Math.random() - 0.5) * HALF * 2; dPos[i * 3 + 1] = Math.random() * 12 + 0.3; dPos[i * 3 + 2] = (Math.random() - 0.5) * HALF * 2; }
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 0.07, color: new THREE.Color(1.6, 1.2, 1.6), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  dust.frustumCulled = false; group.add(dust);
  function animate(t) {
    rings.forEach(r => { r.rotation.x = t * r.userData.spin; r.rotation.y = t * r.userData.spin * 0.7; });
    core.rotation.y = t * 1.2; core.rotation.x = t * 0.7; core.position.y = 7.2 + Math.sin(t * 1.5) * 0.25;
    const a = dGeo.attributes.position.array;
    for (let i = 0; i < dN; i++) { a[i * 3 + 1] += Math.sin(t * 0.5 + i) * 0.002 + 0.0015; if (a[i * 3 + 1] > 12.5) a[i * 3 + 1] = 0.3; a[i * 3] += Math.sin(t * 0.3 + i * 1.7) * 0.003; }
    dGeo.attributes.position.needsUpdate = true;
  }

  // ---------- Spawns ----------
  const cand = [];
  for (const x of [-37, -20, 0, 20, 37]) for (const z of [-37, -20, 0, 20, 37]) cand.push([x, z]);
  cand.push([-6, -14], [6, 14], [-14, 6], [14, -6], [-24, 24], [24, -24], [-36, 18], [36, -18]);
  const spawns = cand.filter(([x, z]) => !boxes.some(b => x + 1 > b.minX && x - 1 < b.maxX && z + 1 > b.minZ && z - 1 < b.maxZ && b.minY < 1.8));

  const nav = buildNav(boxes);
  return { boxes, spawns, nav, group, animate };
}

// ---------- Navigation grid (height map + A*) ----------
function buildNav(boxes) {
  const N = HALF * 2, H = new Float32Array(N * N);
  for (const b of boxes) {
    if (b.maxY > 8) continue; // outer walls: out of grid anyway
    const i0 = Math.max(0, Math.floor(b.minX + HALF)), i1 = Math.min(N - 1, Math.ceil(b.maxX + HALF) - 1);
    const j0 = Math.max(0, Math.floor(b.minZ + HALF)), j1 = Math.min(N - 1, Math.ceil(b.maxZ + HALF) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (b.maxY > H[j * N + i]) H[j * N + i] = b.maxY;
    }
  }
  const near = new Float32Array(N * N); // proximity-to-wall penalty
  const walkable = (a, b) => Math.abs(H[a] - H[b]) <= 0.5;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let p = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= N || y >= N || !walkable(j * N + i, y * N + x)) { p += 1; }
    }
    near[j * N + i] = p;
  }
  const open = new Uint8Array(N * N); // heap scratch
  void open;

  function cellOf(x, z) { return [Math.max(0, Math.min(N - 1, Math.floor(x + HALF))), Math.max(0, Math.min(N - 1, Math.floor(z + HALF)))]; }
  function center(i, j) { return [i - HALF + 0.5, j - HALF + 0.5, H[j * N + i]]; }

  // blocked if ground-bots cannot stand there (tall obstacle relative to neighbours is handled by edges)
  function findPath(sx, sz, tx, tz) {
    const [si, sj] = cellOf(sx, sz), [ti, tj] = cellOf(tx, tz);
    const start = sj * N + si, goal = tj * N + ti;
    if (start === goal) return [];
    const g = new Float32Array(N * N).fill(1e9), came = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = []; // [f, idx]
    const push = (f, idx) => { heap.push([f, idx]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { let l = c * 2 + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    g[start] = 0; push(0, start);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
    let iter = 0;
    while (heap.length && iter++ < 9000) {
      const [, cur] = pop();
      if (closed[cur]) continue; closed[cur] = 1;
      if (cur === goal) break;
      const ci = cur % N, cj = (cur / N) | 0;
      for (const [di, dj, cost] of dirs) {
        const x = ci + di, y = cj + dj;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const ni = y * N + x;
        if (closed[ni] || !walkable(cur, ni)) continue;
        if (di !== 0 && dj !== 0) { // no corner cutting
          if (!walkable(cur, cj * N + x) || !walkable(cur, y * N + ci)) continue;
          if (near[cur] > 0 && near[ni] > 0 && (near[cj * N + x] > 2 || near[y * N + ci] > 2)) continue;
        }
        if (near[ni] >= 3 && ni !== goal && near[ni] > 5) continue; // too cramped
        const ng = g[cur] + cost + near[ni] * 0.6;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; const hx = Math.abs(x - ti), hy = Math.abs(y - tj); push(ng + (hx + hy) * 0.95, ni); }
      }
    }
    if (!closed[goal]) return null;
    const path = []; let c = goal;
    while (c !== start && c !== -1) { path.push(center(c % N, (c / N) | 0)); c = came[c]; }
    return path.reverse();
  }

  function randomCell(minDistFrom, minDist) {
    for (let t = 0; t < 40; t++) {
      const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
      if (near[j * N + i] > 2) continue;
      const [x, z] = center(i, j);
      if (minDistFrom && Math.hypot(x - minDistFrom[0], z - minDistFrom[1]) < minDist) continue;
      return [x, z];
    }
    return [0, 20];
  }
  return { findPath, randomCell };
}
