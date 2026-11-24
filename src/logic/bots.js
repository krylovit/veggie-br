// Simple bot AI: wander to a point inside the zone, shoot the nearest
// living enemy with tomatoes when in range. Pure logic — no engine types.
import { CONFIG } from './config.js';
import { v3, add, sub, norm, distXZ } from './vec3.js';
import { rand, randRange } from './rng.js';
import { makeWeapon, stepWeapon, fire } from './weapon.js';
import { nearestBin, kickBin } from './bin.js';
import { nearestCrate, openCrate } from './loot.js';

export function makeBots(state, count) {
  const bots = [];
  const n = count ?? CONFIG.bots.count;
  const inObstacle = (x, z) =>
    state.obstacles.some(
      (o) => x > o.min.x - 1 && x < o.max.x + 1 && z > o.min.z - 1 && z < o.max.z + 1
    );
  for (let i = 0; i < n; i++) {
    let bx = 0, bz = 0;
    for (let tries = 0; tries < 8; tries++) {
      const ang = (i / n) * Math.PI * 2 + rand(state) * 0.6;
      const r = 26 + rand(state) * 60;
      bx = Math.cos(ang) * r;
      bz = Math.sin(ang) * r;
      if (!inObstacle(bx, bz)) break;
    }
    const bot = {
      id: 'bot' + i,
      bot: true,
      name: 'Бот ' + (i + 1),
      pos: v3(bx, CONFIG.drop.height + rand(state) * 8, bz),
      vel: v3(),
      yaw: 0,
      hp: CONFIG.bots.maxHp,
      alive: true,
      chute: true,
      chutePhase: rand(state) * Math.PI * 2,
      binned: false,
      binKind: null,
      binTimer: 0,
      binFlyT: 0,
      binFlySpin: 0,
      vegCount: 0,
      vegStuck: [],
      lives: CONFIG.lives,
      onBalcony: false,
      balconyTimer: 0,
      balconyA: 0,
      balconyR: -2,
      slimedTimer: 0,
      mounted: null,
      onGround: false,
      weapon: makeWeapon(),                       // shared slime cooldown
      weaponSlots: [makeWeapon(), makeWeapon()],  // [0] veggie, [1] junk
      guns: [false, false],                       // lands unarmed, loots crates
      slot: 0,
      ai: {
        tx: 0, tz: 0, think: 0, fireAt: rand(state) * 2,
        strafe: 1, strafeT: 0, stuckT: 0, lastX: 0, lastZ: 0,
        detour: null,   // wall between me and the crate? sidestep here first
        lootT: 0,       // time spent prying the current crate open
      },
    };
    pickWanderTarget(bot, state);
    bots.push(bot);
  }
  return bots;
}

function pickWanderTarget(bot, state) {
  // try a few points so the target isn't buried inside a crate
  for (let tries = 0; tries < 4; tries++) {
    const a = rand(state) * Math.PI * 2;
    const r = rand(state) * Math.max(4, state.zone.radius * 0.8);
    const tx = state.zone.cx + Math.cos(a) * r;
    const tz = state.zone.cz + Math.sin(a) * r;
    const inside = state.obstacles.some(
      (o) => tx > o.min.x - 0.5 && tx < o.max.x + 0.5 && tz > o.min.z - 0.5 && tz < o.max.z + 0.5
    );
    if (!inside || tries === 3) {
      bot.ai.tx = tx;
      bot.ai.tz = tz;
      break;
    }
  }
  bot.ai.think = randRange(state, CONFIG.bots.thinkInterval[0], CONFIG.bots.thinkInterval[1]);
}

function nearestEnemy(bot, state) {
  let best = null;
  let bd = Infinity;
  const consider = (e) => {
    if (!e.alive || e.binned || e.onBalcony || e === bot) return;
    if (!e.bot && !e.engaged) return;
    const d = distXZ(bot.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  };
  for (const b of state.humans) consider(b);
  for (const b of state.bots) consider(b);
  return bd < CONFIG.bots.aggroRange * 1.5 ? best : null;
}

function aimAt(bot, target, state) {
  const muzzle = add(bot.pos, { x: 0, y: CONFIG.weapon.muzzleY, z: 0 });
  // lead the target: predict where it will be when the veggie arrives,
  // and lift the arc for the projectile drop over that flight time
  const dist = Math.hypot(target.pos.x - muzzle.x, target.pos.z - muzzle.z);
  const t = dist / CONFIG.weapon.speed;
  const chest = {
    x: target.pos.x + (target.vel?.x || 0) * t,
    y: target.pos.y + 1.1 + 0.5 * CONFIG.weapon.gravity * t * t,
    z: target.pos.z + (target.vel?.z || 0) * t,
  };
  const dir = norm(sub(chest, muzzle));
  const s = CONFIG.bots.aimSpread;
  return norm({
    x: dir.x + (rand(state) * 2 - 1) * s,
    y: dir.y + (rand(state) * 2 - 1) * s * 0.5,
    z: dir.z + (rand(state) * 2 - 1) * s,
  });
}

// Settled toast slice within `range`, or null. Wounded bots detour to
// grab one — free HP lying around shouldn't go to waste.
function nearestPickup(bot, state, range) {
  let best = null;
  let bd = range;
  for (const p of state.pickups) {
    if (p.vel.x || p.vel.y || p.vel.z) continue;   // still popping through the air
    const d = distXZ(bot.pos, p.pos);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function stepBot(bot, state, dt) {
  if (!bot.alive || bot.binned || bot.onBalcony) return;
  const cfg = CONFIG.bots;
  const zoneCenter = { x: state.zone.cx, y: 0, z: state.zone.cz };

  // A bin nearby is a free kill: waddle over and boot it.
  const bin = nearestBin(state, bot, CONFIG.bin.botSeekRange);
  if (bin) {
    const bd = distXZ(bot.pos, bin.pos);
    if (bd <= CONFIG.bin.kickRange) {
      kickBin(state, bot, bin);
      bot.vel.x = 0;
      bot.vel.z = 0;
      return;
    }
    const dx = bin.pos.x - bot.pos.x;
    const dz = bin.pos.z - bot.pos.z;
    bot.vel.x = (dx / bd) * cfg.walkSpeed;
    bot.vel.z = (dz / bd) * cfg.walkSpeed;
    bot.yaw = Math.atan2(dx, dz);
    return;
  }

  bot.ai.think -= dt;
  if (bot.ai.think <= 0) pickWanderTarget(bot, state);
  for (const w of bot.weaponSlots) stepWeapon(w, dt);

  let want = null;
  // wounded? smell toast — heal before fighting on empty HP
  if (bot.hp < cfg.maxHp * cfg.toastHp) {
    const t = nearestPickup(bot, state, cfg.toastRange);
    if (t) want = { x: t.pos.x, z: t.pos.z };
  }

  // combat: face the enemy, fire, and dance — hold a range band and
  // strafe sideways instead of standing still
  bot.ai.fireAt -= dt;
  const target = nearestEnemy(bot, state);
  let engaged = false;
  if (target) {
    const dd = distXZ(bot.pos, target.pos);
    engaged = dd < cfg.aggroRange;
    bot.yaw = Math.atan2(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    // pick an OWNED gun: junk shotgun up close, veggie launcher else
    if (bot.guns[1] && dd < cfg.junkRange) bot.slot = 1;
    else if (bot.guns[0]) bot.slot = 0;
    else if (bot.guns[1]) bot.slot = 1;
    if (bot.ai.fireAt <= 0 && dd < cfg.fireRange) {
      fire(state, bot, aimAt(bot, target, state));
      bot.ai.fireAt = randRange(state, cfg.fireInterval[0], cfg.fireInterval[1]);
    }
    if (!want) {
      if (dd > cfg.engageFar) {
        // target in sight but too far — charge it, don't wait for luck
        want = { x: target.pos.x, z: target.pos.z };
      } else if (engaged) {
        bot.ai.strafeT -= dt;
        if (bot.ai.strafeT <= 0) {
          bot.ai.strafe = -bot.ai.strafe;
          bot.ai.strafeT = 1.0 + rand(state) * 1.6;
        }
        const nx = (target.pos.x - bot.pos.x) / (dd || 1);
        const nz = (target.pos.z - bot.pos.z) / (dd || 1);
        let mx = -nz * bot.ai.strafe;   // tangent: circle the enemy
        let mz = nx * bot.ai.strafe;
        if (dd < cfg.engageNear) { mx -= nx * 1.4; mz -= nz * 1.4; }
        const ml = Math.hypot(mx, mz) || 1;
        want = { x: bot.pos.x + (mx / ml) * 5, z: bot.pos.z + (mz / ml) * 5 };
      }
    }
  }

  // unarmed and landed? forget the fight — run for the nearest crate
  // and loot it. Opening takes a moment: stand at the lid and pry.
  if (!bot.guns[0] && !bot.guns[1] && bot.onGround && !bot.chute) {
    const c = nearestCrate(state, bot, CONFIG.loot.botLootRange);
    if (c) {
      if (distXZ(bot.pos, c.pos) <= CONFIG.loot.openRange) {
        bot.ai.lootT += dt;
        want = { x: bot.pos.x, z: bot.pos.z };   // hold position
        if (bot.ai.lootT >= CONFIG.loot.botLootTime) {
          bot.ai.lootT = 0;
          bot.ai.detour = null;
          openCrate(state, bot, c);
        }
      } else {
        bot.ai.lootT = 0;
        const d = bot.ai.detour;
        if (d && distXZ(bot.pos, d) <= 1.6) bot.ai.detour = null;
        want = bot.ai.detour || { x: c.pos.x, z: c.pos.z };
      }
    } else {
      bot.ai.lootT = 0;
    }
  } else {
    bot.ai.detour = null;
    bot.ai.lootT = 0;
  }

  // the shrinking wall outranks everything — leg it back inside
  if (distXZ(bot.pos, zoneCenter) > state.zone.radius * 0.85) {
    want = { x: zoneCenter.x, z: zoneCenter.z };
  }
  if (!want) {
    const to = { x: bot.ai.tx - bot.pos.x, z: bot.ai.tz - bot.pos.z };
    if (Math.hypot(to.x, to.z) > 1.2) want = { x: bot.ai.tx, z: bot.ai.tz };
  }

  if (want) {
    const dx = want.x - bot.pos.x;
    const dz = want.z - bot.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    bot.vel.x = (dx / d) * cfg.walkSpeed;
    bot.vel.z = (dz / d) * cfg.walkSpeed;
    if (!engaged) bot.yaw = Math.atan2(dx, dz);
  } else {
    bot.vel.x = 0;
    bot.vel.z = 0;
  }

  // unstick: wanted to move but barely did — hop the block in the way,
  // or give up and pick a fresh route
  const moved = distXZ(bot.pos, { x: bot.ai.lastX, z: bot.ai.lastZ });
  bot.ai.lastX = bot.pos.x;
  bot.ai.lastZ = bot.pos.z;
  if (want && bot.ai.lootT <= 0 && moved < cfg.walkSpeed * dt * 0.3) {
    bot.ai.stuckT += dt;
    if (bot.ai.stuckT > 0.4 && bot.onGround) {
      bot.vel.y = CONFIG.player.jumpSpeed;
      bot.onGround = false;
    }
    if (bot.ai.stuckT > 1.2) {
      if (!bot.guns[0] && !bot.guns[1] && want && !bot.ai.detour) {
        // wall between me and the crate — sidestep to a detour point
        const px = -(want.z - bot.pos.z);
        const pz = want.x - bot.pos.x;
        const pl = Math.hypot(px, pz) || 1;
        const side = rand(state) < 0.5 ? 1 : -1;
        const off = 6 + rand(state) * 10;
        bot.ai.detour = {
          x: (bot.pos.x + want.x) / 2 + (px / pl) * off * side,
          z: (bot.pos.z + want.z) / 2 + (pz / pl) * off * side,
        };
      } else {
        bot.ai.detour = null;
        pickWanderTarget(bot, state);
        bot.ai.strafe = -bot.ai.strafe;
      }
      bot.ai.stuckT = 0;
    }
  } else {
    bot.ai.stuckT = 0;
  }
}
