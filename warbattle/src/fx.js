// Volumetric-looking smoke and fire sprites, ejected shell casings and smoke-grenade clouds.
import * as THREE from 'three';
import { createNoise2D, mulberry32 } from './noise.js';

// A soft, lumpy puff with baked top-lighting, packed into a 2x2 atlas of four shapes.
function puffAtlas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S * 2;
  const g = c.getContext('2d'); const img = g.createImageData(S * 2, S * 2);
  for (let t = 0; t < 4; t++) {
    const n = createNoise2D(17 + t * 31), ox = (t % 2) * S, oy = Math.floor(t / 2) * S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * 2 - 1, v = y / S * 2 - 1;
      const r = Math.hypot(u, v);
      let f = 0, a = 1, fr = 2.2;
      for (let o = 0; o < 5; o++) { f += a * n(u * fr + t * 7, v * fr - t * 3); a *= 0.5; fr *= 2.03; }
      const shape = 1 - r + f * 0.42;
      const alpha = Math.max(0, Math.min(1, (shape - 0.12) * 2.4));
      // light from above-left: brighter where the lumps face the sun
      const lit = 0.62 + 0.38 * Math.max(-1, Math.min(1, -v * 0.7 - u * 0.25 + f * 0.9));
      const k = ((oy + y) * S * 2 + ox + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * Math.min(1, lit));
      img.data[k + 3] = Math.round(255 * alpha);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Camera-facing textured quads (instanced) with per-particle rotation, size and colour over life.
// Quads have no size limit, unlike GL points, so large smoke clouds work on every GPU.
class PuffSystem {
  constructor(scene, tex, additive, cap = 1500) {
    this.cap = cap; this.list = [];
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const f = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    this.attr = { iPos: f(3), iCol: f(4), iSize: f(1), iRot: f(1), iTile: f(1) };
    for (const [k, v] of Object.entries(this.attr)) geo.setAttribute(k, v);
    geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: tex }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.001 }, uSun: { value: new THREE.Color(1, 0.95, 0.85) } },
      vertexShader: `attribute vec3 iPos; attribute vec4 iCol; attribute float iSize, iRot, iTile;
        varying vec4 vCol; varying vec2 vUv; varying float vFog;
        void main(){
          vCol = iCol;
          vec2 tileOff = vec2(mod(iTile, 2.0), floor(iTile / 2.0));
          vUv = (uv + tileOff) * 0.5;
          float c = cos(iRot), s = sin(iRot);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          mv.xy += q;
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 fogColor, uSun; uniform float fogDensity;
        varying vec4 vCol; varying vec2 vUv; varying float vFog;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          vec3 col = vCol.rgb * mix(vec3(1.0), t.rgb * uSun * 1.25, ${additive ? '0.25' : '0.85'});
          float f = 1.0 - exp(-fogDensity*fogDensity*vFog*vFog);
          ${additive ? 'col *= 1.0 - f;' : 'col = mix(col, fogColor, f);'}
          float a = vCol.a * t.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 7 : 6;
    scene.add(this.mesh);
  }
  // o: {p, v, size, grow, life, c0:[r,g,b,a], c1:[r,g,b,a], rise, drag, spin}
  add(o) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ p: o.p.clone(), v: (o.v || new THREE.Vector3()).clone(), size: o.size, grow: o.grow || 0, life: o.life, max: o.life, c0: o.c0, c1: o.c1 || o.c0, rise: o.rise || 0, drag: o.drag ?? 1, rot: Math.random() * 6.28, spin: o.spin ?? (Math.random() - 0.5) * 0.6, tile: Math.floor(Math.random() * 4), fadeIn: o.fadeIn ?? 0.08 });
  }
  update(dt, camera) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const q = L[i]; q.life -= dt;
      if (q.life <= 0) { L.splice(i, 1); continue; }
      q.v.y += q.rise * dt; q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.p.addScaledVector(q.v, dt); q.size += q.grow * dt * (q.life / q.max + 0.3); q.rot += q.spin * dt;
    }
    // draw far-to-near so overlapping smoke blends correctly
    const cp = camera.position;
    L.sort((a, b) => b.p.distanceToSquared(cp) - a.p.distanceToSquared(cp));
    const A = this.attr, P = A.iPos.array, C = A.iCol.array, S = A.iSize.array, R = A.iRot.array, T = A.iTile.array;
    for (let i = 0; i < L.length; i++) {
      const q = L[i], k = 1 - q.life / q.max;
      const fade = Math.min(1, k / q.fadeIn) * Math.min(1, (q.life / q.max) * 3);
      P[i * 3] = q.p.x; P[i * 3 + 1] = q.p.y; P[i * 3 + 2] = q.p.z;
      for (let j = 0; j < 3; j++) C[i * 4 + j] = q.c0[j] + (q.c1[j] - q.c0[j]) * k;
      C[i * 4 + 3] = (q.c0[3] + (q.c1[3] - q.c0[3]) * k) * fade;
      S[i] = q.size; R[i] = q.rot; T[i] = q.tile;
    }
    this.mesh.geometry.instanceCount = L.length;
    for (const v of Object.values(A)) v.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    const tex = puffAtlas();
    this.smoke = new PuffSystem(scene, tex, false, 2200);
    this.fire = new PuffSystem(scene, tex, true, 600);
    this.clouds = [];   // active smoke-grenade volumes {p, r, t}
    // brass casings
    const cg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 8).rotateZ(Math.PI / 2);
    const cm = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 });
    this.casings = new THREE.InstancedMesh(cg, cm, 160);
    this.casings.count = 0; this.casings.frustumCulled = false; this.casings.castShadow = true;
    scene.add(this.casings);
    this.cs = [];
    this.rand = mulberry32(99);
  }

  setFog(color, density) {
    for (const s of [this.smoke, this.fire]) { s.mat.uniforms.fogColor.value.copy(color); s.mat.uniforms.fogDensity.value = density; }
  }

  casing(pos, right, up) {
    const r = Math.random;
    const v = right.clone().multiplyScalar(2.2 + r() * 1.2).addScaledVector(up, 1.6 + r() * 1.2);
    v.x += (r() - 0.5) * 0.6; v.z += (r() - 0.5) * 0.6;
    if (this.cs.length >= 160) this.cs.shift();
    this.cs.push({ p: pos.clone(), v, rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), spin: new THREE.Vector3(r() * 30 - 15, r() * 30 - 15, r() * 30 - 15), life: 8, rest: false });
  }

  muzzleSmoke(p, dir) {
    for (let i = 0; i < 2; i++) this.smoke.add({ p: p.clone().addScaledVector(dir, 0.1 + i * 0.15), v: dir.clone().multiplyScalar(1.2 + Math.random()), size: 0.18, grow: 0.9, life: 0.9 + Math.random() * 0.6, c0: [0.85, 0.84, 0.8, 0.22], c1: [0.8, 0.8, 0.78, 0], rise: 0.4, drag: 2.5 });
  }

  dust(p, n, mat) {
    const col = mat === 'wood' ? [0.48, 0.38, 0.27] : mat === 'metal' ? [0.55, 0.55, 0.55] : mat === 'ground' ? [0.52, 0.45, 0.33] : [0.66, 0.63, 0.58];
    for (let i = 0; i < 3; i++) {
      const v = n.clone().multiplyScalar(0.8 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6, (Math.random() - 0.5)));
      this.smoke.add({ p: p.clone().addScaledVector(n, 0.05), v, size: 0.25 + Math.random() * 0.2, grow: 1.4, life: 1.2 + Math.random(), c0: [...col, 0.75], c1: [...col, 0], rise: 0.15, drag: 2.2 });
    }
  }

  explosion(p) {
    const r = Math.random;
    // fireball: bright core rolling outward and upward, cooling to red
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Vector3(r() - 0.5, r() * 0.9 + 0.1, r() - 0.5).normalize();
      this.fire.add({ p: p.clone().addScaledVector(d, r() * 0.8), v: d.multiplyScalar(5 + r() * 7), size: 2.2 + r() * 1.8, grow: 3.5, life: 0.55 + r() * 0.5, c0: [1.6, 1.05, 0.45, 1], c1: [0.9, 0.22, 0.05, 0], rise: 3, drag: 3.2, fadeIn: 0.02 });
    }
    // black smoke column
    for (let i = 0; i < 34; i++) {
      const d = new THREE.Vector3(r() - 0.5, 0.4 + r(), r() - 0.5).normalize();
      this.smoke.add({ p: p.clone().add(new THREE.Vector3(0, 0.5 + r() * 1.5, 0)), v: d.multiplyScalar(2 + r() * 5), size: 2.5 + r() * 2, grow: 2.6, life: 5 + r() * 4, c0: [0.16, 0.14, 0.13, 0.95], c1: [0.32, 0.3, 0.28, 0], rise: 1.6 + r(), drag: 0.9, fadeIn: 0.05 });
    }
    // ground dust ring
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      this.smoke.add({ p: p.clone().add(new THREE.Vector3(0, 0.3, 0)), v: new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(7 + r() * 4), size: 1.4, grow: 2.2, life: 2.5 + r() * 1.5, c0: [0.55, 0.47, 0.36, 0.7], c1: [0.6, 0.55, 0.47, 0], rise: 0.3, drag: 1.8 });
    }
  }

  smokeGrenade(p) { this.clouds.push({ p: p.clone(), r: 0, t: 0, emit: 0 }); }

  // true when the segment a->b passes through an active smoke cloud
  blocksView(a, b) {
    for (const c of this.clouds) {
      if (c.r < 1.5) continue;
      const ab = new THREE.Vector3().subVectors(b, a); const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(c.p, a).dot(ab) / ab.lengthSq()));
      if (a.clone().addScaledVector(ab, t).distanceTo(c.p) < c.r * 0.85) return true;
    }
    return false;
  }

  update(dt, camera, renderer) {
    const W = this.world;
    // smoke grenades: grow to a ~7 m cloud for 22 s
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i]; c.t += dt; c.emit -= dt;
      c.r = Math.min(7, c.t * 2.2) * (c.t > 22 ? Math.max(0, 1 - (c.t - 22) / 6) : 1);
      while (c.t < 22 && c.emit <= 0) {
        c.emit += 0.07;
        const a = Math.random() * 6.28, d = Math.random() * c.r * 0.7;
        this.smoke.add({ p: c.p.clone().add(new THREE.Vector3(Math.cos(a) * d, 0.4 + Math.random() * 1.2, Math.sin(a) * d)), v: new THREE.Vector3(Math.cos(a) * 1.4, 0.6 + Math.random() * 0.6, Math.sin(a) * 1.4), size: 3 + Math.random() * 2, grow: 0.9, life: 9 + Math.random() * 4, c0: [0.93, 0.93, 0.92, 0.85], c1: [0.9, 0.9, 0.9, 0], rise: 0.12, drag: 0.6, fadeIn: 0.15 });
      }
      if (c.t > 28) this.clouds.splice(i, 1);
    }
    // casings
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    for (let i = this.cs.length - 1; i >= 0; i--) {
      const c = this.cs[i]; c.life -= dt;
      if (c.life <= 0) { this.cs.splice(i, 1); continue; }
      if (!c.rest) {
        c.v.y -= 9.81 * dt; c.p.addScaledVector(c.v, dt);
        c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
        const g = W.groundAt(c.p.x, c.p.z, c.p.y + 0.3, 0.6, 0) + 0.006;
        if (c.p.y < g) {
          c.p.y = g;
          if (Math.abs(c.v.y) < 1) { c.rest = true; c.rot.x = Math.PI / 2 * 0; c.rot.z = 0; }
          else { c.v.y *= -0.35; c.v.x *= 0.5; c.v.z *= 0.5; c.spin.multiplyScalar(0.5); }
        }
      }
    }
    this.cs.forEach((c, i) => { q.setFromEuler(c.rot); m.compose(c.p, q, one); this.casings.setMatrixAt(i, m); });
    this.casings.count = this.cs.length; this.casings.instanceMatrix.needsUpdate = true;
    this.smoke.update(dt, camera); this.fire.update(dt, camera);
  }
}
