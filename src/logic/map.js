// Two-sector map: a street-gridded CITY sector in the west and a FARM
// sector in the east, joined by highways running through both. The
// infection hatch sits on the city plaza. Buildings register their
// interiors as lootSpots so crates can hide indoors. Everything is
// 1 m voxel cubes — each box emits an AABB collision part plus one
// cube per unit cell.
import { CONFIG } from './config.js';
import { v3 } from './vec3.js';
import { rand } from './rng.js';
import { buildTrack } from './coaster.js';

export function buildMap(state) {
  const obstacles = [];
  const voxels = [];
  const lootSpots = [];

  // Gentle relief: a field of smooth bumps (hills AND hollows, ±2 m)
  // covering the wild north/south grasslands. Sectors, roads and all
  // structures sit in the flat band — nothing built is disturbed.
  const bumps = [];
  for (let i = 0; i < 64; i++) {
    bumps.push({
      x: (rand(state) * 2 - 1) * 178,
      z: (rand(state) * 2 - 1) * 178,
      a: (rand(state) * 2 - 1) * 1.9,    // amplitude, mixed signs
      s: 6 + rand(state) * 9,            // sigma — broad gentle lumps
    });
  }
  const rawH = (x, z) => {
    let h = 0;
    for (const b of bumps) {
      const dx = x - b.x, dz = z - b.z;
      h += b.a * Math.exp(-(dx * dx + dz * dz) / (2 * b.s * b.s));
    }
    return h;
  };
  const parkC = CONFIG.world.sectors.find((s) => s.kind === 'park');
  const heightAt = (x, z) => {
    const az = Math.abs(z);
    let m = Math.min(1, Math.max(0, (az - 95) / 20));       // flat sector band
    if (parkC) {
      const pd = Math.hypot(x - parkC.x, z - parkC.z);
      m *= Math.min(1, Math.max(0, (pd - 52) / 15));        // flat park
    }
    const edge = Math.min(1, Math.max(0, (186 - Math.max(Math.abs(x), az)) / 8));
    return rawH(x, z) * m * edge;                            // ~±2 m in the wilds
  };

  const box = (x0, y0, z0, x1, y1, z1, mat) => {
    obstacles.push({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), mat });
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++)
          voxels.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, mat });
  };
  // decorative cubes — no collision (blades, signs, unreachable bits)
  const deco = (x0, y0, z0, x1, y1, z1, mat) => {
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++)
          voxels.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, mat });
  };

  // flat pavement tile — visuals only, no collision
  const pave = (x, z, mat) =>
    voxels.push({ x: x + 0.5, y: 0.07, z: z + 0.5, mat, sy: 0.14 });
  const paveRect = (x0, z0, x1, z1, mat) => {
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++) pave(x, z, mat);
  };

  // ---- piece parts --------------------------------------------------

  // A wall run along x (or z via the twin): solid cells with door and
  // window gaps. gaps = [{at, w, kind:'door'|'win'}]; door leaves the
  // whole column open, win leaves a 1 m climbable hole on a sill.
  const wallX = (x0, z, x1, h, mat, gaps = []) => {
    let cur = x0;
    const solid = (a, b) => { if (b > a) box(a, 0, z, b, h, z + 1, mat); };
    for (const g of gaps.slice().sort((a, b) => a.at - b.at)) {
      solid(cur, g.at);
      if (g.kind === 'win') {
        box(g.at, 0, z, g.at + g.w, 1, z + 1, mat);
        box(g.at, 2, z, g.at + g.w, h, z + 1, mat);
      }
      cur = g.at + g.w;
    }
    solid(cur, x1);
  };
  const wallZ = (x, z0, z1, h, mat, gaps = []) => {
    let cur = z0;
    const solid = (a, b) => { if (b > a) box(x, 0, a, x + 1, h, b, mat); };
    for (const g of gaps.slice().sort((a, b) => a.at - b.at)) {
      solid(cur, g.at);
      if (g.kind === 'win') {
        box(x, 0, g.at, x + 1, 1, g.at + g.w, mat);
        box(x, 2, g.at, x + 1, h, g.at + g.w, mat);
      }
      cur = g.at + g.w;
    }
    solid(cur, z1);
  };

  // Flight of 1 m-riser steps flush against the west wall, climbing
  // northward until the top step sits level with the roof slab top —
  // walk straight from the top step onto the roof.
  const stairs = (x0, z0, d, top) => {
    for (let i = 0; i < top; i++)
      box(x0 - 1, 0, z0 + d - 1 - i, x0, i + 1, z0 + d - i, 'stone');
  };

  // House: doors on BOTH long walls (you can always get in), climbable
  // windows on the sides, optional flat roof — roofed houses get a
  // stair flight to the top. Interior registers a loot spot.
  const house = (x0, z0, w, d, h, mat, roofed, withStairs) => {
    const dx = Math.floor(w / 2);
    wallX(x0, z0, x0 + w, h, mat, [{ at: x0 + dx, w: 2, kind: 'door' }]);      // north door
    wallX(x0, z0 + d - 1, x0 + w, h, mat, [{ at: x0 + dx, w: 2, kind: 'door' }]); // south door
    wallZ(x0, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + d - 4, w: 2, kind: 'win' }]);
    if (roofed) {
      box(x0, h, z0, x0 + w, h + 1, z0 + d, 'stone');
      if (withStairs) stairs(x0, z0, d, h + 1);
      // furniture — bed along the west wall, a wardrobe in the far
      // corner, a low table. Kept off the door lane and the loot spot.
      if (w >= 7 && d >= 7) {
        box(x0 + 1, 0, z0 + d - 3, x0 + 2, 1, z0 + d - 1, 'sand');      // bed
        box(x0 + 1, 1, z0 + d - 2, x0 + 2, 2, z0 + d - 1, 'log');       // headboard
        box(x0 + w - 2, 0, z0 + 1, x0 + w - 1, 3, z0 + 2, 'log');       // wardrobe
        box(x0 + w - 4, 0, z0 + d - 2, x0 + w - 2, 1, z0 + d - 1, 'log'); // table
      }
    }
    paveRect(x0 + 1, z0 + 1, x0 + w - 1, z0 + d - 1, 'path');
    lootSpots.push({ x: x0 + Math.floor(w / 2) + 0.5, z: z0 + Math.floor(d / 2) + 0.5 });
  };

  // Ruined house: chopped walls, no roof.
  const ruin = (x0, z0, w, d, mat) => {
    const dx = Math.floor(w / 2);
    wallX(x0, z0, x0 + w, 2, mat, [{ at: x0 + dx, w: 2, kind: 'door' }]);
    wallX(x0, z0 + d - 1, x0 + w, 3, mat, [{ at: x0 + dx, w: 2, kind: 'door' }]);
    wallZ(x0, z0 + 1, z0 + d - 1, 2, mat);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, 3, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    box(x0 + 1, 0, z0 + 1, x0 + 3, 1, z0 + 2, 'dirt');
    lootSpots.push({ x: x0 + Math.floor(w / 2) + 0.5, z: z0 + Math.floor(d / 2) + 0.5 });
  };

  // Apartments: a 6 m block — two storeys of windows, flat roof with a
  // parapet, and a stair flight up the west wall through a gap in the
  // parapet. A sniper perch over the district.
  const apartments = (x0, z0, w, d, mat) => {
    const h = 6;
    const dx = Math.floor(w / 2);
    wallX(x0, z0, x0 + w, h, mat, [{ at: x0 + 3, w: 2, kind: 'win' }]);
    wallX(x0, z0 + d - 1, x0 + w, h, mat,
      [{ at: x0 + dx, w: 2, kind: 'door' }, { at: x0 + w - 4, w: 2, kind: 'win' }]);
    wallZ(x0, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    box(x0, 3, z0, x0 + w, 4, z0 + d, 'stone');            // floor slab
    box(x0, h, z0, x0 + w, h + 1, z0 + d, 'stone');        // roof slab — top at h+1
    stairs(x0, z0, d, h + 1);                              // top step lands at z0+d-h-2
    // parapet with a gap over the stair landing
    const landZ0 = z0 + d - h - 2, landZ1 = landZ0 + 3;
    box(x0, h + 1, z0, x0 + w, h + 2, z0 + 1, mat);
    box(x0, h + 1, z0 + d - 1, x0 + w, h + 2, z0 + d, mat);
    box(x0 + w - 1, h + 1, z0, x0 + w, h + 2, z0 + d, mat);
    box(x0, h + 1, z0, x0 + 1, h + 2, landZ0, mat);
    box(x0, h + 1, landZ1, x0 + 1, h + 2, z0 + d, mat);
    paveRect(x0 + 1, z0 + 1, x0 + w - 1, z0 + d - 1, 'path');
    lootSpots.push({ x: x0 + Math.floor(w / 2) + 0.5, z: z0 + Math.floor(d / 2) + 0.5 });
  };

  // Warehouse: big open-front shed — the loot barn.
  const warehouse = (x0, z0, w, d, mat) => {
    const h = 4;
    wallX(x0, z0, x0 + w, h, mat);
    wallX(x0, z0 + d - 1, x0 + 3, h, mat);
    wallX(x0 + w - 3, z0 + d - 1, x0 + w, h, mat);          // 6 m opening
    wallZ(x0, z0 + 1, z0 + d - 1, h, mat);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, h, mat);
    box(x0, h, z0, x0 + w, h + 1, z0 + d, 'log');
    paveRect(x0 + 1, z0 + 1, x0 + w - 1, z0 + d - 1, 'dirt');
    box(x0 + 2, 0, z0 + 2, x0 + 3, 2, z0 + d - 3, 'log');   // shelf rows
    box(x0 + w - 3, 0, z0 + 2, x0 + w - 2, 2, z0 + d - 3, 'log');
    lootSpots.push({ x: x0 + Math.floor(w / 2) + 0.5, z: z0 + Math.floor(d / 2) + 0.5 });
  };

  // Market stall: posts + canopy roof + counter.
  const stall = (x0, z0, mat) => {
    for (const [px, pz] of [[0, 0], [3, 0], [0, 3], [3, 3]])
      box(x0 + px, 0, z0 + pz, x0 + px + 1, 3, z0 + pz + 1, 'log');
    box(x0 - 1, 3, z0 - 1, x0 + 4, 4, z0 + 4, mat);
    box(x0, 0, z0 + 1, x0 + 3, 1, z0 + 2, 'stone');
  };

  const tree = (bx, bz) => {
    const h = 3 + Math.floor(rand(state) * 2);
    // trunk reaches below ground so hills/hollows can't expose the base
    box(bx + 1, -3, bz + 1, bx + 2, h, bz + 2, 'log');
    box(bx, h - 1, bz, bx + 3, h + 1, bz + 3, 'leaf');
    box(bx + 1, h + 1, bz + 1, bx + 2, h + 2, bz + 2, 'leaf');
  };
  const hedge = (x0, z0, x1, z1) => box(x0, 0, z0, x1, 2, z1, 'leaf');
  const bench = (x, z) => box(x, 0, z, x + 2, 1, z + 1, 'log');
  const lamp = (x, z) => {
    box(x, 0, z, x + 1, 4, z + 1, 'log');
    box(x, 4, z, x + 1, 5, z + 1, 'stone');
  };
  // Field: ploughed dirt with crop rows — low cover you fight over.
  const field = (x0, z0, x1, z1) => {
    paveRect(x0, z0, x1, z1, 'dirt');
    for (let z = z0 + 2; z < z1 - 1; z += 3)
      box(x0 + 1, 0, z, x1 - 1, 1, z + 1, 'leaf');
  };
  // Hay bale.
  const hay = (x, z) => box(x, 0, z, x + 2, 2, z + 2, 'sand');
  // Silo: stone tube + cap.
  const silo = (x, z) => {
    box(x, 0, z, x + 3, 9, z + 3, 'stone');
    box(x + 1, 9, z + 1, x + 2, 11, z + 2, 'brick');
  };
  // Fence: log rail ring with a gate gap on the south side.
  const fence = (x0, z0, x1, z1) => {
    const gx = Math.floor((x0 + x1) / 2);
    box(x0, 0, z0, x1, 1, z0 + 1, 'log');
    box(x0, 0, z1 - 1, gx - 1, 1, z1, 'log');
    box(gx + 1, 0, z1 - 1, x1, 1, z1, 'log');
    box(x0, 0, z0, x0 + 1, 1, z1, 'log');
    box(x1 - 1, 0, z0, x1, 1, z1, 'log');
  };
  // Windmill: stone tower, cap, and a static + of blades on the face.
  const windmill = (x0, z0) => {
    box(x0, 0, z0, x0 + 4, 8, z0 + 4, 'stone');
    box(x0 - 1, 8, z0 - 1, x0 + 5, 10, z0 + 5, 'log');
    deco(x0 + 1, 7, z0 + 4, x0 + 3, 14, z0 + 5, 'log');   // blade |
    deco(x0 - 2, 10, z0 + 4, x0 + 6, 12, z0 + 5, 'log');  // blade —
  };

  // ---- highways -----------------------------------------------------
  // East-west artery through both sector centres + a north-south
  // connector in the gap — roads run THROUGH the sectors.
  paveRect(-188, -3, 188, 3, 'path');                     // EW highway
  paveRect(3, -186, 8, 186, 'path');                      // NS connector
  // Monument to the Great Toaster on the crossroads island.
  box(4, 0, 4, 7, 1, 7, 'stone');
  box(5, 1, 5, 6, 4, 6, 'bin');
  deco(4, 4, 4, 7, 5, 7, 'bin');                          // toaster top rim

  // ---- city sector --------------------------------------------------
  const city = (cx, cz) => {
    const streetC = [-58, -29, 0, 29, 58];
    for (const c of streetC) {
      paveRect(cx + c - 2, cz - 90, cx + c + 3, cz + 90, 'path');  // N-S
      paveRect(cx - 90, cz + c - 2, cx + 90, cz + c + 3, 'path');  // E-W
    }
    // plaza: pavement circle, kerb ring, lamps, benches, planters
    const PR = 13;
    for (let x = -PR; x <= PR; x++)
      for (let z = -PR; z <= PR; z++)
        if (Math.hypot(x + 0.5, z + 0.5) <= PR) pave(cx + x, cz + z, 'stone');
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const kz = cz + Math.round(Math.sin(t) * (PR + 0.5));
      if (Math.abs(kz - cz) < 4) continue;   // kerb gap where the highway crosses
      voxels.push({
        x: cx + Math.round(Math.cos(t) * (PR + 0.5)) + 0.5,
        y: 0.5,
        z: kz + 0.5,
        mat: 'brick',
      });
    }
    for (const [lx, lz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) lamp(cx + lx, cz + lz);
    for (const [bx, bz] of [[-11, -5], [9, -5], [-1, -11], [-1, 9]]) bench(cx + bx, cz + bz);
    for (const [px, pz] of [[-11, -11], [10, -11], [-11, 10], [10, 10]]) {
      box(cx + px, 0, cz + pz, cx + px + 2, 1, cz + pz + 2, 'stone');
      box(cx + px, 1, cz + pz, cx + px + 2, 3, cz + pz + 2, 'leaf');
    }
    // blocks between the streets
    const edges = [-92, -60, -31, -3, 3, 31, 60, 92];
    for (let i = 0; i < edges.length - 1; i++) {
      for (let j = 0; j < edges.length - 1; j++) {
        const x0 = cx + edges[i], x1 = cx + edges[i + 1];
        const z0 = cz + edges[j], z1 = cz + edges[j + 1];
        const cw = x1 - x0, cd = z1 - z0;
        if (cw < 10 || cd < 10) continue;
        if (x1 > cx - 14 && x0 < cx + 14 && z1 > cz - 14 && z0 < cz + 14) continue; // plaza
        const r = rand(state);
        if (r < 0.3) {
          const w = Math.min(10, cw - 8), d = Math.min(8, Math.floor(cd / 2) - 3);
          house(x0 + 3, z0 + 2, w, d, 3, 'brick', true, rand(state) < 0.7);
          house(x0 + cw - 3 - w, z0 + cd - 2 - d, w, d, 3, 'brick', rand(state) < 0.5, rand(state) < 0.5);
        } else if (r < 0.55) {
          const w = Math.min(12, cw - 8), d = Math.min(10, cd - 8);
          apartments(x0 + Math.floor((cw - w) / 2), z0 + Math.floor((cd - d) / 2), w, d, 'brick');
        } else if (r < 0.7) {
          const w = Math.min(14, cw - 8), d = Math.min(10, cd - 8);
          warehouse(x0 + Math.floor((cw - w) / 2), z0 + Math.floor((cd - d) / 2), w, d, 'stone');
        } else if (r < 0.85) {
          stall(x0 + 3, z0 + 3, 'brick');
          stall(x0 + 8, z0 + 3, 'sand');
          stall(x0 + 3, z0 + 8, 'leaf');
          ruin(x0 + cw - 10, z0 + cd - 9, 8, 7, 'brick');
        } else {
          hedge(x0 + 2, z0 + 2, x0 + 2 + Math.min(cw - 4, 10), z0 + 3);
          hedge(x0 + 2, z0 + 2, x0 + 3, z0 + 2 + Math.min(cd - 4, 8));
          tree(x0 + cw - 8, z0 + 4);
          tree(x0 + cw - 13, z0 + cd - 8);
          bench(x0 + 5, z0 + Math.floor(cd / 2));
          paveRect(x0 + 4, z0 + Math.floor(cd / 2) - 1, x0 + cw - 4, z0 + Math.floor(cd / 2) + 1, 'path');
        }
      }
    }
  };

  // ---- farm sector --------------------------------------------------
  const farm = (cx, cz) => {
    // dirt tracks: the EW highway is the spine; two lanes feed parcels
    paveRect(cx - 70, cz - 62, cx - 64, cz + 70, 'dirt');
    paveRect(cx + 40, cz - 62, cx + 46, cz + 70, 'dirt');
    paveRect(cx - 70, cz + 52, cx + 46, cz + 58, 'dirt');
    // wheat fields north of the highway
    field(cx - 62, cz - 68, cx - 20, cz - 22);
    field(cx - 12, cz - 68, cx + 32, cz - 22);
    field(cx + 48, cz - 68, cx + 80, cz - 22);
    windmill(cx + 36, cz - 74);
    silo(cx + 74, cz - 16);
    silo(cx + 79, cz - 16);
    // farmhouse + fenced yard south of the highway
    house(cx - 46, cz + 14, 10, 8, 3, 'brick', true, true);
    fence(cx - 50, cz + 10, cx - 30, cz + 30);
    hay(cx - 48, cz + 25);
    // the big barn
    const bx = cx + 18, bz = cz + 16;
    wallX(bx, bz, bx + 16, 5, 'log');
    wallX(bx, bz + 11, bx + 4, 5, 'log');
    wallX(bx + 12, bz + 11, bx + 16, 5, 'log');             // 8 m opening
    wallZ(bx, bz + 1, bz + 11, 5, 'log');
    wallZ(bx + 15, bz + 1, bz + 11, 5, 'log');
    box(bx, 5, bz, bx + 16, 6, bz + 12, 'brick');           // roof
    paveRect(bx + 1, bz + 1, bx + 15, bz + 11, 'dirt');
    hay(bx + 2, bz + 2); hay(bx + 2, bz + 6); hay(bx + 12, bz + 4);
    lootSpots.push({ x: bx + 8.5, z: bz + 6.5 });
    lootSpots.push({ x: bx + 4.5, z: bz + 9.5 });
    // animal pen + orchard east
    fence(cx + 46, cz + 40, cx + 72, cz + 58);
    hay(cx + 50, cz + 44); hay(cx + 60, cz + 50);
    box(cx + 56, 0, cz + 44, cx + 59, 1, cz + 45, 'log');   // trough
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++)
        tree(cx - 62 + i * 6, cz + 40 + j * 6);
    // scarecrow
    const scx = cx - 40, scz = cz - 40;
    box(scx, 0, scz, scx + 1, 3, scz + 1, 'log');
    deco(scx - 1, 2, scz, scx + 2, 3, scz + 1, 'log');
    deco(scx, 3, scz, scx + 1, 4, scz + 1, 'leaf');
  };

  // ---- amusement park sector ---------------------------------------
  // Fenced grounds around the rollercoaster: main walk, food stalls,
  // a carousel, a ferris wheel — and the big rail loop dominating it.
  const carousel = (cx, cz) => {
    box(cx, 0, cz, cx + 1, 5, cz + 1, 'log');                       // pole
    box(cx - 2, 4, cz - 2, cx + 3, 5, cz + 3, 'brick');             // canopy
    deco(cx - 1, 5, cz - 1, cx + 2, 7, cz + 2, 'sand');             // peak
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2;
      box(cx + Math.round(Math.cos(t) * 2), 1, cz + Math.round(Math.sin(t) * 2),
          cx + Math.round(Math.cos(t) * 2) + 1, 2, cz + Math.round(Math.sin(t) * 2) + 1, 'log');
    }
    paveRect(cx - 3, cz - 3, cx + 4, cz + 4, 'path');
  };
  const ferris = (cx, cz) => {
    box(cx - 2, 0, cz, cx - 1, 10, cz + 1, 'log');                  // A-legs
    box(cx + 1, 0, cz, cx + 2, 10, cz + 1, 'log');
    deco(cx - 1, 9, cz, cx + 1, 11, cz + 1, 'bin');                 // hub
    for (let i = 0; i < 20; i++) {                                  // the wheel rim
      const t = (i / 20) * Math.PI * 2;
      deco(cx + Math.round(Math.cos(t) * 8), 10 + Math.round(Math.sin(t) * 8),
           cz, cx + Math.round(Math.cos(t) * 8) + 1,
           10 + Math.round(Math.sin(t) * 8) + 1, cz + 1, 'log');
    }
    for (let i = 0; i < 8; i++) {                                   // gondola cabins
      const t = (i / 8) * Math.PI * 2 + 0.4;
      const gx = cx + Math.round(Math.cos(t) * 8);
      const gy = 10 + Math.round(Math.sin(t) * 8);
      deco(gx, gy - 2, cz - 1, gx + 1, gy - 1, cz + 2, i % 2 ? 'sand' : 'leaf');
    }
  };
  const park = (cx, cz) => {
    // perimeter: fence ring, road gates where the NS connector crosses
    const x0 = cx - 42, x1 = cx + 40, z0 = cz - 42, z1 = cz + 40;
    box(x0, 0, z0, 3, 2, z0 + 1, 'brick');                           // north wall, west of road gate
    box(9, 0, z0, x1, 2, z0 + 1, 'brick');                           // north wall, east of road gate
    box(x0, 0, z1 - 1, 3, 2, z1, 'brick');                           // south wall, west of road gate
    box(9, 0, z1 - 1, x1, 2, z1, 'brick');                           // south wall, east of road gate
    box(x0, 0, z0, x0 + 1, 2, z1, 'brick');                          // west
    box(x1 - 1, 0, z0, x1, 2, z1, 'brick');                          // east
    // inside: main walk + the path to the coaster station
    paveRect(x0 + 3, cz - 2, x1 - 3, cz + 3, 'path');
    paveRect(cx - 2, cz + 3, cx + 3, cz + 28, 'path');
    stall(cx - 34, cz + 6, 'brick');
    stall(cx - 28, cz + 6, 'sand');
    stall(cx - 22, cz + 6, 'leaf');
    carousel(cx - 30, cz - 14);
    ferris(cx + 26, cz + 33);   // south-east corner — clear of the rail loop
    for (const [lx, lz] of [[-30, 0], [30, 0], [-10, 20], [10, 20]]) lamp(cx + lx, cz + lz);
    for (const [bx, bz] of [[-14, 2], [12, 2], [-34, 14], [30, 14]]) bench(cx + bx, cz + bz);
    hedge(x0 + 2, cz + 8, x0 + 3, cz + 30);
    hedge(x1 - 3, cz + 8, x1 - 2, cz + 30);
    // coaster station: raised platform beside the rail + a sign
    box(cx - 8, 0, -112 + 1, cx + 12, 1, -112 + 3, 'stone');
    box(cx + 12, 0, -112 + 2, cx + 13, 3, -112 + 3, 'log');     // sign post
    deco(cx + 11, 3, -112 + 1, cx + 14, 5, -112 + 3, 'sand');   // sign board
    // the coaster: proper rails — dark log ties with two thin metal
    // bars riding on top, on timber piers. Decorative, carts carry you.
    const tr = buildTrack();
    tr.pts.forEach((p, i) => {
      const nxt = tr.pts[Math.min(i + 1, tr.pts.length - 1)];
      const yaw = Math.atan2(nxt.x - p.x, nxt.z - p.z);
      const px = Math.cos(yaw), pz = -Math.sin(yaw);   // track-local +X
      if (i % 2 === 0) {                                // tie every ~2.4 m
        voxels.push({ x: p.x, y: p.y - 0.32, z: p.z, mat: 'log', sx: 2.1, sy: 0.22, sz: 0.55, ry: yaw });
      }
      for (const side of [-0.68, 0.68]) {               // the two rails
        voxels.push({
          x: p.x + px * side, y: p.y - 0.06, z: p.z + pz * side,
          mat: 'bin', sx: 0.16, sy: 0.26, sz: 1.45, ry: yaw,
        });
      }
      if (i % 7 === 0 && p.y > 2.5) {                   // support pier
        const rx = Math.floor(p.x), rz = Math.floor(p.z), ry = Math.round(p.y);
        box(rx, 0, rz, rx + 1, ry - 1, rz + 1, 'log');
      }
    });
  };

  for (const s of CONFIG.world.sectors) {
    if (s.kind === 'city') city(s.x, s.z);
    else if (s.kind === 'farm') farm(s.x, s.z);
    else if (s.kind === 'park') park(s.x, s.z);
  }

  // Forest belt around the whole map edge — the world ends in woods.
  for (let i = 0; i < 260; i++) {
    const x = Math.round((rand(state) * 2 - 1) * 186);
    const z = Math.round((rand(state) * 2 - 1) * 186);
    const inSectors = z > -92 && z < 92 && x > -186 && x < 186;
    if (inSectors) continue;
    tree(x, z);
  }
  // a few trees scattered through the sectors too
  for (let i = 0; i < 26; i++) {
    const s = CONFIG.world.sectors[i % CONFIG.world.sectors.length];
    const a = rand(state) * Math.PI * 2;
    const r = 40 + rand(state) * 50;
    tree(Math.round(s.x + Math.cos(a) * r), Math.round(s.z + Math.sin(a) * r));
  }

  return { obstacles, voxels, lootSpots, heightAt };
}
