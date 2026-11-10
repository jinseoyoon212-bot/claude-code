import * as THREE from 'three';

// ---------- GPU point-sprite particles, CPU simulated ----------
export class Particles {
  constructor(scene, max, blending) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.aSize = new Float32Array(max); this.aColor = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending, fog: false,
      uniforms: { uScale: { value: 800 } },
      vertexShader: `attribute float aSize; attribute vec4 aColor; varying vec4 vC; uniform float uScale;
        void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(aSize*uScale/max(-mv.z,0.1),256.); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.05,d); gl_FragColor=vec4(vC.rgb, vC.a*a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let k = 0; k < max; k++) this.life[k] = 0;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav = 0, drag = 0) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = this.maxLife[k] = life; this.s0[k] = s0; this.s1[k] = s1;
    for (let q = 0; q < 4; q++) { this.c0[k * 4 + q] = c0[q]; this.c1[k * 4 + q] = c1[q]; }
    this.grav[k] = grav; this.drag[k] = drag;
  }
  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.aSize[k] = 0; this.aColor[k * 4 + 3] = 0; continue; }
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.aSize[k] = 0; this.aColor[k * 4 + 3] = 0; continue; }
      const t = 1 - this.life[k] / this.maxLife[k];
      const dr = Math.max(0, 1 - this.drag[k] * dt);
      this.vel[k * 3] *= dr; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * dr - this.grav[k] * dt; this.vel[k * 3 + 2] *= dr;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.02 && this.grav[k] > 0) { this.pos[k * 3 + 1] = 0.02; this.vel[k * 3 + 1] *= -0.3; this.vel[k * 3] *= 0.6; this.vel[k * 3 + 2] *= 0.6; }
      this.aSize[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * t;
      for (let q = 0; q < 4; q++) this.aColor[k * 4 + q] = this.c0[k * 4 + q] + (this.c1[k * 4 + q] - this.c0[k * 4 + q]) * t;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aColor.needsUpdate = true;
  }
}

// ---------- Tracers ----------
export class Tracers {
  constructor(scene, n = 48) {
    this.items = [];
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0, -0.5);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.items.push({ m, active: false, a: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, head: 0, len: 5, w: 0.02 });
    }
    this.k = 0;
  }
  spawn(from, to, color, width = 0.02, len = 6) {
    const t = this.items[this.k]; this.k = (this.k + 1) % this.items.length;
    t.a.copy(from); t.dir.subVectors(to, from); t.dist = t.dir.length(); if (t.dist < 0.1) return;
    t.dir.divideScalar(t.dist); t.head = 0; t.len = len; t.w = width; t.active = true;
    t.m.material.color.copy(color); t.m.visible = true;
  }
  update(dt) {
    for (const t of this.items) {
      if (!t.active) continue;
      t.head += 320 * dt;
      const tail = Math.max(0, t.head - t.len), head = Math.min(t.head, t.dist);
      if (tail >= t.dist) { t.active = false; t.m.visible = false; continue; }
      const l = Math.max(0.01, head - tail);
      t.m.position.copy(t.a).addScaledVector(t.dir, head);
      t.m.scale.set(t.w, t.w, l);
      t.m.lookAt(t.m.position.x - t.dir.x, t.m.position.y - t.dir.y, t.m.position.z - t.dir.z);
    }
  }
}

// ---------- Bullet-hole decals ----------
export class Decals {
  constructor(scene, n = 90) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(0.45, 'rgba(10,10,12,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.items = []; this.k = 0;
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, mat); m.visible = false; scene.add(m); this.items.push(m); }
  }
  add(p, n, size = 0.22) {
    const m = this.items[this.k]; this.k = (this.k + 1) % this.items.length;
    m.position.set(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01);
    m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    m.rotateZ(Math.random() * 6.28); m.scale.setScalar(size * (0.8 + Math.random() * 0.5)); m.visible = true;
  }
}

// ---------- Ejected shell casings ----------
export class Casings {
  constructor(scene, n = 28) {
    const geo = new THREE.CylinderGeometry(0.008, 0.008, 0.035, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.3 });
    this.items = []; this.k = 0;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat); m.visible = false; scene.add(m);
      this.items.push({ m, v: new THREE.Vector3(), life: 0, spin: new THREE.Vector3() });
    }
  }
  eject(pos, right, up, shell = false) {
    const c = this.items[this.k]; this.k = (this.k + 1) % this.items.length;
    c.m.position.copy(pos);
    c.v.copy(right).multiplyScalar(2 + Math.random() * 1.5).addScaledVector(up, 2 + Math.random() * 1.2);
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    c.life = 1.6; c.m.visible = true; c.m.scale.set(shell ? 1.8 : 1, shell ? 1.8 : 1, shell ? 1.8 : 1);
  }
  update(dt) {
    for (const c of this.items) {
      if (c.life <= 0) continue; c.life -= dt;
      c.v.y -= 16 * dt; c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.z += c.spin.z * dt;
      if (c.m.position.y < 0.02) { c.m.position.y = 0.02; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.spin.multiplyScalar(0.5); }
      if (c.life <= 0) c.m.visible = false;
    }
  }
}

// ---------- Critically-damped-ish spring ----------
export class Spring {
  constructor(k = 120, c = 14) { this.k = k; this.c = c; this.x = 0; this.v = 0; this.t = 0; }
  kick(v) { this.v += v; }
  update(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-this.k * (this.x - this.t) - this.c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}
