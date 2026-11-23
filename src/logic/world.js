// World state + fixed-timestep simulation. Pure logic: state is plain
// serializable data, step() is the only mutator. Ports to a server-side
// Luau script driven by RunService.Heartbeat.
import { CONFIG } from './config.js';
import { v3, copy, add, norm, distXZ, lerp, clamp } from './vec3.js';
import { rand } from './rng.js';
import { makeWeapon, stepWeapon, fire, fireSlime } from './weapon.js';
import { makeBots, stepBot } from './bots.js';
import { stickVeggie, tickBin, tryKick, killEntity, redeploy, slimeHit } from './bin.js';
import { segmentSphere, segmentGround, segmentAABB } from './raycast.js';

export function createState() {
  const state = {
    time: 0,
    phase: 'playing',        // 'playing' | 'won' | 'lost'
    nextId: 1,
    rngState: CONFIG.world.seed,
    playerEngaged: false,    // bots ignore the player until first pointer lock
    zone: {
      cx: CONFIG.zone.cx, cz: CONFIG.zone.cz,
      radius: CONFIG.zone.startRadius, dps: CONFIG.zone.dpsStart,
    },
    balcony: { angle: 0 },   // respawn platform riding the zone wall
    projectiles: [],
    pickups: [],             // toast slices popped out of kicked toasters
    events: [],              // drained by the view each frame
    stats: { kills: 0, shots: 0, damageDealt: 0 },
    player: {
      id: 'player', bot: false, name: 'Вы',
      pos: v3(CONFIG.player.spawn.x, CONFIG.drop.height, CONFIG.player.spawn.z),
      vel: v3(),
      yaw: CONFIG.player.spawnYaw,
      hp: CONFIG.player.maxHp,
      alive: true,
      chute: true,             // dropping in under an underwear parachute
      chutePhase: 0,
      binned: false,
      binKind: null,        // 'veg' bin | 'toast' toaster
      binTimer: 0,
      vegCount: 0,
      vegStuck: [],
      lives: CONFIG.lives,
      onBalcony: false,
      balconyTimer: 0,
      balconyP: 0,           // which arc platform of the ring
      balconyA: 0,
      balconyR: -2,
      slimedTimer: 0,
      mounted: null,           // balcony cannon index when manning a gun
      onGround: false,
      weapon: makeWeapon(),
      weaponSlots: [makeWeapon(), makeWeapon()],  // [0] veggie gun, [1] junk gun
      slot: 0,
    },
    bots: [],
    obstacles: [],          // AABB collision parts (1m-grid aligned)
    voxels: [],             // unit cubes {x,y,z,mat} — centers at cell+0.5
  };
  const map = buildMap(state);
  state.obstacles = map.obstacles;
  state.voxels = map.voxels;
  state.bots = makeBots(state);
  return state;
}

// The map is built entirely of 1 m cubes on an integer grid — like
// Minecraft/Roblox parts. Each structure emits aligned AABB collision
// parts plus one voxel per unit cell for rendering.
function buildMap(state) {
  const obstacles = [];
  const voxels = [];
  const placed = [];   // {x0,z0,x1,z1} footprints for overlap rejection

  // addBox: coords are inclusive-exclusive cell indices, 1 unit = 1 cube
  const box = (x0, y0, z0, x1, y1, z1, mat) => {
    obstacles.push({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), mat });
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++)
          voxels.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, mat });
  };

  const clearOf = (x0, z0, x1, z1) => {
    if (x0 - 4 < CONFIG.player.spawn.x && x1 + 4 > CONFIG.player.spawn.x &&
        z0 - 4 < CONFIG.player.spawn.z && z1 + 4 > CONFIG.player.spawn.z) return false;
    for (const p of placed) {
      if (x0 - 2 < p.x1 && x1 + 2 > p.x0 && z0 - 2 < p.z1 && z1 + 2 > p.z0) return false;
    }
    return true;
  };

  const place = (w, d, fn) => {
    for (let tries = 0; tries < 8; tries++) {
      const a = rand(state) * Math.PI * 2;
      const r = 16 + rand(state) * 78;
      const x0 = Math.round(Math.cos(a) * r);
      const z0 = Math.round(Math.sin(a) * r);
      if (!clearOf(x0, z0, x0 + w, z0 + d)) continue;
      placed.push({ x0, z0, x1: x0 + w, z1: z0 + d });
      fn(x0, z0);
      return;
    }
  };

  // Brick ruin: 6×6 footprint, 3-high walls, door gap south, window slit east
  const ruin = (bx, bz) => {
    box(bx, 0, bz, bx + 6, 3, bz + 1, 'brick');            // north wall
    box(bx, 0, bz + 5, bx + 2, 3, bz + 6, 'brick');        // south wall, left of door
    box(bx + 4, 0, bz + 5, bx + 6, 3, bz + 6, 'brick');    // south wall, right of door
    box(bx, 0, bz + 1, bx + 1, 3, bz + 5, 'brick');        // west wall
    box(bx + 5, 0, bz + 1, bx + 6, 1, bz + 5, 'brick');    // east wall sill (climbable)
    box(bx + 5, 2, bz + 1, bx + 6, 3, bz + 5, 'brick');    // east wall above window row
    box(bx + 1, 0, bz + 1, bx + 2, 1, bz + 5, 'dirt');     // dirt strip inside
  };
  // Sand staircase: 4×4 → 2×2 → 1×1, one-cube steps you can walk/jump up
  const sandPile = (bx, bz) => {
    box(bx, 0, bz, bx + 4, 1, bz + 4, 'sand');
    box(bx + 1, 1, bz + 1, bx + 3, 2, bz + 3, 'sand');
    box(bx + 1, 2, bz + 1, bx + 2, 3, bz + 2, 'sand');
  };
  // Dirt mound: low flat platform
  const dirtMound = (bx, bz) => box(bx, 0, bz, bx + 4, 1, bz + 3, 'dirt');
  // Grass pillar: 2-high stack — barely jumpable, blocks shots
  const grassPillar = (bx, bz) => box(bx, 0, bz, bx + 1, 2, bz + 1, 'grass');

  // Tree: log trunk + leaf canopy — solid cover you can walk under
  const tree = (bx, bz) => {
    const h = 3 + Math.floor(rand(state) * 2);    // trunk 3-4 m
    box(bx + 1, 0, bz + 1, bx + 2, h, bz + 2, 'log');
    box(bx, h - 1, bz, bx + 3, h + 1, bz + 3, 'leaf');
    box(bx + 1, h + 1, bz + 1, bx + 2, h + 2, bz + 2, 'leaf');
  };
  // Big house ruin: 8×8, 4-high walls, south door, east window strip,
  // a collapsed roof slab over one half
  const house = (bx, bz) => {
    box(bx, 0, bz, bx + 8, 4, bz + 1, 'brick');
    box(bx, 0, bz + 7, bx + 3, 4, bz + 8, 'brick');
    box(bx + 5, 0, bz + 7, bx + 8, 4, bz + 8, 'brick');
    box(bx, 0, bz + 1, bx + 1, 4, bz + 7, 'brick');
    box(bx + 7, 0, bz + 1, bx + 8, 2, bz + 7, 'brick');
    box(bx + 7, 3, bz + 1, bx + 8, 4, bz + 7, 'brick');
    box(bx + 1, 4, bz + 1, bx + 4, 5, bz + 7, 'brick');
  };
  // Well: brick ring, two log posts, wooden roof
  const well = (bx, bz) => {
    box(bx, 0, bz, bx + 3, 1, bz + 1, 'brick');
    box(bx, 0, bz + 2, bx + 3, 1, bz + 3, 'brick');
    box(bx, 0, bz + 1, bx + 1, 1, bz + 2, 'brick');
    box(bx + 2, 0, bz + 1, bx + 3, 1, bz + 2, 'brick');
    box(bx, 1, bz, bx + 1, 3, bz + 1, 'log');
    box(bx + 2, 1, bz, bx + 3, 3, bz + 1, 'log');
    box(bx, 3, bz, bx + 3, 4, bz + 3, 'log');
  };
  // Watchtower: four log pillars + stone platform with a parapet —
  // a landmark and a jump-up sniper spot
  const tower = (bx, bz) => {
    for (const [px, pz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
      box(bx + px, 0, bz + pz, bx + px + 1, 5, bz + pz + 1, 'log');
    }
    box(bx, 5, bz, bx + 4, 6, bz + 4, 'stone');
    box(bx, 6, bz, bx + 4, 7, bz + 1, 'stone');
    box(bx, 6, bz + 3, bx + 4, 7, bz + 4, 'stone');
    box(bx, 6, bz + 1, bx + 1, 7, bz + 3, 'stone');
    box(bx + 3, 6, bz + 1, bx + 4, 7, bz + 3, 'stone');
  };
  // Roads: flat gravel strips crossing at the zone center — render
  // only (no collision, they're pavement, not walls)
  const half = CONFIG.world.size / 2 - 4;
  const road = (x0, z0, x1, z1) => {
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        voxels.push({ x: x + 0.5, y: 0.07, z: z + 0.5, mat: 'path', sy: 0.14 });
      }
    }
  };
  road(-half, -2, half, 3);   // east-west through the middle
  road(-2, -half, 3, half);   // north-south through the middle

  place(8, 8, house);
  place(6, 6, ruin);
  place(6, 6, ruin);
  place(6, 6, ruin);
  place(4, 4, sandPile);
  place(4, 4, sandPile);
  place(4, 4, sandPile);
  place(3, 3, well);
  place(3, 3, well);
  place(4, 4, tower);
  place(4, 4, tower);
  place(4, 3, dirtMound);
  place(4, 3, dirtMound);
  place(4, 3, dirtMound);
  place(4, 3, dirtMound);
  for (let i = 0; i < 10; i++) place(1, 1, grassPillar);
  for (let i = 0; i < 16; i++) place(3, 3, tree);

  return { obstacles, voxels };
}

// input: {mx, mz, jump, sprint, fire, kick, aim:{x,y,z}, active}
export function step(state, input, dt) {
  if (state.phase !== 'playing') return state;
  state.time += dt;
  if (input.active) state.playerEngaged = true;

  stepPlayer(state, input, dt);
  for (const b of state.bots) {
    if (b.binned) {
      tickBin(state, b, dt);
      integrate(b, dt, state);   // bins still settle onto the ground
    } else if (b.slimedTimer > 0) {
      b.slimedTimer -= dt;       // glued mid-air — frozen where hit
    } else if (!b.onBalcony) {
      stepBot(b, state, dt);
      integrate(b, dt, state);
    }
  }
  stepBalcony(state, dt);
  stepProjectiles(state, dt);
  stepPickups(state, dt);
  stepZone(state, dt);
  checkPhase(state);
  return state;
}

function stepPlayer(state, input, dt) {
  const p = state.player;
  if (!p.alive) return;
  if (p.binned) {
    tickBin(state, p, dt);
    integrate(p, dt, state);
    return;
  }
  if (p.onBalcony) {
    stepPlayerBalcony(state, p, input, dt);
    return;
  }
  const cfg = CONFIG.player;

  // weapon switching: 1/2 selects a slot, wheel cycles
  if (input.slotSel != null) p.slot = clamp(input.slotSel | 0, 0, CONFIG.weaponSlots - 1);
  else if (input.slotCycle) p.slot = (p.slot + input.slotCycle + CONFIG.weaponSlots) % CONFIG.weaponSlots;

  if (p.slimedTimer > 0) {   // glued in place — can still shoot back
    p.slimedTimer -= dt;
    if (input.aim) p.yaw = Math.atan2(input.aim.x, input.aim.z);
    tickCooldowns(p, dt);
    if (input.fire) {
      const shot = fire(state, p, input.aim);
      if (shot) state.stats.shots++;
    }
    return;
  }

  const speed = input.sprint ? cfg.sprintSpeed : cfg.walkSpeed;
  p.vel.x = input.mx * speed;
  p.vel.z = input.mz * speed;
  if (input.jump && p.onGround) {
    p.vel.y = cfg.jumpSpeed;
    p.onGround = false;
  }
  if (input.aim) p.yaw = Math.atan2(input.aim.x, input.aim.z);

  tickCooldowns(p, dt);
  if (input.fire) {
    const shot = fire(state, p, input.aim);
    if (shot) state.stats.shots++;
  }
  if (input.interact) tryKick(state, p);
  integrate(p, dt, state);
}

function tickCooldowns(p, dt) {
  stepWeapon(p.weapon, dt);              // shared slime cooldown
  if (p.weaponSlots) for (const w of p.weaponSlots) stepWeapon(w, dt);
}

// Balcony ring: several independent arc platforms at a FIXED radius
// (the shrinking wall slides underneath), each with sniper cannons.
// WASD walks the ring (mx = along, mz = in/out), E mounts a cannon,
// LMB fires pinning slime while mounted.
function platformAngle(state, platformIdx, localA) {
  return state.balcony.angle +
    (platformIdx * Math.PI * 2) / CONFIG.balcony.platforms + localA;
}

function stepPlayerBalcony(state, p, input, dt) {
  const bc = CONFIG.balcony;
  if (input.aim) p.yaw = Math.atan2(input.aim.x, input.aim.z);
  stepWeapon(p.weapon, dt);

  if (p.mounted != null) {
    if (input.interact) { p.mounted = null; return; }
    if (input.fire) fireSlime(state, p, input.aim, cannonMuzzle(state, p.mounted));
    return;
  }

  // convert world-space wish dir to ring tangential / radial parts
  const a = platformAngle(state, p.balconyP, p.balconyA);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const tang = input.mx * -sa + input.mz * ca;          // + = ccw along ring
  const inward = -(input.mx * ca + input.mz * sa);      // + = toward centre
  const r = Math.max(2, bc.radius + p.balconyR);
  p.balconyA = clamp(p.balconyA + (tang * bc.walkSpeed / r) * dt, 0.02, bc.span - 0.02);
  p.balconyR = clamp(p.balconyR - inward * bc.walkSpeed * dt, -bc.width, -0.6);

  if (input.interact) {
    const c = nearestCannon(state, p);
    if (c) {
      p.mounted = c;
      // face the arena on mount — the view snaps the camera on this event
      state.events.push({
        type: 'mountedCannon',
        angle: platformAngle(state, c.p, bc.cannons[c.c]),
      });
    }
  }
}

// Cannon position: platformIdx + cannonIdx inside that platform's arc,
// sitting on the field-side edge with the barrel overhanging the void.
function cannonPos(state, platformIdx, cannonIdx) {
  const a = platformAngle(state, platformIdx, CONFIG.balcony.cannons[cannonIdx]);
  const r = Math.max(2, CONFIG.balcony.radius - CONFIG.balcony.width + 0.2);
  return {
    x: state.zone.cx + Math.cos(a) * r,
    y: CONFIG.balcony.height,
    z: state.zone.cz + Math.sin(a) * r,
  };
}

// World position of the barrel tip — slime spawns here so it flies
// exactly along the scope line (the scope camera sits on the same point).
function cannonMuzzle(state, mounted) {
  const a = platformAngle(state, mounted.p, CONFIG.balcony.cannons[mounted.c]);
  const cp = cannonPos(state, mounted.p, mounted.c);
  return {
    x: cp.x - Math.cos(a) * 2.74,
    y: cp.y + 0.98,
    z: cp.z - Math.sin(a) * 2.74,
  };
}

function nearestCannon(state, p) {
  for (let pi = 0; pi < CONFIG.balcony.platforms; pi++) {
    for (let ci = 0; ci < CONFIG.balcony.cannons.length; ci++) {
      if (cannonTaken(state, pi, ci, p)) continue;
      if (distXZ(p.pos, cannonPos(state, pi, ci)) < CONFIG.balcony.mountRange) {
        return { p: pi, c: ci };
      }
    }
  }
  return null;
}

function cannonTaken(state, pi, ci, except) {
  if (state.player !== except &&
      state.player.mounted && state.player.mounted.p === pi && state.player.mounted.c === ci) return true;
  for (const b of state.bots) {
    if (b === except) continue;
    if (b.mounted && b.mounted.p === pi && b.mounted.c === ci) return true;
  }
  return false;
}

// Bots on the balcony grab a free cannon on their platform and plink
// slime at anyone running below.
function stepBotBalcony(bot, state, dt) {
  const bc = CONFIG.balcony;
  if (bot.mounted == null) {
    for (let ci = 0; ci < bc.cannons.length; ci++) {
      if (!cannonTaken(state, bot.balconyP, ci, bot)) {
        bot.mounted = { p: bot.balconyP, c: ci };
        break;
      }
    }
    return;
  }
  bot.ai.fireAt -= dt;
  stepWeapon(bot.weapon, dt);
  if (bot.ai.fireAt > 0) return;
  const target = nearestGroundEnemy(bot, state);
  if (!target) return;
  const muzzle = cannonMuzzle(state, bot.mounted);
  const sp = CONFIG.balcony.botAimSpread;
  const dir = norm({
    x: target.pos.x - muzzle.x + (rand(state) - 0.5) * 2 * sp * 40,
    y: target.pos.y + 1.0 - muzzle.y + (rand(state) - 0.5) * 2 * sp * 40,
    z: target.pos.z - muzzle.z + (rand(state) - 0.5) * 2 * sp * 40,
  });
  fireSlime(state, bot, dir, muzzle);
  bot.ai.fireAt = 1.2 + rand(state) * 1.6;
}

function nearestGroundEnemy(bot, state) {
  let best = null;
  let bd = CONFIG.balcony.botSnipeRange;
  const consider = (e) => {
    if (!e.alive || e.binned || e.onBalcony || e === bot) return;
    const d = distXZ(bot.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  };
  consider(state.player);
  for (const b of state.bots) consider(b);
  return best;
}

// Orbit the balcony ring and ride every waiting entity around with it.
function stepBalcony(state, dt) {
  const b = state.balcony;
  b.angle += CONFIG.balcony.angVel * dt;
  const ride = (e, isBot) => {
    e.balconyTimer -= dt;
    if (e.balconyTimer <= 0) { redeploy(state, e); return; }
    if (isBot) stepBotBalcony(e, state, dt);
    if (e.mounted != null) {
      // manning a gun: stand behind AND beside it — the barrel runs
      // alongside the sight line instead of blocking the scope
      const cp = cannonPos(state, e.mounted.p, e.mounted.c);
      const a = platformAngle(state, e.mounted.p, CONFIG.balcony.cannons[e.mounted.c]);
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      e.pos.x = cp.x + Math.cos(a) * 1.6 + tx * 1.0;
      e.pos.z = cp.z + Math.sin(a) * 1.6 + tz * 1.0;
      e.pos.y = CONFIG.balcony.height;
      return;
    }
    const a = platformAngle(state, e.balconyP, e.balconyA);
    const r = Math.max(2, CONFIG.balcony.radius + e.balconyR);
    e.pos.x = state.zone.cx + Math.cos(a) * r;
    e.pos.z = state.zone.cz + Math.sin(a) * r;
    e.pos.y = CONFIG.balcony.height;
    e.vel = v3();
  };
  if (state.player.onBalcony) ride(state.player, false);
  for (const bot of state.bots) if (bot.onBalcony) ride(bot, true);
}

// Shared gravity/floor/bounds/obstacle integration for every entity.
// Crates are real platforms: sides push you out, tops hold you up.
function integrate(e, dt, state) {
  const prevY = e.pos.y;
  e.vel.y -= CONFIG.player.gravity * dt;
  if (e.chute) {
    // underwear parachute: capped fall speed + gentle sway
    if (e.vel.y < -CONFIG.drop.fallSpeed) e.vel.y = -CONFIG.drop.fallSpeed;
    e.pos.x += Math.sin(state.time * 1.5 + e.chutePhase) * CONFIG.drop.sway * dt;
    e.pos.z += Math.cos(state.time * 1.2 + e.chutePhase) * CONFIG.drop.sway * 0.7 * dt;
  }
  e.pos.x += e.vel.x * dt;
  e.pos.y += e.vel.y * dt;
  e.pos.z += e.vel.z * dt;
  const half = CONFIG.world.size / 2 - 1;
  e.pos.x = clamp(e.pos.x, -half, half);
  e.pos.z = clamp(e.pos.z, -half, half);

  // Landing check runs BEFORE side pushout: a crate top is a floor when the
  // feet reached it from above this step (swept — fast falls can't tunnel).
  const floor = floorHeight(e, state, prevY);
  if (floor > 0 && e.pos.y <= floor) {
    e.pos.y = floor;
    e.vel.y = 0;
    e.onGround = true;
    if (e.chute) { e.chute = false; state.events.push({ type: 'landed', pos: copy(e.pos) }); }
  } else if (e.pos.y <= 0) {
    e.pos.y = 0;
    e.vel.y = 0;
    e.onGround = true;
    if (e.chute) { e.chute = false; state.events.push({ type: 'landed', pos: copy(e.pos) }); }
  } else {
    e.onGround = false;
  }
  // Side pushout runs ALWAYS — standing on a lower cube must not let
  // you walk through the side of a higher one. The block under your
  // feet is skipped by the pos.y >= max.y check inside.
  resolveObstacleSides(e, state);
}

// Circle-vs-box pushout on the XZ plane — only while feet are below the
// crate top; at/above the top the crate is a floor, not a wall.
function resolveObstacleSides(e, state) {
  const r = CONFIG.player.radius;
  for (const o of state.obstacles) {
    if (e.pos.y >= o.max.y - 0.05) continue;
    const cx = clamp(e.pos.x, o.min.x, o.max.x);
    const cz = clamp(e.pos.z, o.min.z, o.max.z);
    const dx = e.pos.x - cx;
    const dz = e.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      e.pos.x = cx + (dx / d) * r;
      e.pos.z = cz + (dz / d) * r;
    } else {
      const dl = e.pos.x - o.min.x;
      const dr = o.max.x - e.pos.x;
      const dn = e.pos.z - o.min.z;
      const df = o.max.z - e.pos.z;
      const m = Math.min(dl, dr, dn, df);
      if (m === dl) e.pos.x = o.min.x - r;
      else if (m === dr) e.pos.x = o.max.x + r;
      else if (m === dn) e.pos.z = o.min.z - r;
      else e.pos.z = o.max.z + r;
    }
  }
}

// Highest surface under the entity: the ground plane or a crate top the
// feet reached from above this step (swept, so fast falls can't tunnel).
function floorHeight(e, state, prevY) {
  let floor = 0;
  const r = CONFIG.player.radius * 0.6;
  for (const o of state.obstacles) {
    if (e.pos.x <= o.min.x - r || e.pos.x >= o.max.x + r) continue;
    if (e.pos.z <= o.min.z - r || e.pos.z >= o.max.z + r) continue;
    if (o.max.y <= prevY + 1e-4 && e.pos.y <= o.max.y) {
      floor = Math.max(floor, o.max.y);
    }
  }
  return floor;
}

function forEachTarget(state, ownerId, fn) {
  const p = state.player;
  if (p.alive && !p.binned && !p.onBalcony && p.id !== ownerId) fn(p);
  for (const b of state.bots) {
    if (b.alive && !b.binned && !b.onBalcony && b.id !== ownerId) fn(b);
  }
}

function stepProjectiles(state, dt) {
  const cfg = CONFIG.weapon;
  const remaining = [];
  for (const p of state.projectiles) {
    p.prev = copy(p.pos);
    p.vel.y -= (p.gravity ?? cfg.gravity) * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    p.ttl -= dt;

    // Earliest hit along the swept segment prev -> pos wins.
    let hit = null;
    const consider = (h, kind, ent) => {
      if (h && (!hit || h.t < hit.t)) hit = { t: h.t, point: h.point, kind, ent };
    };
    forEachTarget(state, p.owner, (e) => {
      if (e.id === 'player' && !state.playerEngaged) return;
      const c = add(e.pos, { x: 0, y: CONFIG.player.hitCenterY, z: 0 });
      consider(segmentSphere(p.prev, p.pos, c, CONFIG.player.hitRadius + (p.radius ?? cfg.radius)), 'entity', e);
    });
    consider(segmentGround(p.prev, p.pos, 0), 'ground', null);
    for (const o of state.obstacles) {
      consider(segmentAABB(p.prev, p.pos, o.min, o.max), 'obstacle', null);
    }

    if (hit) {
      p.pos = copy(hit.point);
      if (hit.kind === 'entity') {
        if (p.type === 'slime') slimeHit(state, hit.ent, p.owner);
        else stickVeggie(state, hit.ent, p.type, p.owner, p.sticks ?? 1);
      }
      // misses stay silent — no splat clutter
    } else if (p.ttl > 0) {
      remaining.push(p);
    }
  }
  state.projectiles = remaining;
}

// Toast slices popped from kicked toasters: fall, settle, heal whoever
// touches them (only when they can actually use the HP).
function stepPickups(state, dt) {
  const cfg = CONFIG.toaster;
  const keep = [];
  for (const p of state.pickups) {
    p.ttl -= dt;
    p.vel.y -= 20 * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    if (p.pos.y <= 0.18 && p.vel.y < 0) {
      p.pos.y = 0.18;
      p.vel = { x: 0, y: 0, z: 0 };   // settled on the grass
    }
    const settled = p.vel.x === 0 && p.vel.y === 0 && p.vel.z === 0;
    if (!settled) { if (p.ttl > 0) keep.push(p); continue; }
    let eaten = false;
    forEachTarget(state, null, (e) => {
      if (eaten) return;
      const max = e.bot ? CONFIG.bots.maxHp : CONFIG.player.maxHp;
      if (e.hp >= max) return;
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < cfg.pickupR) {
        e.hp = Math.min(max, e.hp + cfg.heal);
        eaten = true;
        state.events.push({
          type: 'heal', target: e.id, name: e.name, amount: cfg.heal,
          pos: { x: p.pos.x, y: p.pos.y + 0.4, z: p.pos.z },
          byPlayer: e.id === 'player',
        });
      }
    });
    if (!eaten && p.ttl > 0) keep.push(p);
  }
  state.pickups = keep;
}

export function damage(state, ent, amount, attackerId, veggie) {
  if (!ent.alive || ent.binned) return;
  if (ent.id === 'player' && !state.playerEngaged) return;
  ent.hp -= amount;
  state.events.push({
    type: 'hit',
    pos: add(ent.pos, { x: 0, y: 1.2, z: 0 }),
    target: ent.id,
    veggie: veggie || null,
    byPlayer: attackerId === 'player',
  });
  if (ent.hp <= 0) {
    ent.hp = 0;
    if (attackerId === 'player') state.stats.kills++;
    state.events.push({ type: 'kill', victim: ent.id, attacker: attackerId, name: ent.name, veggie: veggie || null });
    killEntity(state, ent);
  }
}

function stepZone(state, dt) {
  const z = CONFIG.zone;
  const t = clamp((state.time - z.shrinkDelay) / z.shrinkTime, 0, 1);
  state.zone.radius = lerp(z.startRadius, z.endRadius, t);
  state.zone.dps = lerp(z.dpsStart, z.dpsEnd, t);
  const center = { x: state.zone.cx, y: 0, z: state.zone.cz };
  const burn = (e) => {
    if (!e.alive || e.binned || e.onBalcony) return;
    if (e.id === 'player' && !state.playerEngaged) return;
    if (distXZ(e.pos, center) > state.zone.radius) {
      damage(state, e, state.zone.dps * dt, 'zone');
    }
  };
  burn(state.player);
  for (const b of state.bots) burn(b);
}

function checkPhase(state) {
  let next = null;
  if (!state.player.alive) next = 'lost';
  else if (state.bots.every((b) => !b.alive)) next = 'won';
  if (next) {
    state.phase = next;
    state.events.push({ type: 'phase', phase: next });
  }
}
