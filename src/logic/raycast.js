// Swept segment tests — the "hitscan per step" used for all hit detection.
// In Roblox these map to workspace:Spherecast / workspace:Raycast over the
// same prevPos -> newPos segment each Heartbeat.
import { dot, sub, add, scale, copy } from './vec3.js';

// Segment vs sphere. Returns {t, point}, t in [0,1] along p0->p1, or null.
export function segmentSphere(p0, p1, center, r) {
  const d = sub(p1, p0);
  const f = sub(p0, center);
  if (dot(f, f) <= r * r) return { t: 0, point: copy(p0) };
  const a = dot(d, d);
  if (a < 1e-12) return null;
  const b = 2 * dot(f, d);
  const c = dot(f, f) - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0 || t > 1) return null;
  return { t, point: add(p0, scale(d, t)) };
}

// Segment vs the horizontal plane y = planeY. Returns {t, point} or null.
export function segmentGround(p0, p1, planeY = 0) {
  const dy = p1.y - p0.y;
  if (Math.abs(dy) < 1e-12 || p0.y < planeY) return null;
  const t = (planeY - p0.y) / dy;
  if (t < 0 || t > 1) return null;
  return { t, point: add(p0, scale(sub(p1, p0), t)) };
}

// Segment vs axis-aligned box {min,max}. Slab method. Returns {t, point} or null.
export function segmentAABB(p0, p1, min, max) {
  const d = sub(p1, p0);
  let tmin = 0;
  let tmax = 1;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-9) {
      if (p0[ax] < min[ax] || p0[ax] > max[ax]) return null;
    } else {
      let t1 = (min[ax] - p0[ax]) / d[ax];
      let t2 = (max[ax] - p0[ax]) / d[ax];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return { t: tmin, point: add(p0, scale(d, tmin)) };
}
