// Infection mode (test): a hatch in the map centre and a red button on
// the field. Players press the button, the hatch bursts open and a wave
// of zombies hops out. One bite converts you — you keep your body and
// your lives but hunt your former friends. Death cures (balcony as usual).
// Pure logic — plain state only.
import { CONFIG } from './config.js';
import { v3, copy, distXZ } from './vec3.js';
import { rand } from './rng.js';

const everyone = (state) => state.humans.concat(state.bots, state.zombies);

export function makeInfection(state) {
  state.zombies = [];
  state.nextZombieId = 0;
  state.hatch = { pos: v3(CONFIG.zombies.hatchPos.x, 0, CONFIG.zombies.hatchPos.z), open: false, spawned: 0, spawnT: 0 };
  state.button = {
    pos: v3(CONFIG.zombies.buttonPos.x, 0, CONFIG.zombies.buttonPos.z),
    pressed: false,
    presses: 0,
  };
}

function makeZombie(state, i) {
  const a = rand(state) * Math.PI * 2;
  return {
    id: 'z' + i,
    bot: true,                 // valid target for everyone's AI
    zombie: true,
    name: 'Зомби',
    pos: v3(
      state.hatch.pos.x + Math.cos(a) * 0.9,
      state.hatch.pos.y + 0.6,
      state.hatch.pos.z + Math.sin(a) * 0.9),
    vel: v3(Math.cos(a) * 2.2, CONFIG.zombies.hopOut, Math.sin(a) * 2.2),
    yaw: a,
    hp: CONFIG.zombies.hp,
    alive: true,
    chute: false,
    binned: false,
    binKind: null,
    binFlyT: 0,
    vegCount: 0,
    vegStuck: [],
    lives: 0,                  // monsters, not players — dead is dead
    onBalcony: false,
    slimedTimer: 0,
    mounted: null,
    onGround: false,
    engaged: true,
    guns: [false, false],
    slot: 0,
    biteT: 0,
    lastX: 0,
    lastZ: 0,
    stuckT: 0,
  };
}

// Button pressed (players only — bots can't reach the big red lever):
// hatch opens and the next wave starts climbing out.
export function tryPressButton(state, ent) {
  if (ent.bot || ent.zombie) return false;
  const b = state.button;
  if (distXZ(ent.pos, b.pos) > CONFIG.zombies.pressRange) return false;
  b.pressed = true;
  b.presses++;
  state.hatch.open = true;
  state.hatch.spawned = 0;      // every press = a fresh wave
  state.hatch.spawnT = 0.4;
  state.events.push({
    type: 'button', target: ent.id, name: ent.name,
    pos: copy(b.pos), byPlayer: ent === state.player,
  });
  return true;
}

// Wave spawner — zombies burst out one at a time.
export function stepHatch(state, dt) {
  const h = state.hatch;
  if (!h.open || h.spawned >= CONFIG.zombies.waveSize) return;
  h.spawnT -= dt;
  if (h.spawnT > 0) return;
  h.spawnT = CONFIG.zombies.spawnGap;
  const z = makeZombie(state, state.nextZombieId++);
  state.zombies.push(z);
  h.spawned++;
  state.events.push({ type: 'zombieOut', pos: copy(h.pos) });
}

// The bite: victim keeps its body but becomes a monster. Guns drop.
export function infect(state, e, byEnt) {
  if (!e.alive || e.zombie || e.binned || e.onBalcony) return false;
  e.zombie = true;
  e.guns = [false, false];
  e.mounted = null;
  e.hp = CONFIG.zombies.hp;
  e.biteT = 0;
  if (e.ai) { e.ai.detour = null; e.ai.lootT = 0; }
  state.events.push({
    type: 'infected', target: e.id, name: e.name,
    by: byEnt ? byEnt.id : null,
    byPlayer: e === state.player || byEnt === state.player,
  });
  return true;
}

const nearestPrey = (z, state) => {
  let prey = null, bd = Infinity;
  for (const e of everyone(state)) {
    if (e === z || !e.alive || e.zombie || e.binned || e.onBalcony) continue;
    // can't bite what's in the air — parachuters and flying bins don't count
    if (e.chute || (e.binFlyT || 0) > 0 || Math.abs(e.pos.y - z.pos.y) > 3) continue;
    const d = distXZ(z.pos, e.pos);
    if (d < bd) { bd = d; prey = e; }
  }
  return { prey, bd };
};

// Shared zombie AI — wave zombies and infected bots run the same brain:
// chase the closest living non-zombie, bite in reach, hop what blocks you.
export function stepZombie(z, state, dt) {
  const cfg = CONFIG.zombies;
  z.biteT = Math.max(0, (z.biteT || 0) - dt);
  const { prey, bd } = nearestPrey(z, state);
  if (!prey) { z.vel.x = 0; z.vel.z = 0; return; }
  z.yaw = Math.atan2(prey.pos.x - z.pos.x, prey.pos.z - z.pos.z);
  if (bd <= cfg.biteRange && Math.abs(prey.pos.y - z.pos.y) < 1.8) {
    z.vel.x = 0;
    z.vel.z = 0;
    if (z.biteT <= 0) {
      z.biteT = cfg.biteCooldown;
      infect(state, prey, z);
    }
    return;
  }
  z.vel.x = ((prey.pos.x - z.pos.x) / bd) * cfg.speed;
  z.vel.z = ((prey.pos.z - z.pos.z) / bd) * cfg.speed;
  const moved = distXZ(z.pos, { x: z.lastX ?? z.pos.x, z: z.lastZ ?? z.pos.z });
  z.lastX = z.pos.x;
  z.lastZ = z.pos.z;
  z.stuckT = moved < cfg.speed * dt * 0.3 ? (z.stuckT || 0) + dt : 0;
  if (z.stuckT > 0.5 && z.onGround) {
    z.vel.y = CONFIG.player.jumpSpeed;
    z.onGround = false;
    z.stuckT = 0;
  }
}

// Player-zombie bite: LMB or E in reach converts the victim.
export function tryBite(state, z) {
  const cfg = CONFIG.zombies;
  if ((z.biteT || 0) > 0) return false;
  for (const e of everyone(state)) {
    if (e === z || !e.alive || e.zombie || e.binned || e.onBalcony) continue;
    if (distXZ(z.pos, e.pos) <= cfg.biteRange && Math.abs(e.pos.y - z.pos.y) < 1.8) {
      z.biteT = cfg.biteCooldown;
      infect(state, e, z);
      return true;
    }
  }
  return false;
}
