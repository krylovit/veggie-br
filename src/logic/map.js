// City map: a plaza with the infection hatch at the centre, an avenue
// cross, a street grid of building blocks (roofed and ruined houses,
// a market row, a warehouse, stair-accessible roofs), parks, and a
// forest ring closing the map edge. Everything is 1 m voxel cubes —
// each box emits an AABB collision part plus one cube per unit cell.
import { CONFIG } from './config.js';
import { v3 } from './vec3.js';
import { rand } from './rng.js';

export function buildMap(state) {
  const obstacles = [];
  const voxels = [];

  const box = (x0, y0, z0, x1, y1, z1, mat) => {
    obstacles.push({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), mat });
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

  // A wall run along x (or z via swap): sill band + lintel band + posts,
  // with door/window gaps. `gaps` = [{at, w, kind:'door'|'win'}].
  const wallX = (x0, z, x1, h, mat, gaps = []) => {
    let cur = x0;
    const sorted = gaps.slice().sort((a, b) => a.at - b.at);
    const solid = (a, b) => { if (b > a) box(a, 0, z, b, h, z + 1, mat); };
    for (const g of sorted) {
      solid(cur, g.at);
      if (g.kind === 'win') {
        box(g.at, 0, z, g.at + g.w, 1, z + 1, mat);          // 1 m sill — climbable
        box(g.at, 2, z, g.at + g.w, h, z + 1, mat);          // lintel above the hole
      }   // 'door' leaves the gap fully open
      cur = g.at + g.w;
    }
    solid(cur, x1);
  };
  const wallZ = (x, z0, z1, h, mat, gaps = []) => {
    let cur = z0;
    const sorted = gaps.slice().sort((a, b) => a.at - b.at);
    const solid = (a, b) => { if (b > a) box(x, 0, a, x + 1, h, b, mat); };
    for (const g of sorted) {
      solid(cur, g.at);
      if (g.kind === 'win') {
        box(x, 0, g.at, x + 1, 1, g.at + g.w, mat);
        box(x, 2, g.at, x + 1, h, g.at + g.w, mat);
      }
      cur = g.at + g.w;
    }
    solid(cur, z1);
  };

  // House: four walls (door south, windows on the sides), optionally a
  // flat roof slab or a broken ruin without it.
  const house = (x0, z0, w, d, h, mat, roofed) => {
    const dz = Math.floor(d / 2);
    wallX(x0, z0, x0 + w, h, mat);                                        // north
    wallX(x0, z0 + d - 1, x0 + w, h, mat, [{ at: x0 + dz, w: 2, kind: 'door' }]); // south + door
    wallZ(x0, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);   // west + window
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + d - 4, w: 2, kind: 'win' }]); // east + window
    if (roofed) box(x0, h, z0, x0 + w, h + 1, z0 + d, 'stone');           // flat roof
    paveRect(x0 + 1, z0 + 1, x0 + w - 1, z0 + d - 1, 'path');             // plank-ish floor
  };

  // Ruined house: same walls but chopped heights and no roof.
  const ruin = (x0, z0, w, d, mat) => {
    const dz = Math.floor(d / 2);
    wallX(x0, z0, x0 + w, 2, mat);
    wallX(x0, z0 + d - 1, x0 + w, 3, mat, [{ at: x0 + dz, w: 2, kind: 'door' }]);
    wallZ(x0, z0 + 1, z0 + d - 1, 2, mat);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, 3, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    box(x0 + 1, 0, z0 + 1, x0 + 3, 1, z0 + 2, 'dirt');                    // rubble inside
  };

  // Apartments: a 6 m slab of a building, windows both floors, flat
  // roof at h=6 with a parapet, and a 1 m-step stair tower on the side.
  const apartments = (x0, z0, w, d, mat) => {
    const h = 6;
    const dz = Math.floor(d / 2);
    wallX(x0, z0, x0 + w, h, mat, [{ at: x0 + 3, w: 2, kind: 'win' }]);
    wallX(x0, z0 + d - 1, x0 + w, h, mat, [{ at: x0 + dz, w: 2, kind: 'door' }, { at: x0 + w - 4, w: 2, kind: 'win' }]);
    wallZ(x0, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, h, mat, [{ at: z0 + 2, w: 2, kind: 'win' }]);
    box(x0, 3, z0, x0 + w, 4, z0 + d, 'stone');                           // floor slab
    box(x0, h, z0, x0 + w, h + 1, z0 + d, 'stone');                       // roof slab
    // parapet lip so the roof reads finished
    box(x0, h + 1, z0, x0 + w, h + 2, z0 + 1, mat);
    box(x0, h + 1, z0 + d - 1, x0 + w, h + 2, z0 + d, mat);
    box(x0, h + 1, z0, x0 + 1, h + 2, z0 + d, mat);
    box(x0 + w - 1, h + 1, z0, x0 + w, h + 2, z0 + d, mat);
    // stair tower up the west side: 1 m risers to the roof
    const sx = x0 - 2;
    for (let i = 0; i < 6; i++) {
      box(sx, 0, z0 + d - 2 - i, sx + 1, i + 1, z0 + d - 1 - i, 'stone');
    }
    box(sx, 0, z0 + d - 1, sx + 1, 1, z0 + d, 'stone');                   // landing step
  };

  // Warehouse: big open-front shed — the loot barn.
  const warehouse = (x0, z0, w, d, mat) => {
    const h = 4;
    wallX(x0, z0, x0 + w, h, mat);
    wallX(x0, z0 + d - 1, x0 + 3, h, mat);
    wallX(x0 + w - 3, z0 + d - 1, x0 + w, h, mat);                        // 6 m opening
    wallZ(x0, z0 + 1, z0 + d - 1, h, mat);
    wallZ(x0 + w - 1, z0 + 1, z0 + d - 1, h, mat);
    box(x0, h, z0, x0 + w, h + 1, z0 + d, 'log');                         // plank roof
    paveRect(x0 + 1, z0 + 1, x0 + w - 1, z0 + d - 1, 'dirt');
    // shelf rows with gaps — cover inside the shed
    box(x0 + 2, 0, z0 + 2, x0 + 3, 2, z0 + d - 3, 'log');
    box(x0 + w - 3, 0, z0 + 2, x0 + w - 2, 2, z0 + d - 3, 'log');
  };

  // Market stall: posts + canopy roof + counter.
  const stall = (x0, z0, mat) => {
    for (const [px, pz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
      box(x0 + px, 0, z0 + pz, x0 + px + 1, 3, z0 + pz + 1, 'log');
    }
    box(x0 - 1, 3, z0 - 1, x0 + 4, 4, z0 + 4, mat);
    box(x0, 0, z0 + 1, x0 + 3, 1, z0 + 2, 'stone');                       // counter
  };

  // Tree: trunk + canopy — same as before.
  const tree = (bx, bz) => {
    const h = 3 + Math.floor(rand(state) * 2);
    box(bx + 1, 0, bz + 1, bx + 2, h, bz + 2, 'log');
    box(bx, h - 1, bz, bx + 3, h + 1, bz + 3, 'leaf');
    box(bx + 1, h + 1, bz + 1, bx + 2, h + 2, bz + 2, 'leaf');
  };
  // Hedge: jumpable leaf wall.
  const hedge = (x0, z0, x1, z1) => box(x0, 0, z0, x1, 2, z1, 'leaf');
  // Bench: low log slab.
  const bench = (x, z) => box(x, 0, z, x + 2, 1, z + 1, 'log');
  // Lamp post: stone pole + glowing-ish top.
  const lamp = (x, z) => {
    box(x, 0, z, x + 1, 4, z + 1, 'log');
    box(x, 4, z, x + 1, 5, z + 1, 'stone');
  };

  // ---- layout -------------------------------------------------------

  const roadAt = (c) => [c - 2, c + 3];                 // 5 m streets
  const streetC = [-58, -29, 0, 29, 58];                // road centrelines
  for (const c of streetC) {
    const [a, b] = roadAt(c);
    paveRect(a, -92, b, 92, 'path');                    // N-S street
    paveRect(-92, a, 92, b, 'path');                    // E-W street
  }

  // Centre plaza: pavement circle r=13 around the hatch, lamp posts on
  // the diagonals, planters and benches to fight around.
  const PR = 13;
  for (let x = -PR; x <= PR; x++)
    for (let z = -PR; z <= PR; z++)
      if (Math.hypot(x + 0.5, z + 0.5) <= PR) pave(x, z, 'stone');
  // kerb ring so the plaza edge reads
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    const kx = Math.round(Math.cos(t) * (PR + 0.5));
    const kz = Math.round(Math.sin(t) * (PR + 0.5));
    voxels.push({ x: kx + 0.5, y: 0.5, z: kz + 0.5, mat: 'brick' });   // decorative kerb — no collision
  }
  for (const [lx, lz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) lamp(lx, lz);
  for (const [bx, bz] of [[-11, -1], [9, -1], [-1, -11], [-1, 9]]) bench(bx, bz);
  for (const [px, pz] of [[-11, -11], [10, -11], [-11, 10], [10, 10]]) {
    box(px, 0, pz, px + 2, 1, pz + 2, 'stone');                          // planter
    box(px, 1, pz, px + 2, 3, pz + 2, 'leaf');                           // shrub on top
  }

  // Blocks between streets: cells bounded by the road grid. Centre cell
  // is the plaza — skip it.
  const blockEdges = [-92, -60, -31, -3, 3, 31, 60, 92];
  const r01 = () => rand(state);

  for (let i = 0; i < blockEdges.length - 1; i++) {
    for (let j = 0; j < blockEdges.length - 1; j++) {
      const x0 = blockEdges[i], x1 = blockEdges[i + 1];
      const z0 = blockEdges[j], z1 = blockEdges[j + 1];
      const cw = x1 - x0, cd = z1 - z0;
      if (cw < 10 || cd < 10) continue;
      // skip the plaza cell and its 8 neighbours — keep the centre open
      if (x1 > -12 && x0 < 12 && z1 > -12 && z0 < 12) continue;
      const r = r01();
      if (r < 0.3) {
        // two small residences back to back
        const w = Math.min(10, cw - 8), d = Math.min(8, Math.floor(cd / 2) - 3);
        house(x0 + 3, z0 + 2, w, d, 3, 'brick', true);
        house(x0 + cw - 3 - w, z0 + cd - 2 - d, w, d, 3, 'brick', r01() < 0.5);
      } else if (r < 0.55) {
        const w = Math.min(12, cw - 8), d = Math.min(10, cd - 8);
        apartments(x0 + Math.floor((cw - w) / 2), z0 + Math.floor((cd - d) / 2), w, d, 'brick');
      } else if (r < 0.7) {
        const w = Math.min(14, cw - 8), d = Math.min(10, cd - 8);
        warehouse(x0 + Math.floor((cw - w) / 2), z0 + Math.floor((cd - d) / 2), w, d, 'stone');
      } else if (r < 0.85) {
        // market row: stalls along the block edge
        stall(x0 + 3, z0 + 3, 'brick');
        stall(x0 + 8, z0 + 3, 'sand');
        stall(x0 + 3, z0 + 8, 'leaf');
        ruin(x0 + cw - 10, z0 + cd - 9, 8, 7, 'brick');
      } else {
        // park: hedges, trees, benches
        hedge(x0 + 2, z0 + 2, x0 + 2 + Math.min(cw - 4, 10), z0 + 3);
        hedge(x0 + 2, z0 + 2, x0 + 3, z0 + 2 + Math.min(cd - 4, 8));
        tree(x0 + cw - 8, z0 + 4);
        tree(x0 + cw - 13, z0 + cd - 8);
        bench(x0 + 5, z0 + Math.floor(cd / 2));
        paveRect(x0 + 4, z0 + Math.floor(cd / 2) - 1, x0 + cw - 4, z0 + Math.floor(cd / 2) + 1, 'path');
      }
    }
  }

  // Perimeter forest ring — the map edge reads as woods, not void.
  for (let i = 0; i < 90; i++) {
    const a = rand(state) * Math.PI * 2;
    const r = 88 + rand(state) * 18;
    const bx = Math.round(Math.cos(a) * r);
    const bz = Math.round(Math.sin(a) * r);
    if (Math.abs(bx) > 106 || Math.abs(bz) > 106) continue;
    tree(bx, bz);
  }
  // A few trees scattered through the city too.
  for (let i = 0; i < 14; i++) {
    const a = rand(state) * Math.PI * 2;
    const r = 18 + rand(state) * 60;
    const bx = Math.round(Math.cos(a) * r);
    const bz = Math.round(Math.sin(a) * r);
    tree(bx, bz);
  }

  return { obstacles, voxels };
}
