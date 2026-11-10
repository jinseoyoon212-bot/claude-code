// Tiny AABB physics: axis-separated body movement, auto step-up (stairs), raycasts.
export const G = 26;
export const STEP = 0.62;

export function makeBox(minX, minY, minZ, maxX, maxY, maxZ) {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function overlap(b, bx) {
  return b.x + b.r > bx.minX && b.x - b.r < bx.maxX &&
    b.z + b.r > bx.minZ && b.z - b.r < bx.maxZ &&
    b.y < bx.maxY - 1e-3 && b.y + b.h > bx.minY + 1e-3;
}

// body: {x,y,z (feet), vx,vy,vz, r, h, onGround}
export function moveBody(b, dt, boxes) {
  b.vy -= G * dt;
  if (b.vy < -55) b.vy = -55;
  b.landed = 0;

  b.x += b.vx * dt;
  for (let i = 0; i < boxes.length; i++) {
    const bx = boxes[i];
    if (!overlap(b, bx)) continue;
    if (b.onGround && bx.maxY - b.y <= STEP) { b.y = bx.maxY; continue; }
    if (b.vx > 0) b.x = bx.minX - b.r;
    else if (b.vx < 0) b.x = bx.maxX + b.r;
    else b.x += (b.x < (bx.minX + bx.maxX) / 2 ? -1 : 1) * 0.01;
    b.vx = 0;
  }
  b.z += b.vz * dt;
  for (let i = 0; i < boxes.length; i++) {
    const bx = boxes[i];
    if (!overlap(b, bx)) continue;
    if (b.onGround && bx.maxY - b.y <= STEP) { b.y = bx.maxY; continue; }
    if (b.vz > 0) b.z = bx.minZ - b.r;
    else if (b.vz < 0) b.z = bx.maxZ + b.r;
    else b.z += (b.z < (bx.minZ + bx.maxZ) / 2 ? -1 : 1) * 0.01;
    b.vz = 0;
  }

  const prevY = b.y, vyBefore = b.vy, wasGround = b.onGround;
  b.y += b.vy * dt;
  b.onGround = false;
  if (b.y <= 0) { b.y = 0; b.vy = 0; b.onGround = true; }
  for (let i = 0; i < boxes.length; i++) {
    const bx = boxes[i];
    if (!overlap(b, bx)) continue;
    if (b.vy > 0) { b.y = bx.minY - b.h; b.vy = 0; }
    else { b.y = bx.maxY; b.vy = 0; b.onGround = true; }
  }
  if (b.onGround && !wasGround && vyBefore < -7) b.landed = -vyBefore;
  void prevY;
}

const _n = { x: 0, y: 0, z: 0 };
// Slab test. Returns t or -1. Writes normal into out (optional).
export function rayBox(ox, oy, oz, dx, dy, dz, bx, tmax, out) {
  let tmin = 0, t2 = tmax, nx = 0, ny = 0, nz = 0;
  // x
  if (Math.abs(dx) < 1e-9) { if (ox < bx.minX || ox > bx.maxX) return -1; }
  else {
    let a = (bx.minX - ox) / dx, b = (bx.maxX - ox) / dx, s = -1;
    if (a > b) { const t = a; a = b; b = t; s = 1; }
    if (a > tmin) { tmin = a; nx = s; ny = 0; nz = 0; }
    if (b < t2) t2 = b;
    if (tmin > t2) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < bx.minY || oy > bx.maxY) return -1; }
  else {
    let a = (bx.minY - oy) / dy, b = (bx.maxY - oy) / dy, s = -1;
    if (a > b) { const t = a; a = b; b = t; s = 1; }
    if (a > tmin) { tmin = a; nx = 0; ny = s; nz = 0; }
    if (b < t2) t2 = b;
    if (tmin > t2) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < bx.minZ || oz > bx.maxZ) return -1; }
  else {
    let a = (bx.minZ - oz) / dz, b = (bx.maxZ - oz) / dz, s = -1;
    if (a > b) { const t = a; a = b; b = t; s = 1; }
    if (a > tmin) { tmin = a; nx = 0; ny = 0; nz = s; }
    if (b < t2) t2 = b;
    if (tmin > t2) return -1;
  }
  if (out) { out.x = nx; out.y = ny; out.z = nz; }
  return tmin;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, tmax) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const t = tca - Math.sqrt(r * r - d2);
  return t >= 0 && t <= tmax ? t : -1;
}

// nearest world hit; returns t (or -1) and normal in `normal`
export function rayWorld(boxes, ox, oy, oz, dx, dy, dz, tmax, normal) {
  let best = tmax, hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[i], best, _n);
    if (t >= 0 && t < best) {
      best = t; hit = true;
      if (normal) { normal.x = _n.x; normal.y = _n.y; normal.z = _n.z; }
    }
  }
  return hit ? best : -1;
}

export function lineOfSight(boxes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  return rayWorld(boxes, ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, null) < 0;
}
