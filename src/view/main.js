// Entry point: lobby -> match loop wiring input -> logic -> view/hud.
// Solo = local sim; multiplayer = host-authoritative over a ws room relay.
import { CONFIG } from '../logic/config.js';
import { createState, step } from '../logic/world.js';
import { createInput, buildLogicInput } from './input.js';
import { createView } from './sceneView.js';
import { createHud } from './hud.js';
import { createNet, defaultWsUrl } from '../net/net.js';

const view = createView(document.getElementById('app'));
const input = createInput(view.canvas);
const hud = createHud();
const net = createNet();

let state = null;
let packet = null;
let acc = 0;
let last = performance.now();
let lobbyTimer = null;

// ---------- lobby ----------

const lobbyEl = document.getElementById('lobby');
const lobbyInfo = document.getElementById('lobbyInfo');
const nickEl = document.getElementById('nick');
const roomEl = document.getElementById('room');
nickEl.value = localStorage.getItem('veggie_nick') || '';

function showLobby(msg) {
  lobbyEl.classList.remove('hidden');
  if (msg != null) lobbyInfo.innerHTML = msg;
}
function hideLobby() {
  lobbyEl.classList.add('hidden');
  if (lobbyTimer) { clearInterval(lobbyTimer); lobbyTimer = null; }
}

function startMatch(opts) {
  state = createState(opts);
  view.reset(state);
  document.getElementById('feed').innerHTML = '';
  hideLobby();
}

document.getElementById('soloBtn').onclick = () => {
  net.leave();
  startMatch({ humans: [{ id: 'player', name: nickEl.value.trim() || 'Вы' }], myId: 'player' });
};

document.getElementById('joinBtn').onclick = async () => {
  const room = roomEl.value.trim() || 'main';
  const name = nickEl.value.trim() || 'Игрок';
  localStorage.setItem('veggie_nick', name);
  lobbyInfo.innerHTML = 'подключаюсь…';
  try {
    await net.connect(defaultWsUrl(), room, name);
  } catch (e) {
    lobbyInfo.innerHTML = 'не удалось подключиться к серверу лобби';
    return;
  }
  lobbyInfo.innerHTML = 'в лобби…';
};

net.onLobby = (m) => {
  const names = m.players.map((p) => p.name + (p.id === m.host ? ' ★' : '')).join(', ');
  const tick = () => {
    const left = Math.max(0, Math.ceil(m.startAt - Date.now() / 1000));
    lobbyInfo.innerHTML =
      `комната <b>${net.room}</b> · игроков: ${m.players.length}` +
      `<br><span class="roster">${names}</span>` +
      `<br><span class="countdown">старт через ${left} с</span>`;
  };
  tick();
  if (lobbyTimer) clearInterval(lobbyTimer);
  lobbyTimer = setInterval(tick, 500);
};

net.onStart = (m) => {
  const role = m.host === net.myId ? 'host' : 'client';
  startMatch({
    seed: m.seed,
    humans: m.players.map((p) => ({ id: 'p' + p.id, name: p.name })),
    myId: 'p' + net.myId,
    netRole: role,
  });
};

net.onBecomeHost = () => {
  if (!state) return;
  state.netRole = 'host';
  for (const h of state.humans) if (h.remote) h.snapDriven = false;
};

net.onSnap = (s) => { if (state && net.role === 'client') net.applySnap(state, s); };

net.onPeerLeft = (m) => {
  if (!state) return;
  const e = state.humans.find((h) => h.id === 'p' + m.id);
  if (!e) return;
  if (net.role === 'host') {
    // walked out mid-match — the body drops dead where it stood
    e.alive = false;
    e.binned = false;
    e.onBalcony = false;
    state.events.push({ type: 'kill', victim: e.id, attacker: null, name: e.name });
  } else {
    e.alive = false;
  }
};

net.onClose = () => {
  if (state && state.netRole !== 'solo') {
    state = null;
    showLobby('соединение потеряно — выбери комнату заново');
  }
};

net.onErr = (m) => { if (!net.connected) showLobby('ошибка: ' + (m.msg || '?')); };

// ---------- match loop ----------

// events the client-side lite sim is allowed to surface locally —
// everything else arrives authoritative via host snapshots
const LOCAL_EVENTS = new Set(['fire', 'landed', 'mountedCannon']);

function drainEvents() {
  for (const e of state.events.splice(0)) {
    if (state.netRole === 'host') net.pendingEvents.push({ ...e });
    else if (state.netRole === 'client' && (!LOCAL_EVENTS.has(e.type) ||
               (e.owner && e.owner !== state.myNetId))) continue;
    if (e.type === 'mountedCannon' &&
        (e.target == null || e.target === state.myNetId)) {
      // look down into the arena: barrel points at -(cos a, sin a)
      input.yaw = Math.atan2(-Math.cos(e.angle), -Math.sin(e.angle));
      input.pitch = -0.42;
    }
    view.onEvent(e);
    hud.onEvent(e);
  }
}

function restartIfNeeded() {
  if (!input.restartPressed) return;
  input.restartPressed = false;
  if (state.netRole !== 'solo') {        // in MP, R means "back to lobby"
    net.leave();
    state = null;
    showLobby('вышел из матча');
    return;
  }
  state = createState();
  view.reset(state);
  document.getElementById('feed').innerHTML = '';
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state) return;

  restartIfNeeded();
  packet = buildLogicInput(input);

  if (net.role === 'host' && net.connected) net.drainInputs(state);
  if (net.role === 'client' && net.connected) net.sendInput(packet, now);

  acc += dtReal;
  let steps = 0;
  while (acc >= CONFIG.sim.dt && steps < CONFIG.sim.maxSteps) {
    step(state, packet, CONFIG.sim.dt);
    acc -= CONFIG.sim.dt;
    steps++;
  }
  if (steps === CONFIG.sim.maxSteps) acc = 0;

  drainEvents();
  if (net.role === 'host' && net.connected) net.sendSnap(state, now);
  view.sync(state, packet.aim, dtReal);
  hud.update(state, input);
  view.renderer.render(view.scene, view.camera);
}
requestAnimationFrame(frame);

// Hooks for headless playtests (playtest_game / render_game_to_text).
window.advanceTime = (ms) => {
  if (!state) return;
  let t = ms / 1000;
  while (t > 0) {
    packet = buildLogicInput(input);   // rebuild each tick so injected input lands
    step(state, packet, CONFIG.sim.dt);
    t -= CONFIG.sim.dt;
  }
  drainEvents();
  view.sync(state, packet.aim, 0);
  hud.update(state, input);
  view.renderer.render(view.scene, view.camera);
};

window.__view = view;
window.__input = input;
window.__net = net;
window.__state = () => state;
window.__startSolo = () => document.getElementById('soloBtn').click();

window.render_game_to_text = () => {
  if (!state) return JSON.stringify({ phase: 'lobby' });
  return JSON.stringify({
    phase: state.phase,
    time: +state.time.toFixed(2),
    role: state.netRole,
    engaged: state.playerEngaged,
    player: {
      pos: state.player.pos,
      hp: Math.round(state.player.hp),
      alive: state.player.alive,
      binned: state.player.binned,
      vegCount: state.player.vegCount,
      lives: state.player.lives,
      onBalcony: state.player.onBalcony,
      slimed: +state.player.slimedTimer.toFixed(2),
      mounted: state.player.mounted,
    },
    humans: state.humans.map((h) => ({ id: h.id, name: h.name, alive: h.alive })),
    botsAlive: state.bots.filter((b) => b.alive).length,
    botsBinned: state.bots.filter((b) => b.binned).length,
    onBalcony: state.bots.filter((b) => b.onBalcony).length,
    projectiles: state.projectiles.length,
    zone: { radius: +state.zone.radius.toFixed(1), dps: +state.zone.dps.toFixed(1) },
    kills: state.stats.kills,
    shots: state.stats.shots,
  });
};
