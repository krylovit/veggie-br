// Veggie-bin mechanic: enough stuck veggies turns a victim into a bin.
// A kick scores the real kill; otherwise the victim pops back out at
// half HP after bin.duration seconds. Pure logic — plain state only.
import { CONFIG } from './config.js';
import { v3, copy, add, norm, distXZ } from './vec3.js';
import { rand } from './rng.js';

// A projectile hit: stick it on and maybe transform. `weight` is how
// many bin points the piece counts (junk hits harder than veggies).
export function stickVeggie(state, ent, veggie, attackerId, weight = 1) {
  ent.vegCount += weight;
  for (let i = 0; i < weight && ent.vegStuck.length < CONFIG.bin.hits; i++) {
    ent.vegStuck.push(veggie);
  }
  ent.hp -= weight * CONFIG.bin.hitDmg;
  state.events.push({
    type: 'hit',
    pos: add(ent.pos, { x: 0, y: 1.2, z: 0 }),
    target: ent.id,
    veggie,
    vegCount: ent.vegCount,
    byPlayer: attackerId === state.player.id,
  });
  if (attackerId === state.player.id) state.stats.damageDealt++;
  if (ent.hp <= 0) {
    ent.hp = 0;
    if (attackerId === state.player.id) state.stats.kills++;
    state.events.push({ type: 'kill', victim: ent.id, attacker: attackerId, name: ent.name, veggie });
    killEntity(state, ent);
    return;
  }
  if (ent.vegCount >= CONFIG.bin.hits) {
    const kind = CONFIG.junk.order.includes(veggie) ? 'toast' : 'veg';
    transformToBin(state, ent, attackerId, kind);
  }
}

function transformToBin(state, ent, attackerId, kind) {
  ent.binned = true;
  ent.binKind = kind;                 // 'veg' bin | 'toast' toaster
  ent.binTimer = CONFIG.bin.duration;
  ent.chute = false;                  // bin plummets, no parachute
  ent.vel = v3();                     // gravity may still settle the bin
  state.events.push({
    type: 'binned', target: ent.id, name: ent.name, kind,
    pos: copy(ent.pos), byPlayer: attackerId === state.player.id,
  });
}

// Run each tick while the entity is a bin. Revives at half HP.
export function tickBin(state, ent, dt) {
  ent.binTimer -= dt;
  if (ent.binTimer > 0) return;
  ent.binned = false;
  ent.binKind = null;
  ent.vegCount = 0;
  ent.vegStuck = [];
  const max = ent.bot ? CONFIG.bots.maxHp : CONFIG.player.maxHp;
  ent.hp = max * CONFIG.bin.reviveHp;
  state.events.push({ type: 'revived', target: ent.id, name: ent.name, pos: copy(ent.pos) });
}

// Nearest bin within `range` of `from`, or null.
export function nearestBin(state, from, range) {
  let best = null;
  let bd = range;
  const consider = (e) => {
    if (!e.binned || e.binFlyT > 0 || e === from) return;
    const d = distXZ(from.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  };
  for (const e of state.humans) consider(e);
  for (const b of state.bots) consider(b);
  return best;
}

// Kick attempt: find a bin in range and launch it — the victim dies.
export function tryKick(state, kicker) {
  const bin = nearestBin(state, kicker, CONFIG.bin.kickRange);
  if (bin) kickBin(state, kicker, bin);
  return bin;
}

export function kickBin(state, kicker, binEnt) {
  if (kicker === state.player) state.stats.kills++;
  const dir = norm({ x: binEnt.pos.x - kicker.pos.x, y: 0, z: binEnt.pos.z - kicker.pos.z });
  const d = Math.hypot(dir.x, dir.z) < 1e-4 ? { x: 1, y: 0, z: 0 } : dir;
  state.events.push({
    type: 'binKicked', victim: binEnt.id, name: binEnt.name,
    attacker: kicker.id, pos: copy(binEnt.pos), dir: d,
    kind: binEnt.binKind || 'veg',
    byPlayer: kicker === state.player,
  });
  if (binEnt.binKind === 'toast') spawnToasts(state, binEnt.pos);
  // the kicked bin really flies: victim rides it (first-person shows the
  // tumble), then killEntity fires — balcony if lives remain, else out
  binEnt.binFlyT = CONFIG.bin.flyTime;
  binEnt.binFlySpin = 0;
  binEnt.binFlyDir = d;
  binEnt.vel = {
    x: d.x * CONFIG.bin.flySpeed,
    y: CONFIG.bin.flyUp,
    z: d.z * CONFIG.bin.flySpeed,
  };
}

// A kicked toaster pops healing toast slices — free HP for anyone fast
// enough to grab them (kicker, victim's pals, whoever).
function spawnToasts(state, pos) {
  const cfg = CONFIG.toaster;
  for (let i = 0; i < cfg.count; i++) {
    const a = rand(state) * Math.PI * 2;
    const r = cfg.popSide * (0.5 + rand(state) * 0.5);
    state.pickups.push({
      id: state.nextId++,
      type: 'toast',
      pos: { x: pos.x, y: pos.y + 1.2, z: pos.z },
      vel: { x: Math.cos(a) * r, y: cfg.popUp * (0.7 + rand(state) * 0.5), z: Math.sin(a) * r },
      ttl: cfg.ttl,
    });
  }
}

// Death with lives: a life is spent; while lives remain the entity waits
// on the balcony ring and re-drops, otherwise it is really gone.
export function killEntity(state, ent) {
  ent.lives--;
  ent.binned = false;
  ent.binKind = null;
  ent.binTimer = 0;
  ent.binFlyT = 0;
  ent.binFlySpin = 0;
  ent.chute = false;
  ent.slimedTimer = 0;
  ent.mounted = null;
  ent.vegCount = 0;
  ent.vegStuck = [];
  ent.zombie = false;      // death cures the infection — redeploy human again
  ent.biteT = 0;
  if (ent.lives <= 0) {
    ent.alive = false;
    ent.onBalcony = false;
    return;
  }
  ent.hp = ent.bot ? CONFIG.bots.maxHp : CONFIG.player.maxHp;
  ent.onBalcony = true;
  ent.balconyTimer = CONFIG.balcony.time;
  // least-occupied platform wins — pure rand kept stacking the crowd
  // onto one arc while the others sat empty
  const counts = new Array(CONFIG.balcony.platforms).fill(0);
  for (const e of state.humans.concat(state.bots)) {
    if (e !== ent && e.onBalcony) counts[e.balconyP]++;
  }
  ent.balconyP = counts.indexOf(Math.min(...counts));
  ent.balconyA = 0.04 + rand(state) * (CONFIG.balcony.span - 0.08);
  ent.balconyR = -(0.8 + rand(state) * (CONFIG.balcony.width - 1.4));
  ent.vel = v3();
  state.events.push({ type: 'toBalcony', target: ent.id, name: ent.name, lives: ent.lives });
}

// Balcony timer expired: drop back in under the chute.
export function redeploy(state, ent) {
  const a = rand(state) * Math.PI * 2;
  const r = rand(state) * Math.max(4, state.zone.radius * 0.55);
  ent.pos.x = state.zone.cx + Math.cos(a) * r;
  ent.pos.z = state.zone.cz + Math.sin(a) * r;
  ent.pos.y = Math.max(CONFIG.drop.height, CONFIG.balcony.height + 8);
  ent.vel = v3();
  ent.onBalcony = false;
  ent.mounted = null;      // left the cannon — drop the scope
  ent.chute = true;
  ent.chutePhase = rand(state) * Math.PI * 2;
  ent.onGround = false;
  if (ent.ai) {
    ent.ai.think = 0;
    ent.ai.fireAt = 1 + rand(state) * 2;
  }
  state.events.push({ type: 'redeploy', target: ent.id, name: ent.name, pos: copy(ent.pos) });
}

// Slime cannon hit: the victim is glued in place for a while.
export function slimeHit(state, ent, attackerId) {
  ent.slimedTimer = CONFIG.slime.pinTime;
  state.events.push({
    type: 'slimed', target: ent.id, name: ent.name,
    pos: add(ent.pos, { x: 0, y: 1, z: 0 }),
    byPlayer: attackerId === state.player.id,
  });
}
