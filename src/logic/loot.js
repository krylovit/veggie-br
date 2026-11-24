// Weapon crates: everyone drops unarmed, guns come from loot boxes.
// Pure logic — plain state only.
import { CONFIG } from './config.js';
import { distXZ, copy, v3 } from './vec3.js';
import { rand } from './rng.js';

export function spawnCrates(state) {
  const cfg = CONFIG.loot;
  const half = CONFIG.world.size / 2;
  const crates = [];
  // a crate buried inside a wall can never be looted — demand clearance
  const blocked = (x, z) =>
    state.obstacles.some(
      (o) => x > o.min.x - 2 && x < o.max.x + 2 && z > o.min.z - 2 && z < o.max.z + 2
    );
  for (let i = 0; i < cfg.crates; i++) {
    let pos = null;
    for (let tries = 0; tries < 14; tries++) {
      const a = rand(state) * Math.PI * 2;
      const r = 10 + rand(state) * (half - 25);
      const x = state.zone.cx + Math.cos(a) * r;
      const z = state.zone.cz + Math.sin(a) * r;
      if (!blocked(x, z)) { pos = { x, y: 0, z }; break; }
    }
    if (!pos) continue;
    crates.push({
      id: 'crate' + i,
      pos,
      yaw: rand(state) * Math.PI * 2,
      loot: rand(state) < cfg.vegOdds ? 0 : 1,   // which gun is inside
      opened: false,
    });
  }
  return crates;
}

export function nearestCrate(state, ent, range) {
  let best = null, bd = range;
  for (const c of state.crates) {
    if (c.opened) continue;
    const d = distXZ(ent.pos, c.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// E on a crate: the lid pops and the gun inside bursts out — it hangs
// in a bubble above the box until somebody grabs it (another E).
export function openCrate(state, ent, crate) {
  if (crate.opened) return false;
  crate.opened = true;
  state.lootPops.push({
    id: 'pop_' + crate.id,
    pos: v3(crate.pos.x, crate.pos.y + 1.15, crate.pos.z),
    slot: crate.loot,
    age: 0,
  });
  state.events.push({
    type: 'crateOpen', crate: crate.id, name: ent?.name,
    pos: copy(crate.pos), byPlayer: ent === state.player,
  });
  return true;
}

export function tryOpenCrate(state, ent) {
  if (ent.chute || ent.binned || ent.zombie || ent.binFlyT > 0) return null;   // mid-air / monster E does nothing
  const c = nearestCrate(state, ent, CONFIG.loot.openRange);
  if (c) openCrate(state, ent, c);
  return c;
}

export function nearestPop(state, ent, range) {
  let best = null, bd = range;
  for (const p of state.lootPops) {
    const d = distXZ(ent.pos, p.pos);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Grabbing a floating gun: joins the inventory — or a small heal when
// you already carry that model.
export function grabLoot(state, ent, pop) {
  const slot = pop.slot;
  let healed = 0;
  if (ent.guns[slot]) {
    const max = ent.bot ? CONFIG.bots.maxHp : CONFIG.player.maxHp;
    healed = Math.max(0, Math.min(CONFIG.loot.consolationHp, max - ent.hp));
    ent.hp += healed;
  } else {
    ent.guns[slot] = true;
    ent.slot = slot;
  }
  state.lootPops = state.lootPops.filter((p) => p !== pop);
  state.events.push({
    type: 'loot', ent: ent.id, slot, healed, name: ent.name,
    pos: copy(pop.pos), byPlayer: ent === state.player,
  });
  return true;
}

export function tryGrabLoot(state, ent) {
  if (ent.chute || ent.binned || ent.zombie || ent.binFlyT > 0) return null;
  const p = nearestPop(state, ent, CONFIG.loot.openRange);
  if (p) grabLoot(state, ent, p);
  return p;
}
