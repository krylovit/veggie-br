// Drivable cars: parked on the roads, E to get in, WASD to drive.
// A fast car kills whatever it hits; a fast wall throws the driver
// out at half HP. Pure logic — plain state only.
import { CONFIG } from './config.js';
import { v3, copy, distXZ, clamp } from './vec3.js';
import { rand } from './rng.js';
import { killEntity } from './bin.js';
import { allEntities, damage } from './world.js';

const SPAWN_SPOTS = [
  { x: -140, z: -1.5, yaw: Math.PI / 2 },   // city edge, facing east
  { x: -40, z: 1.5, yaw: Math.PI / 2 },     // city outskirts
  { x: 5.5, z: 40, yaw: 0 },                // NS connector
  { x: 60, z: -1.5, yaw: -Math.PI / 2 },    // farm approach, facing west
  { x: 150, z: 1.5, yaw: -Math.PI / 2 },    // far farm road
];

export function spawnCars(state) {
  return SPAWN_SPOTS.slice(0, CONFIG.cars.count).map((s, i) => ({
    id: 'car' + i,
    idx: i,
    pos: v3(s.x, 0, s.z),
    yaw: s.yaw,
    speed: 0,
    steer: 0,
    hp: CONFIG.cars.hp,
    dead: false,
    driver: null,
  }));
}

export function nearestCar(state, ent, range) {
  let best = null, bd = range;
  for (const c of state.cars) {
    if (c.dead || c.driver) continue;
    const d = distXZ(ent.pos, c.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function tryEnterCar(state, ent) {
  if (ent.car || ent.cart || ent.chute || ent.binned || ent.zombie || ent.binFlyT > 0) return null;
  const c = nearestCar(state, ent, CONFIG.cars.enterRange);
  if (!c) return null;
  c.driver = ent;
  ent.car = c;
  ent.vel = v3();
  state.events.push({ type: 'enterCar', ent: ent.id, name: ent.name, car: c.id, byPlayer: ent === state.player });
  return c;
}

// Driver steps out to the side of the car (or is thrown out on a crash).
export function exitCar(state, ent, fling) {
  const car = ent.car;
  if (!car) return;
  car.driver = null;
  ent.car = null;
  if (fling) {
    const fwd = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    ent.vel = v3(fwd.x * car.speed * 1.1, CONFIG.cars.ejectUp, fwd.z * car.speed * 1.1);
    damage(state, ent, CONFIG.cars.crashDmg, 'car');
    state.events.push({ type: 'carCrash', ent: ent.id, name: ent.name, pos: copy(car.pos) });
  } else {
    const side = { x: Math.cos(car.yaw), z: -Math.sin(car.yaw) };
    ent.pos.x = car.pos.x + side.x * (CONFIG.cars.radius + 0.7);
    ent.pos.z = car.pos.z + side.z * (CONFIG.cars.radius + 0.7);
    ent.vel = v3();
    state.events.push({ type: 'exitCar', ent: ent.id, byPlayer: ent === state.player });
  }
}

// One physics tick for every car. Driverless cars coast to a stop.
export function stepCar(state, car, dt) {
  const cfg = CONFIG.cars;
  const drv = car.driver;
  if (car.dead) { car.speed = 0; return; }

  // steer-to-wish: WASD points where you want to go (camera-relative,
  // same as on foot) and the car turns toward it at a limited rate
  let throttle = 0;
  const inp = car.wish;
  if (drv && drv.alive && inp) {
    const wl = Math.hypot(inp.mx, inp.mz);
    if (wl > 0.1) {
      const want = Math.atan2(inp.mx, inp.mz);
      let dyaw = want - car.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const sf = clamp(Math.abs(car.speed) / 6 + 0.35, 0, 1);   // wheels still bite at low speed
      car.yaw += clamp(dyaw, -cfg.turnRate * sf * dt, cfg.turnRate * sf * dt);
      car.steer = clamp(dyaw * 2, -1, 1);
      throttle = Math.cos(dyaw) > 0 ? wl : -wl * 0.5;   // facing away: slow reverse
    }
  }
  // acceleration model: engine + brakes + drag
  if (throttle > 0.05) car.speed += cfg.accel * throttle * dt;
  else if (throttle < -0.05) {
    car.speed += car.speed > 0.5 ? cfg.brake * throttle * dt : cfg.accel * 0.6 * throttle * dt;
  } else {
    car.speed -= car.speed * cfg.drag * dt;
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }
  car.speed = clamp(car.speed, -cfg.maxSpeed * 0.35, cfg.maxSpeed);

  const fwd = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
  car.pos.x += fwd.x * car.speed * dt;
  car.pos.z += fwd.z * car.speed * dt;
  car.pos.y = state.heightAt(car.pos.x, car.pos.z);   // wheels follow the terrain

  // wall hit: circle-vs-box pushout; a fast hit is a crash
  const r = cfg.radius;
  let crashed = false;
  for (const o of state.obstacles) {
    if (car.pos.y >= o.max.y - 0.05) continue;
    const cx = clamp(car.pos.x, o.min.x, o.max.x);
    const cz = clamp(car.pos.z, o.min.z, o.max.z);
    const dx = car.pos.x - cx, dz = car.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r || d2 < 1e-9) continue;
    const d = Math.sqrt(d2);
    car.pos.x = cx + (dx / d) * r;
    car.pos.z = cz + (dz / d) * r;
    crashed = true;
  }
  if (crashed) {
    const impact = Math.abs(car.speed);
    car.speed = 0;
    if (impact > cfg.crashSpeed) {
      car.hp -= impact * 4;
      if (drv) exitCar(state, drv, true);
      if (car.hp <= 0) {
        car.dead = true;
        state.events.push({ type: 'carDead', pos: copy(car.pos) });
      }
    }
  }

  // run-overs: a fast car is a weapon, a slow one just shoves
  if (Math.abs(car.speed) > 0.5) {
    for (const e of allEntities(state)) {
      if (!e.alive || e === drv || e.car || e.cart || e.onBalcony) continue;
      if (Math.abs(e.pos.y - car.pos.y) > 2.5) continue;
      if (distXZ(e.pos, car.pos) > r + 0.6) continue;
      if (Math.abs(car.speed) > cfg.runoverSpeed) {
        if (drv === state.player) state.stats.kills++;
        state.events.push({ type: 'kill', victim: e.id, attacker: drv ? drv.id : null, name: e.name, veggie: 'car' });
        killEntity(state, e);
      } else {
        e.vel.x += fwd.x * car.speed * 1.4;
        e.vel.z += fwd.z * car.speed * 1.4;
        e.vel.y = Math.max(e.vel.y, 4);
      }
    }
  }

  // driver rides along in the seat
  if (drv) {
    if (!drv.alive) { car.driver = null; drv.car = null; return; }
    drv.pos.x = car.pos.x;
    drv.pos.z = car.pos.z;
    drv.pos.y = car.pos.y + 0.85;
    drv.vel = v3();
    drv.onGround = true;
  }
}
