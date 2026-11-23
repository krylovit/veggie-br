// Simple bot AI: wander to a point inside the zone, shoot the nearest
// living enemy with tomatoes when in range. Pure logic — no engine types.
import { CONFIG } from './config.js';
import { v3, add, sub, norm, distXZ } from './vec3.js';
import { rand, randRange } from './rng.js';
import { makeWeapon, fire } from './weapon.js';
import { nearestBin, kickBin } from './bin.js';

export function makeBots(state) {
  const bots = [];
  const n = CONFIG.bots.count;
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
      weapon: makeWeapon(),
      ai: {
        tx: 0, tz: 0, think: 0, fireAt: rand(state) * 2,
        strafe: 1, strafeT: 0, stuckT: 0, lastX: 0, lastZ: 0,
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
    if (e.id === 'player' && !state.playerEngaged) return;
    const d = distXZ(bot.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  };
  consider(state.player);
  for (const b of state.bots) consider(b);
  return bd < CONFIG.bots.aggroRange * 1.5 ? best : null;
}

function aimAt(bot, target, state) {
  const muzzle = add(bot.pos, { x: 0, y: CONFIG.weapon.muzzleY, z: 0 });
  const chest = add(target.pos, { x: 0, y: 1.1, z: 0 });
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
    if (dd < cfg.aggroRange) {
      engaged = true;
      bot.yaw = Math.atan2(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
      if (bot.ai.fireAt <= 0 && dd < cfg.fireRange) {
        fire(state, bot, aimAt(bot, target, state));
        bot.ai.fireAt = randRange(state, cfg.fireInterval[0], cfg.fireInterval[1]);
      }
      if (!want) {
        bot.ai.strafeT -= dt;
        if (bot.ai.strafeT <= 0) {
          bot.ai.strafe = -bot.ai.strafe;
          bot.ai.strafeT = 1.0 + rand(state) * 1.6;
        }
        const nx = (target.pos.x - bot.pos.x) / (dd || 1);
        const nz = (target.pos.z - bot.pos.z) / (dd || 1);
        let mx = -nz * bot.ai.strafe;   // tangent: circle the enemy
        let mz = nx * bot.ai.strafe;
        if (dd > cfg.engageFar) { mx += nx; mz += nz; }
        else if (dd < cfg.engageNear) { mx -= nx * 1.4; mz -= nz * 1.4; }
        const ml = Math.hypot(mx, mz) || 1;
        want = { x: bot.pos.x + (mx / ml) * 5, z: bot.pos.z + (mz / ml) * 5 };
      }
    }
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
  if (want && moved < cfg.walkSpeed * dt * 0.3) {
    bot.ai.stuckT += dt;
    if (bot.ai.stuckT > 0.4 && bot.onGround) {
      bot.vel.y = CONFIG.player.jumpSpeed;
      bot.onGround = false;
    }
    if (bot.ai.stuckT > 1.2) {
      pickWanderTarget(bot, state);
      bot.ai.strafe = -bot.ai.strafe;
      bot.ai.stuckT = 0;
    }
  } else {
    bot.ai.stuckT = 0;
  }
}
