// Amusement-park rollercoaster: a closed rail loop with carts that run
// on gravity — they crawl up the lift hill and rocket down the far
// side. E boards a slow cart, E/Space bails out. Pure logic.
import { CONFIG } from './config.js';
import { v3, copy, distXZ, clamp } from './vec3.js';

// Sample the waypoint loop into an arc-length table: pts[i] = {x,y,z,s}
// plus the total loop length. Both the rails (map.js) and the carts
// ride this same curve, so visuals and motion can't disagree.
export function buildTrack() {
  const wp = CONFIG.coaster.track;
  const pts = [];
  let s = 0, px = wp[wp.length - 1].x, pz = wp[wp.length - 1].z, ph = wp[wp.length - 1].h;
  for (const w of wp) {
    const len = Math.hypot(w.x - px, w.z - pz);
    const steps = Math.max(1, Math.round(len / 1.2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      s += len / steps;
      pts.push({
        x: px + (w.x - px) * t,
        y: ph + (w.h - ph) * t,
        z: pz + (w.z - pz) * t,
        s,
      });
    }
    px = w.x; pz = w.z; ph = w.h;
  }
  return { pts, length: s };
}

export function makeCoaster(state) {
  const tr = buildTrack();
  const n = CONFIG.coaster.carts;
  const carts = [];
  for (let i = 0; i < n; i++) {
    carts.push({
      id: 'cart' + i,
      idx: i,
      s: (tr.length * i) / n,   // spread around the loop
      v: CONFIG.coaster.minSpeed,
      pos: v3(tr.pts[0].x, tr.pts[0].y, tr.pts[0].z),
      yaw: 0,
      rider: null,
    });
  }
  state.coaster = { track: tr, carts };
}

// Position + heading on the track at arc length s (wraps around).
function trackAt(tr, s) {
  const pts = tr.pts;
  const n = pts.length;
  s = ((s % tr.length) + tr.length) % tr.length;
  // find the segment — arc values are uniform-ish, walk from a guess
  let i = Math.floor((s / tr.length) * n);
  i = Math.min(i, n - 2);
  while (i < n - 1 && pts[i + 1].s < s) i++;
  while (i > 0 && pts[i].s > s) i--;
  const a = pts[i], b = pts[Math.min(i + 1, n - 1)];
  const seg = Math.max(1e-6, b.s - a.s);
  const t = clamp((s - a.s) / seg, 0, 1);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
    slope: (b.y - a.y) / seg,    // dy per metre — drives the gravity run
  };
}

export function stepCoaster(state, dt) {
  const cfg = CONFIG.coaster;
  const tr = state.coaster.track;
  for (const c of state.coaster.carts) {
    // gravity along the slope + a chain-lift minimum speed
    const here = trackAt(tr, c.s);
    c.v += -here.slope * cfg.gravity * dt;
    c.v = clamp(c.v, cfg.minSpeed, cfg.maxSpeed);
    // station brakes: carts crawl through the platform so you can hop on
    const dStat = Math.min(c.s, tr.length - c.s);
    if (dStat < cfg.stationLen && c.v > cfg.stationSpeed) {
      c.v = Math.max(cfg.stationSpeed, c.v - 30 * dt);
    }
    c.s += c.v * dt;
    const p = trackAt(tr, c.s);
    c.pos.x = p.x; c.pos.y = p.y; c.pos.z = p.z;
    c.yaw = p.yaw;
    if (c.rider) {
      const e = c.rider;
      if (!e.alive) { c.rider = null; e.cart = null; continue; }
      e.pos.x = c.pos.x; e.pos.y = c.pos.y + 0.4; e.pos.z = c.pos.z;
      e.vel = v3();
      e.onGround = true;
    }
  }
}

export function nearestCart(state, ent, range) {
  let best = null, bd = range;
  for (const c of state.coaster.carts) {
    if (c.rider) continue;
    const d = distXZ(ent.pos, c.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function tryBoardCart(state, ent) {
  if (ent.car || ent.cart || ent.chute || ent.binned || ent.zombie || ent.binFlyT > 0) return null;
  const c = nearestCart(state, ent, CONFIG.coaster.boardRange);
  if (!c || Math.abs(c.v) > 8) return null;
  c.rider = ent;
  ent.cart = c;
  ent.vel = v3();
  state.events.push({ type: 'boardCart', ent: ent.id, name: ent.name, byPlayer: ent === state.player });
  return c;
}

export function exitCart(state, ent) {
  const c = ent.cart;
  if (!c) return;
  c.rider = null;
  ent.cart = null;
  // step off where the cart left you — keep a bit of its momentum
  ent.vel = v3(Math.sin(c.yaw) * c.v * 0.4, 1, Math.cos(c.yaw) * c.v * 0.4);
  state.events.push({ type: 'exitCart', ent: ent.id, byPlayer: ent === state.player });
}
