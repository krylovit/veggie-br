// Multiplayer glue: websocket relay client + host-authoritative sync.
// The first room member is the host — it runs the full sim (bots too);
// everyone else runs a lite client sim (own movement prediction) and
// renders host snapshots. Server is a dumb room relay (lobby_server.py).
import { CONFIG } from '../logic/config.js';

export function createNet() {
  const net = {
    ws: null,
    connected: false,
    myId: null,
    hostId: null,
    room: null,
    role: 'solo',          // 'host' | 'client' once a match starts
    seq: 0,
    lastInputSent: 0,
    lastSnapSent: 0,
    inputQ: {},            // host: netId -> queued input packets
    pendingEvents: [],     // host: events to ship with the next snapshot
    onLobby: null,         // (msg) roster + countdown update
    onStart: null,         // (msg) match start: {seed, host, players}
    onSnap: null,          // (snap) client-side world update
    onPeerLeft: null,      // (msg) someone disconnected
    onClose: null,
    onErr: null,
  };

  net.connect = (url, room, name) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('ws connect failed')); } };
      ws.onclose = () => {
        net.connected = false;
        net.ws = null;
        if (!settled) { settled = true; reject(new Error('ws closed')); }
        net.onClose?.();
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.t) {
          case 'joined':
            settled = true;
            net.ws = ws;
            net.connected = true;
            net.myId = m.id;
            net.room = m.room;
            net.hostId = m.host;
            resolve(m);
            break;
          case 'lobby': net.onLobby?.(m); break;
          case 'start':
            net.hostId = m.host;
            net.role = m.host === net.myId ? 'host' : 'client';
            net.onStart?.(m);
            break;
          case 'input':                       // host only
            (net.inputQ['p' + m.from] ??= []).push(m.inp);
            break;
          case 'snap': net.onSnap?.(m.s); break;
          case 'host':                        // host migration
            net.hostId = m.id;
            if (m.id === net.myId && net.role !== 'host') {
              net.role = 'host';
              net.onBecomeHost?.();
            }
            break;
          case 'peerLeft': net.onPeerLeft?.(m); break;
          case 'err':
            if (!settled) { settled = true; reject(new Error(m.msg || 'error')); }
            net.onErr?.(m);
            break;
        }
      };
    });

  net.send = (o) => { if (net.ws?.readyState === 1) net.ws.send(JSON.stringify(o)); };
  net.leave = () => { try { net.send({ t: 'leave' }); } catch {} net.ws?.close(); };

  // ---- client -> host ----
  net.sendInput = (packet, nowMs) => {
    if (nowMs - net.lastInputSent < 1000 / CONFIG.lobby.inputHz) return;
    net.lastInputSent = nowMs;
    net.send({ t: 'input', seq: ++net.seq, inp: packet });
  };

  // ---- host: pull queued remote inputs into entities ----
  // Continuous axes come from the newest packet; edge-triggered flags
  // (fire/jump/interact/slot) are OR-merged so nothing gets lost between ticks.
  net.drainInputs = (state) => {
    for (const h of state.humans) {
      if (!h.remote) continue;
      const q = net.inputQ[h.id];
      if (!q || !q.length) continue;
      const last = q[q.length - 1];
      const merged = { ...last };
      for (const p of q) {
        merged.jump ||= p.jump;
        merged.fire ||= p.fire;
        merged.interact ||= p.interact;
        merged.active ||= p.active;
        merged.slotSel ??= p.slotSel;
        merged.slotCycle = (merged.slotCycle || 0) + (p.slotCycle || 0);
      }
      h.netInput = merged;
      if (merged.sk != null) h.skin = merged.sk;   // character pick rides inputs
      delete net.inputQ[h.id];
    }
  };

  // ---- host -> clients: world snapshot ----
  net.sendSnap = (state, nowMs) => {
    if (nowMs - net.lastSnapSent < 1000 / CONFIG.lobby.snapHz) return;
    net.lastSnapSent = nowMs;
    const r2 = (n) => Math.round(n * 100) / 100;
    net.send({
      t: 'snap',
      s: {
        t: r2(state.time),
        ph: state.phase,
        z: { r: r2(state.zone.radius), d: r2(state.zone.dps) },
        ba: r2(state.balcony.angle),
        en: state.netEnts.map((e) => ({
          i: e.netIdx,
          x: r2(e.pos.x), y: r2(e.pos.y), z: r2(e.pos.z),
          yw: r2(e.yaw),
          hp: Math.round(e.hp),
          al: e.alive ? 1 : 0,
          bi: e.binned ? 1 : 0,
          bk: e.binKind,
          ft: r2(e.binFlyT || 0),
          ob: e.onBalcony ? 1 : 0,
          bp: e.balconyP, baa: r2(e.balconyA), br: r2(e.balconyR),
          bt: r2(e.balconyTimer),
          ch: e.chute ? 1 : 0, cp: r2(e.chutePhase),
          sl: r2(e.slimedTimer),
          m: e.mounted,
          en: e.engaged ? 1 : 0,
          vc: e.vegCount, vs: e.vegStuck,
          lv: e.lives, w: e.slot || 0,
          g: (e.guns ? (e.guns[0] ? 1 : 0) | (e.guns[1] ? 2 : 0) : 3),
          zm: e.zombie ? 1 : 0,
          sk: e.skin,
          ca: e.car ? e.car.idx + 1 : 0,
          ct: e.cart ? e.cart.idx + 1 : 0,
        })),
        zb: state.zombies.map((z, i) => ({
          i, x: r2(z.pos.x), y: r2(z.pos.y), z: r2(z.pos.z),
          yw: r2(z.yaw), hp: Math.round(z.hp), al: z.alive ? 1 : 0,
        })),
        ht: state.hatch.open ? 1 : 0,
        bt: state.button.pressed ? 1 : 0,
        pr: state.projectiles.map((p) => ({
          i: p.id, t: p.type,
          x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
          o: p.owner,
        })),
        pk: state.pickups.map((p) => ({
          i: p.id, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), ttl: r2(p.ttl),
        })),
        cr: state.crates.map((c) => ({
          i: c.id, x: r2(c.pos.x), z: r2(c.pos.z), yw: r2(c.yaw),
          o: c.opened ? 1 : 0,
        })),
        lp: state.lootPops.map((p, i) => ({
          i, x: r2(p.pos.x), z: r2(p.pos.z), s: p.slot,
        })),
        ca: state.cars.map((c, i) => ({
          i, x: r2(c.pos.x), y: r2(c.pos.y), z: r2(c.pos.z),
          yw: r2(c.yaw), hp: Math.round(c.hp), dd: c.dead ? 1 : 0,
        })),
        ck: state.coaster.carts.map((c, i) => ({
          i, x: r2(c.pos.x), y: r2(c.pos.y), z: r2(c.pos.z), yw: r2(c.yaw),
        })),
        ev: net.pendingEvents.splice(0),
      },
    });
  };

  // ---- client: apply a host snapshot ----
  net.applySnap = (state, s) => {
    const myId = state.myNetId;
    state.time = s.t;
    state.zone.radius = s.z.r;
    state.zone.dps = s.z.d;
    state.balcony.angle = s.ba;
    if (s.ph !== state.phase) {
      state.phase = s.ph;
      if (s.ph !== 'playing') state.events.push({ type: 'phase', phase: s.ph });
    }
    for (const se of s.en) {
      const e = state.netEnts[se.i];
      if (!e) continue;
      const mine = e === state.player;
      // position: remotes chase a smooth target, local player gets a
      // gentle correction (hard snap only when badly diverged)
      if (mine) {
        const d = Math.hypot(e.pos.x - se.x, e.pos.y - se.y, e.pos.z - se.z);
        if (d > 2.5) { e.pos.x = se.x; e.pos.y = se.y; e.pos.z = se.z; }
        else { e.pos.x += (se.x - e.pos.x) * 0.1; e.pos.y += (se.y - e.pos.y) * 0.1; e.pos.z += (se.z - e.pos.z) * 0.1; }
      } else {
        e.tgt = { x: se.x, y: se.y, z: se.z };
      }
      e.yaw = se.yw;
      e.hp = se.hp;
      e.alive = !!se.al;
      e.binned = !!se.bi;
      e.binKind = se.bk;
      e.binFlyT = se.ft || 0;
      e.onBalcony = !!se.ob;
      e.balconyP = se.bp; e.balconyA = se.baa; e.balconyR = se.br;
      e.balconyTimer = se.bt;
      e.chute = !!se.ch; e.chutePhase = se.cp;
      e.slimedTimer = se.sl;
      e.mounted = se.m;
      e.engaged = !!se.en;
      e.vegCount = se.vc;
      if (se.vs) e.vegStuck = se.vs.slice();
      e.lives = se.lv;
      e.slot = se.w || 0;
      if (se.g != null) e.guns = [!!(se.g & 1), !!(se.g & 2)];
      e.zombie = !!se.zm;
      if (se.sk != null) e.skin = se.sk;
      e.car = se.ca ? state.cars[se.ca - 1] || null : null;
      e.cart = se.ct ? state.coaster.carts[se.ct - 1] || null : null;
      if (!e.alive) e.vel = { x: 0, y: 0, z: 0 };
    }
    // projectiles: host list wins; keep only very fresh local shots that
    // haven't been echoed back yet (dedup by the `net` marker + id)
    const snapIds = new Set();
    const merged = s.pr.map((p) => {
      snapIds.add(p.i);
      return {
        id: p.i, net: true, type: p.t, owner: p.o,
        pos: { x: p.x, y: p.y, z: p.z },
        prev: { x: p.x, y: p.y, z: p.z },
        vel: { x: 0, y: 0, z: 0 }, ttl: 5,
      };
    });
    for (const p of state.projectiles) {
      if (p.net) continue;
      if (p.owner === myId && (p.la || 0) < 0.45 && !snapIds.has(p.id)) merged.push(p);
    }
    state.projectiles = merged;
    // infection: hatch, button and the zombie wave ride the snapshot
    if (s.ht != null) state.hatch.open = !!s.ht;
    if (s.bt != null) state.button.pressed = !!s.bt;
    if (s.zb) {
      for (const sz of s.zb) {
        let z = state.zombies[sz.i];
        if (!z) {
          z = state.zombies[sz.i] = {
            id: 'z' + sz.i, bot: true, zombie: true, name: 'Зомби',
            pos: { x: sz.x, y: sz.y, z: sz.z }, vel: { x: 0, y: 0, z: 0 },
            yaw: sz.yw, hp: sz.hp, alive: true,
            chute: false, binned: false, binFlyT: 0,
            vegCount: 0, vegStuck: [], lives: 0, onBalcony: false,
            slimedTimer: 0, mounted: null, engaged: true,
            guns: [false, false], slot: 0, snapDriven: true,
          };
        }
        z.tgt = { x: sz.x, y: sz.y, z: sz.z };
        z.yaw = sz.yw;
        z.hp = sz.hp;
        z.alive = !!sz.al;
      }
    }
    if (s.ca) {
      for (const sc of s.ca) {
        const c = state.cars[sc.i];
        if (!c) continue;
        c.pos.x = sc.x; c.pos.y = sc.y; c.pos.z = sc.z;
        c.yaw = sc.yw; c.hp = sc.hp; c.dead = !!sc.dd;
      }
    }
    if (s.ck) {
      for (const sc of s.ck) {
        const c = state.coaster.carts[sc.i];
        if (!c) continue;
        c.pos.x = sc.x; c.pos.y = sc.y; c.pos.z = sc.z; c.yaw = sc.yw;
      }
    }
    if (s.lp) {
      state.lootPops = s.lp.map((p) => ({
        id: 'pop' + p.i,
        pos: { x: p.x, y: 1.15, z: p.z },
        slot: p.s, age: 9,
      }));
    }
    state.pickups = s.pk.map((p) => ({
      id: p.i, type: 'toast',
      pos: { x: p.x, y: p.y, z: p.z },
      vel: { x: 0, y: 0, z: 0 }, ttl: p.ttl,
    }));
    if (s.cr) {
      const byId = new Map(state.crates.map((c) => [c.id, c]));
      for (const sc of s.cr) {
        const c = byId.get(sc.i);
        if (!c) continue;
        if (sc.o && !c.opened) {          // lid popped on the host
          c.opened = true;
          state.events.push({ type: 'crateOpen', crate: c.id });
        }
        c.opened = !!sc.o;
      }
    }
    for (const ev of s.ev) {
      // host emits byPlayer from its own perspective — remap to mine
      ev.byPlayer = ev.attacker === myId ||
        ((ev.type === 'heal' || ev.type === 'hit') && ev.target === myId);
      if (ev.type === 'fire' && ev.owner === myId) continue;   // own muzzle already flashed
      if (ev.type === 'mountedCannon' && ev.target === myId) continue;
      state.events.push(ev);
    }
  };

  return net;
}

// Where the lobby relay lives. Local dev hits the python server directly;
// everywhere else goes through the Caddy route on kapitanpiho.
export function defaultWsUrl() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return `ws://${h}:8791`;
  return 'wss://kapitanpiho.duckdns.org/veggie-ws';
}
