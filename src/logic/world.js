// World state + fixed-timestep simulation. Pure logic: state is plain
// serializable data, step() is the only mutator. Ports to a server-side
// Luau script driven by RunService.Heartbeat.
import { CONFIG } from './config.js';
import { v3, copy, add, norm, distXZ, lerp, clamp } from './vec3.js';
import { rand } from './rng.js';
import { makeWeapon, stepWeapon, fire, fireSlime } from './weapon.js';
import { makeBots, stepBot } from './bots.js';
import { stickVeggie, tickBin, tryKick, killEntity, redeploy, slimeHit } from './bin.js';
import { spawnCrates, tryOpenCrate, tryGrabLoot } from './loot.js';
import { makeInfection, stepHatch, stepZombie, tryPressButton, tryBite } from './zombies.js';
import { spawnCars, stepCar, tryEnterCar, exitCar } from './cars.js';
import { makeCoaster, stepCoaster, tryBoardCart, exitCart } from './coaster.js';
import { buildMap } from './map.js';
import { segmentSphere, segmentGround, segmentAABB } from './raycast.js';

// opts: {seed, humans:[{id,name}], myId, netRole} — defaults give the
// classic solo match (one local player + bots).
export function createState(opts = {}) {
  const humans = opts.humans ?? [{ id: 'player', name: 'Вы' }];
  const myId = opts.myId ?? humans[0].id;
  const state = {
    time: 0,
    phase: 'playing',        // 'playing' | 'won' | 'lost'
    nextId: 1,
    rngState: opts.seed ?? CONFIG.world.seed,
    netRole: opts.netRole ?? 'solo',   // 'solo' | 'host' | 'client'
    myNetId: myId,
    playerEngaged: false,    // bots ignore the player until first pointer lock
    zone: {
      cx: CONFIG.zone.cx, cz: CONFIG.zone.cz,
      radius: CONFIG.zone.startRadius, dps: CONFIG.zone.phases[0].dps,
      phase: 0, t: 0, phaseR: CONFIG.zone.startRadius,
      moving: false, waitLeft: 0,
    },
    balcony: { angle: 0 },   // respawn platform riding the zone wall
    projectiles: [],
    pickups: [],             // toast slices popped out of kicked toasters
    lootPops: [],            // guns floating in bubbles above opened crates
    events: [],              // drained by the view each frame
    stats: { kills: 0, shots: 0, damageDealt: 0 },
    humans: [],
    player: null,
    bots: [],
    obstacles: [],          // AABB collision parts (1m-grid aligned)
    voxels: [],             // unit cubes {x,y,z,mat} — centers at cell+0.5
  };
  humans.forEach((h, i) => {
    const e = makeHuman(state, h.id, h.name, i, humans.length);
    e.remote = h.id !== myId;
    e.snapDriven = e.remote && state.netRole === 'client';
    state.humans.push(e);
    if (h.id === myId) state.player = e;
  });
  if (!state.player) { state.player = state.humans[0]; state.player.remote = false; }
  const map = buildMap(state);
  state.obstacles = map.obstacles;
  state.voxels = map.voxels;
  state.lootSpots = map.lootSpots;   // building interiors — indoor crates
  state.heightAt = map.heightAt;     // terrain relief: gentle hills in the wilds
  state.cars = spawnCars(state);
  makeCoaster(state);
  state.bots = makeBots(state, Math.max(0, CONFIG.lobby.slots - state.humans.length));
  state.crates = spawnCrates(state);
  makeInfection(state);
  // stable net ordering: humans first (join order), then bots
  state.netEnts = [...state.humans, ...state.bots];
  state.netEnts.forEach((e, i) => { e.netIdx = i; });
  return state;
}

// Every entity the sim knows about — humans (local + remote) and bots.
export function allEntities(state) {
  return state.humans.concat(state.bots, state.zombies || []);
}

export { nearestCrate, openCrate, tryOpenCrate } from './loot.js';

function makeHuman(state, id, name, i, n) {
  // humans parachute in on a ring around the spawn point — same seed
  // gives every client the same drop positions
  const a = (i / Math.max(1, n)) * Math.PI * 2 + rand(state) * 0.5;
  const r = n === 1 ? 0 : 10 + rand(state) * 25;
  return {
    id, bot: false, remote: false, snapDriven: false, engaged: false,
    netInput: null,
    name,
    pos: v3(CONFIG.player.spawn.x + Math.cos(a) * r, CONFIG.drop.height,
            CONFIG.player.spawn.z + Math.sin(a) * r),
    vel: v3(),
    yaw: CONFIG.player.spawnYaw,
    hp: CONFIG.player.maxHp,
    alive: true,
    chute: true,             // dropping in under an underwear parachute
    chutePhase: rand(state) * Math.PI * 2,
    binned: false,
    binKind: null,        // 'veg' bin | 'toast' toaster
    binTimer: 0,
    binFlyT: 0,            // >0: kicked bin still tumbling through the air
    binFlySpin: 0,
    binFlyDir: null,
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
    guns: [false, false],    // owned weapons — everyone lands unarmed
    slot: 0,
    zombie: false,           // bitten: body stays, the hunger drives now
    biteT: 0,
  };
}

// input: {mx, mz, jump, sprint, fire, kick, aim:{x,y,z}, active}
const EMPTY_INPUT = { mx: 0, mz: 0, jump: false, sprint: false, fire: false, interact: false, aim: null, slotSel: null, slotCycle: 0, active: false };

export function step(state, input, dt) {
  if (state.phase !== 'playing') return state;
  state.time += dt;
  if (input.active) { state.playerEngaged = true; state.player.engaged = true; }

  const client = state.netRole === 'client';
  stepHuman(state, state.player, input, dt);
  if (!client) {
    // host/solo: remote humans are stepped by their last received input
    for (const h of state.humans) {
      if (h === state.player) continue;
      const inp = h.netInput || EMPTY_INPUT;
      if (inp.active) h.engaged = true;
      stepHuman(state, h, inp, dt);
    }
    for (const b of state.bots) {
      if (b.binFlyT > 0) {
        stepBinFly(state, b, dt);
      } else if (b.binned) {
        tickBin(state, b, dt);
        integrate(b, dt, state);   // bins still settle onto the ground
      } else if (b.slimedTimer > 0) {
        b.slimedTimer -= dt;       // glued mid-air — frozen where hit
      } else if (!b.onBalcony) {
        if (b.zombie) stepZombie(b, state, dt);
        else stepBot(b, state, dt);
        integrate(b, dt, state);
      }
    }
    for (const z of state.zombies) {
      if (!z.alive) continue;
      if (z.slimedTimer > 0) { z.slimedTimer -= dt; continue; }   // cannon glue freezes zombies too
      stepZombie(z, state, dt);
      integrate(z, dt, state);
    }
    stepHatch(state, dt);
    for (const lp of state.lootPops) lp.age += dt;
    for (const c of state.cars) stepCar(state, c, dt);
    stepCoaster(state, dt);
    separateEntities(state);
  } else {
    // client: snapshot positions arrive in e.tgt — drift toward them
    for (const e of allEntities(state)) {
      if (!e.tgt) continue;
      e.pos.x += (e.tgt.x - e.pos.x) * Math.min(1, dt * 8);
      e.pos.y += (e.tgt.y - e.pos.y) * Math.min(1, dt * 8);
      e.pos.z += (e.tgt.z - e.pos.z) * Math.min(1, dt * 8);
    }
  }
  stepBalcony(state, dt);
  stepProjectiles(state, dt);
  if (!client) {
    stepPickups(state, dt);
    stepZone(state, dt);
    checkPhase(state);
  } else {
    // clients only animate pickups — the host decides who ate them
    stepPickupMotion(state, dt);
  }
  return state;
}

// A kicked bin tumbles through the air (victim rides inside — first
// person sees the somersault), bounces off the ground, then the kill
// is scored: balcony redeploy or out for good.
function stepBinFly(state, e, dt) {
  e.binFlyT -= dt;
  e.binFlySpin += dt * CONFIG.bin.spinRate;
  e.vel.y -= CONFIG.player.gravity * dt;
  e.pos.x += e.vel.x * dt;
  e.pos.y += e.vel.y * dt;
  e.pos.z += e.vel.z * dt;
  const floor = floorHeight(e, state, e.pos.y + 0.5);
  if (e.pos.y <= Math.max(0.4, floor)) {
    e.pos.y = Math.max(0.4, floor);
    if (e.vel.y < -2) {   // real thump — bounce it
      e.vel.y = -e.vel.y * CONFIG.bin.bounce;
      e.vel.x *= 0.6;
      e.vel.z *= 0.6;
      state.events.push({ type: 'landed', pos: copy(e.pos) });
    } else {
      e.vel = v3();
    }
  }
  resolveObstacleSides(e, state);
  if (e.binFlyT <= 0) {
    e.binFlyT = 0;
    killEntity(state, e);
  }
}

function stepHuman(state, p, input, dt) {
  if (!p.alive) return;
  if (p.binFlyT > 0) { stepBinFly(state, p, dt); return; }
  if (p.binned) {
    tickBin(state, p, dt);
    integrate(p, dt, state);
    return;
  }
  if (p.onBalcony) {
    stepPlayerBalcony(state, p, input, dt);
    return;
  }
  if (p.zombie) {
    stepZombieHuman(state, p, input, dt);
    return;
  }
  // driving a car: WASD steers the vehicle, E/Space bails out
  if (p.car) {
    p.car.wish = { mx: input.mx, mz: input.mz };
    if (input.aim) p.yaw = Math.atan2(input.aim.x, input.aim.z);
    tickCooldowns(p, dt);
    if (input.interact || input.jump) exitCar(state, p, false);
    return;
  }
  // riding a coaster cart: hang on, E/Space hops off where you are
  if (p.cart) {
    if (input.aim) p.yaw = Math.atan2(input.aim.x, input.aim.z);
    tickCooldowns(p, dt);
    if (input.interact || input.jump) exitCart(state, p);
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
      if (shot && p === state.player) state.stats.shots++;
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
    if (shot && p === state.player) state.stats.shots++;
  }
  if (input.interact &&
      !tryKick(state, p) && !tryGrabLoot(state, p) && !tryPressButton(state, p) &&
      !tryEnterCar(state, p) && !tryBoardCart(state, p)) {
    tryOpenCrate(state, p);
  }
  integrate(p, dt, state);
}

// Player-turned-zombie: guns gone, legs faster, LMB/E bites anyone in
// reach. Still a player — lives and balcony rules unchanged.
function stepZombieHuman(state, p, input, dt) {
  const cfg = CONFIG.zombies;
  p.biteT = Math.max(0, (p.biteT || 0) - dt);
  p.vel.x = input.mx * cfg.speed;
  p.vel.z = input.mz * cfg.speed;
  if (input.jump && p.onGround) {
    p.vel.y = CONFIG.player.jumpSpeed;
    p.onGround = false;
  }
  if (input.aim) p.yaw = Math.atan2(input.aim.x, input.aim.z);
  stepWeapon(p.weapon, dt);
  if (input.fire || input.interact) tryBite(state, p);
  integrate(p, dt, state);
}

function tickCooldowns(p, dt) {
  stepWeapon(p.weapon, dt);              // shared slime cooldown
  if (p.weaponSlots) for (const w of p.weaponSlots) stepWeapon(w, dt);
}

// Soft body blocking: two entities overlapping on the ground plane get
// nudged apart — no stacked zombies or bots clipping through each other.
// Bins are immovable objects; the other guy takes the whole push.
function separateEntities(state) {
  const es = allEntities(state);
  const rr = CONFIG.player.radius * 2 + 0.15;
  for (let i = 0; i < es.length; i++) {
    const a = es[i];
    if (!a.alive || a.onBalcony) continue;
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j];
      if (!b.alive || b.onBalcony) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;   // different floors
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= rr) continue;
      if (d < 1e-4) d = 1e-4;
      const push = (rr - d) / 2;
      const nx = dx / d || 1;
      const nz = dz / d;
      if (!a.binned) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
      if (!b.binned) { b.pos.x += nx * push; b.pos.z += nz * push; }
    }
  }
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
        target: p.id,
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
  for (const b of allEntities(state)) {
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
  for (const e of allEntities(state)) consider(e);
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
  if (state.netRole === 'client') {
    // snapshot-driven entities get their balcony positions from the host —
    // only the local player rides (and redeploys) predictively
    if (state.player.onBalcony) ride(state.player, false);
    return;
  }
  for (const e of allEntities(state)) {
    if (e.onBalcony) ride(e, e.bot);
  }
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
  if (e.pos.y <= floor) {
    e.pos.y = floor;
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
  const floorBase = state.heightAt(e.pos.x, e.pos.z);
  for (const o of state.obstacles) {
    if (e.pos.y >= o.max.y - 0.05) continue;
    if (e.pos.y + CONFIG.player.height <= o.min.y + 0.05) continue;   // fully overhead — a ceiling, not a wall
    if (o.max.y <= floorBase + 0.01) continue;                       // buried under the terrain — not a wall
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
  let floor = state.heightAt(e.pos.x, e.pos.z);
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
  for (const e of allEntities(state)) {
    if (e.alive && !e.binned && !e.onBalcony && e.id !== ownerId) fn(e);
  }
}

function stepProjectiles(state, dt) {
  const cfg = CONFIG.weapon;
  const client = state.netRole === 'client';
  const remaining = [];
  for (const p of state.projectiles) {
    if (p.net) { remaining.push(p); continue; }   // snapshot-driven on clients
    p.la = (p.la || 0) + dt;                      // local age — net merge window
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
      if (!e.bot && !e.engaged) return;
      const c = add(e.pos, { x: 0, y: CONFIG.player.hitCenterY, z: 0 });
      consider(segmentSphere(p.prev, p.pos, c, CONFIG.player.hitRadius + (p.radius ?? cfg.radius)), 'entity', e);
    });
    consider(segmentGround(p.prev, p.pos, 0), 'ground', null);
    for (const o of state.obstacles) {
      consider(segmentAABB(p.prev, p.pos, o.min, o.max), 'obstacle', null);
    }
    // terrain: inside a hollow the visual ground dips below the y=0
    // plane — anything below the relief surface is a dirt hit.
    if (!hit && p.pos.y < state.heightAt(p.pos.x, p.pos.z)) {
      hit = { t: 1, point: copy(p.pos), kind: 'ground', ent: null };
    }

    if (hit) {
      p.pos = copy(hit.point);
      if (hit.kind === 'entity') {
        if (p.type === 'slime') slimeHit(state, hit.ent, p.owner);
        else if (hit.ent.zombie) {
          // zombies don't bin — hits just chew through their HP
          damage(state, hit.ent, 3 * (p.sticks ?? 1), p.owner, p.type);
        }
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
// Pickup physics only — shared between authoritative sim and clients
// (clients animate slices but never decide who ate them).
function stepPickupMotion(state, dt) {
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
  }
  state.pickups = state.pickups.filter((p) => p.ttl > 0);
}

function stepPickups(state, dt) {
  const cfg = CONFIG.toaster;
  stepPickupMotion(state, dt);
  const keep = [];
  for (const p of state.pickups) {
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
          byPlayer: e === state.player,
        });
      }
    });
    if (!eaten) keep.push(p);
  }
  state.pickups = keep;
}

export function damage(state, ent, amount, attackerId, veggie) {
  if (!ent.alive || ent.binned) return;
  if (!ent.bot && !ent.engaged) return;
  // a driver is protected by the vehicle — hits land on the car, the
  // zone is the only thing that still reaches through.
  if (ent.car && attackerId !== 'zone' && attackerId !== 'car') {
    ent.car.hp -= amount;
    if (ent.car.hp <= 0 && !ent.car.dead) {
      ent.car.dead = true;
      ent.car.speed = 0;
      state.events.push({ type: 'carDead', pos: copy(ent.pos) });
      exitCar(state, ent, false);
    }
    return;
  }
  ent.hp -= amount;
  state.events.push({
    type: 'hit',
    pos: add(ent.pos, { x: 0, y: 1.2, z: 0 }),
    target: ent.id,
    veggie: veggie || null,
    byPlayer: attackerId === state.player.id,
  });
  if (ent.hp <= 0) {
    ent.hp = 0;
    if (attackerId === state.player.id) state.stats.kills++;
    state.events.push({ type: 'kill', victim: ent.id, attacker: attackerId, name: ent.name, veggie: veggie || null });
    killEntity(state, ent);
  }
}

function stepZone(state, dt) {
  const z = CONFIG.zone;
  const zi = state.zone;
  zi.t += dt;
  zi.moving = false;
  zi.waitLeft = 0;
  // PUBG-style schedule: hold each phase's wait, then lerp the radius
  // down to its target over dur seconds.
  while (zi.phase < z.phases.length) {
    const p = z.phases[zi.phase];
    zi.dps = p.dps;
    if (zi.t <= p.wait) { zi.waitLeft = p.wait - zi.t; break; }
    const k = (zi.t - p.wait) / p.dur;
    if (k < 1) {
      zi.radius = lerp(zi.phaseR, p.to, k);
      zi.moving = true;
      break;
    }
    zi.phase++;
    zi.t = 0;
    zi.phaseR = p.to;
    zi.radius = p.to;
  }
  const center = { x: state.zone.cx, y: 0, z: state.zone.cz };
  const burn = (e) => {
    if (!e.alive || e.binned || e.onBalcony) return;
    if (!e.bot && !e.engaged) return;
    if (distXZ(e.pos, center) > state.zone.radius) {
      damage(state, e, state.zone.dps * dt, 'zone');
    }
  };
  for (const e of allEntities(state)) burn(e);
}

function checkPhase(state) {
  let next = null;
  if (!state.player.alive) next = 'lost';
  // zombies don't count as surviving opponents — kill or convert everyone
  else if (allEntities(state).every((e) => e === state.player || !e.alive || e.zombie)) next = 'won';
  if (next) {
    state.phase = next;
    state.events.push({ type: 'phase', phase: next });
  }
}
