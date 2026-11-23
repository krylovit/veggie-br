// Овощемёт — VeggieLauncher. Fires a random visible vegetable each shot;
// all veggies share the same damage/speed — the type is purely cosmetic.
import { CONFIG } from './config.js';
import { add, scale, norm, copy } from './vec3.js';
import { rand } from './rng.js';

export function makeWeapon() {
  return { cooldown: 0 };
}

export function stepWeapon(weapon, dt) {
  if (weapon.cooldown > 0) weapon.cooldown -= dt;
}

// Spawn a projectile for shooter (entity with pos/id/weapon). Slot 0 is
// the veggie launcher, slot 1 the junk launcher — same stick→bin rules.
// Returns the projectile or null while cooling down / under the chute.
export function fire(state, shooter, aimDir) {
  const slot = shooter.slot || 0;
  const w = shooter.weaponSlots ? shooter.weaponSlots[slot] : shooter.weapon;
  if (w.cooldown > 0 || shooter.chute) return null;
  const cfg = slot === 1 ? CONFIG.junk : CONFIG.weapon;
  const dir = norm(aimDir);
  // muzzle sits bottom-right of the eye line — spawn offset so shots
  // visibly leave the barrel (parallel to aim, tiny constant offset)
  const h = Math.hypot(dir.x, dir.z) || 1;
  const right = { x: dir.z / h, y: 0, z: -dir.x / h };
  const up = { x: -dir.x * dir.y / h, y: h, z: -dir.z * dir.y / h };
  const eye = add(shooter.pos, { x: 0, y: cfg.muzzleY, z: 0 });
  const origin = add(
    add(eye, scale(dir, cfg.muzzleFwd)),
    { x: right.x * 0.3, y: -0.22, z: right.z * 0.3 }
  );
  w.cooldown = shooter.bot ? CONFIG.bots.fireCooldown : cfg.cooldown;

  // Ammo per shot: slot 0 — one random veggie; slot 1 — a full set,
  // one piece of each junk type fanned out like a shotgun blast.
  const types = cfg.pellets
    ? cfg.order.slice()
    : [cfg.order[Math.floor(rand(state) * cfg.order.length)]];
  const shots = [];
  types.forEach((ammoKey, i) => {
    let d = dir;
    if (cfg.pellets) {   // shotgun scatter: jitter inside a cone
      const a = (i / types.length) * Math.PI * 2 + rand(state) * 0.8;
      const r = cfg.spread * (0.5 + rand(state) * 0.5);
      d = norm(add(dir, add(scale(right, Math.cos(a) * r), scale(up, Math.sin(a) * r))));
    }
    const p = {
      id: state.nextId++,
      type: ammoKey,
      owner: shooter.id,
      pos: copy(origin),
      prev: copy(origin),
      vel: scale(d, cfg.speed),
      ttl: cfg.ttl,
      gravity: cfg.gravity,
      radius: cfg.radius,
      sticks: cfg.sticks || 1,
    };
    state.projectiles.push(p);
    shots.push(p);
  });
  state.events.push({ type: 'fire', pos: copy(origin), dir: copy(dir), veggie: types[0], owner: shooter.id });
  return shots[0];
}

// Balcony sniper cannon: launches a slime blob that pins the victim
// where it lands for slime.pinTime seconds.
export function fireSlime(state, shooter, aimDir, muzzlePos) {
  const w = shooter.weapon;
  if (w.cooldown > 0) return null;
  const cfg = CONFIG.slime;
  const dir = norm(aimDir);
  const origin = muzzlePos
    ? copy(muzzlePos)
    : add(
        add(shooter.pos, { x: 0, y: CONFIG.weapon.muzzleY, z: 0 }),
        scale(dir, 1.2)
      );
  w.cooldown = cfg.cooldown;
  const p = {
    id: state.nextId++,
    type: 'slime',
    owner: shooter.id,
    pos: copy(origin),
    prev: copy(origin),
    vel: scale(dir, cfg.speed),
    ttl: cfg.ttl,
    gravity: cfg.gravity,
    radius: cfg.radius,
  };
  state.projectiles.push(p);
  state.events.push({ type: 'fire', pos: copy(origin), dir: copy(dir), veggie: 'slime', owner: shooter.id });
  return p;
}
