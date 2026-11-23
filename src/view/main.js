// Entry point: fixed-timestep loop wiring input -> logic -> view/hud.
import { CONFIG } from '../logic/config.js';
import { createState, step } from '../logic/world.js';
import { createInput, buildLogicInput } from './input.js';
import { createView } from './sceneView.js';
import { createHud } from './hud.js';

const view = createView(document.getElementById('app'));
const input = createInput(view.canvas);
const hud = createHud();

let state = createState();
view.reset(state);

let packet = null;
let acc = 0;
let last = performance.now();

function drainEvents() {
  for (const e of state.events.splice(0)) {
    if (e.type === 'mountedCannon') {
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
  state = createState();
  view.reset(state);
  document.getElementById('feed').innerHTML = '';
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  restartIfNeeded();
  packet = buildLogicInput(input);

  acc += dtReal;
  let steps = 0;
  while (acc >= CONFIG.sim.dt && steps < CONFIG.sim.maxSteps) {
    step(state, packet, CONFIG.sim.dt);
    acc -= CONFIG.sim.dt;
    steps++;
  }
  if (steps === CONFIG.sim.maxSteps) acc = 0;

  drainEvents();
  view.sync(state, packet.aim, dtReal);
  hud.update(state, input);
  view.renderer.render(view.scene, view.camera);
}
requestAnimationFrame(frame);

// Hooks for headless playtests (playtest_game / render_game_to_text).
window.advanceTime = (ms) => {
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
window.__state = () => state;

window.render_game_to_text = () =>
  JSON.stringify({
    phase: state.phase,
    time: +state.time.toFixed(2),
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
    botsAlive: state.bots.filter((b) => b.alive).length,
    botsBinned: state.bots.filter((b) => b.binned).length,
    onBalcony: state.bots.filter((b) => b.onBalcony).length,
    projectiles: state.projectiles.length,
    zone: { radius: +state.zone.radius.toFixed(1), dps: +state.zone.dps.toFixed(1) },
    kills: state.stats.kills,
    shots: state.stats.shots,
  });
