// Weapon crates: everyone drops unarmed, guns come from loot boxes.
// Pure logic — plain state only.
import { CONFIG } from './config.js';
import { distXZ, copy } from './vec3.js';
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

// E on a crate: lid pops, the gun inside joins the inventory — or a
// small heal when you already carry that model.
export function openCrate(state, ent, crate) {
  if (crate.opened) return false;
  crate.opened = true;
  const slot = crate.loot;
  let healed = 0;
  if (ent.guns[slot]) {
    const max = ent.bot ? CONFIG.bots.maxHp : CONFIG.player.maxHp;
    healed = Math.max(0, Math.min(CONFIG.loot.consolationHp, max - ent.hp));
    ent.hp += healed;
  } else {
    ent.guns[slot] = true;
    ent.slot = slot;
  }
  state.events.push({
    type: 'loot', ent: ent.id, crate: crate.id, slot,
    healed, name: ent.name, pos: copy(crate.pos),
    byPlayer: ent === state.player,
  });
  return true;
}

export function tryOpenCrate(state, ent) {
  const c = nearestCrate(state, ent, CONFIG.loot.openRange);
  if (c) openCrate(state, ent, c);
  return c;
}
