// DOM/pointer-lock input collection. Produces an engine-free input packet
// (world-space vectors only) for the logic layer.
import { CONFIG } from '../logic/config.js';
import { clamp } from '../logic/vec3.js';

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    yaw: CONFIG.player.spawnYaw,
    pitch: -0.1,
    fireHeld: false,
    restartPressed: false,
    interactPressed: false,
    slotSel: null,
    wheelCycle: 0,
    locked: false,
    everLocked: false,
  };

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'KeyR') input.restartPressed = true;
    if (e.code === 'KeyE') input.interactPressed = true;
    if (e.code === 'Digit1') input.slotSel = 0;
    if (e.code === 'Digit2') input.slotSel = 1;
  });
  window.addEventListener('wheel', (e) => {
    input.wheelCycle += e.deltaY > 0 ? 1 : -1;
  }, { passive: true });
  document.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());

  canvas.addEventListener('click', () => {
    if (!input.locked) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (input.locked) input.everLocked = true;
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.yaw -= e.movementX * CONFIG.camera.sensitivity;
    input.pitch = clamp(
      input.pitch - e.movementY * CONFIG.camera.sensitivity,
      CONFIG.camera.pitchMin,
      CONFIG.camera.pitchMax
    );
  });
  document.addEventListener('mousedown', (e) => {
    if (input.locked && e.button === 0) input.fireHeld = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fireHeld = false;
  });

  return input;
}

// Raw input -> logic packet: {mx, mz} is the world-space wish direction,
// {aim} is the unit look vector from yaw+pitch.
export function buildLogicInput(input) {
  const k = input.keys;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  const sy = Math.sin(input.yaw);
  const cy = Math.cos(input.yaw);
  let mx = sy * f + -cy * s;
  let mz = cy * f + sy * s;
  const m = Math.hypot(mx, mz);
  if (m > 1e-6) { mx /= m; mz /= m; }
  const cp = Math.cos(input.pitch);
  const packet = {
    mx, mz,
    jump: k.has('Space'),
    sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
    fire: input.fireHeld && input.locked,
    interact: input.interactPressed,
    slotSel: input.slotSel,
    slotCycle: input.wheelCycle,
    aim: { x: sy * cp, y: Math.sin(input.pitch), z: cy * cp },
    active: input.everLocked,
  };
  input.interactPressed = false;   // edge-triggered, consumed per frame
  input.slotSel = null;
  input.wheelCycle = 0;
  return packet;
}
