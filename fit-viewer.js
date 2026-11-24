// Weapon fitting viewer for Veggie BR — mirrors the game's attach
// hierarchy (model scaled to 1.8 m, anchor under arm-right, gun
// centred inside a holder). Exported JSON drops into GUN_FIT in
// src/view/sceneView.js.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';

const MODEL_H = 1.8;                       // = CONFIG.player.height
const CHARACTERS = { soldier: 'assets/models/character-soldier.glb' };
const WEAPONS = {
  ovoschemet: 'assets/models/ovoschemet.glb',
  Hlamomet: 'assets/models/Hlamomet.glb',
};

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.querySelector('#scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#14181c');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
camera.position.set(1.8, 1.7, 2.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);

scene.add(new THREE.HemisphereLight('#cfe8ff', '#2a4a1e', 1.2));
const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
sun.position.set(-3, 6, 2.5); sun.castShadow = true;
scene.add(sun);
scene.add(new THREE.GridHelper(12, 24, '#3a4a55', '#28323a'));
scene.add(new THREE.AxesHelper(0.6)); // X red, Y green, Z blue

// ---------- state ----------
const loader = new GLTFLoader();
const load = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
let charRoot = null, charScale = 1, mixer = null, actions = {};
let weaponProto = null, weaponObj = null, anchor = null, wlen = 1;
const $ = id => document.getElementById(id);
const KEYS = ['ax','ay','az','rx','ry','rz','len'];

// fit values per animation name ('' = no animation); start from a sane pose
const DEFAULT_FIT = { ax: 0.02, ay: 0.06, az: 0.04, rx: 0, ry: 90, rz: 0, len: 0.95 };
const fits = {};                    // animName -> {ax..len}
let currentAnim = '';
let currentWeapon = 'ovoschemet';
const params = { ...DEFAULT_FIT };  // live editing values

function fitToJSON(f) {
  return {
    ANCHOR_OFF: { x: +f.ax.toFixed(3), y: +f.ay.toFixed(3), z: +f.az.toFixed(3) },
    WEAPON_ROT: { x: +(f.rx * Math.PI / 180).toFixed(3), y: +(f.ry * Math.PI / 180).toFixed(3), z: +(f.rz * Math.PI / 180).toFixed(3) },
    WEAPON_LEN: +f.len.toFixed(2),
  };
}
function refreshJSON() {
  const out = { weapon: currentWeapon, default: fitToJSON(params) };
  const f = {};
  for (const [k, v] of Object.entries(fits)) f[k] = fitToJSON(v);
  if (Object.keys(f).length) out.fits = f;
  $('json').value = JSON.stringify(out, null, 2);
}
function apply() {
  if (anchor) anchor.position.set(params.ax, params.ay, params.az);
  if (weaponObj) {
    weaponObj.rotation.set(params.rx * Math.PI / 180, params.ry * Math.PI / 180, params.rz * Math.PI / 180);
    weaponObj.scale.setScalar((params.len / wlen) / charScale);
  }
  fits[currentAnim] = { ...params };
  refreshJSON();
}
function syncInputs() {
  for (const k of KEYS) { $(k).value = params[k]; $(k + 'n').value = +params[k].toFixed(3); }
}
for (const k of KEYS) {
  const on = v => { params[k] = +v; $(k).value = params[k]; $(k + 'n').value = params[k]; apply(); };
  $(k).addEventListener('input', e => on(e.target.value));
  $(k + 'n').addEventListener('input', e => on(e.target.value));
}
$('reset').addEventListener('click', () => { Object.assign(params, DEFAULT_FIT); syncInputs(); apply(); });
$('copyall').addEventListener('click', () => { for (const k of Object.keys(fits)) fits[k] = { ...params }; refreshJSON(); });
$('copy').addEventListener('click', () => navigator.clipboard.writeText($('json').value).then(() => { $('copy').textContent = 'Copied!'; setTimeout(() => $('copy').textContent = 'Copy JSON', 1200); }));
$('dl').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([$('json').value], { type: 'application/json' }));
  a.download = `weapon-fit-${currentWeapon}.json`; a.click();
});

// ---------- animation switching keeps a separate fit per clip ----------
function switchAnim(name) {
  currentAnim = name;
  const f = fits[name] || DEFAULT_FIT;
  Object.assign(params, f);
  for (const a of Object.values(actions)) a.stop();
  if (name && actions[name]) actions[name].reset().play();
  $('editing').innerHTML = `Editing fit for: <b>${name || '(none)'}</b>`;
  document.querySelectorAll('#gameanims button').forEach(b => b.classList.toggle('on', b.dataset.a === name));
  syncInputs(); apply();
}
$('anim').addEventListener('change', e => switchAnim(e.target.value));
document.querySelectorAll('#gameanims button').forEach(b =>
  b.addEventListener('click', () => { $('anim').value = b.dataset.a; switchAnim(b.dataset.a); }));

// ---------- loading ----------
async function loadCharacter(name) {
  if (charRoot) scene.remove(charRoot);
  const gltf = await load(CHARACTERS[name]);
  charRoot = gltf.scene;
  const box = new THREE.Box3().setFromObject(charRoot);
  charScale = MODEL_H / Math.max(0.001, box.max.y - box.min.y);
  charRoot.scale.setScalar(charScale);
  charRoot.traverse(n => { if (n.isMesh) n.castShadow = true; });
  scene.add(charRoot);
  mixer = new THREE.AnimationMixer(charRoot);
  actions = {};
  $('anim').innerHTML = '<option value="">(none)</option>';
  for (const clip of gltf.animations) {
    actions[clip.name] = mixer.clipAction(clip);
    $('anim').insertAdjacentHTML('beforeend', `<option>${clip.name}</option>`);
  }
  rebuildWeapon();
}
function rebuildWeapon() {
  if (!charRoot || !weaponProto) return;
  const parent = charRoot.getObjectByName('arm-right') || charRoot.getObjectByName('torso') || charRoot;
  $('attachnode').textContent = parent.name || 'root';
  anchor = new THREE.Object3D();
  parent.add(anchor);
  anchor.add(new THREE.AxesHelper(0.35 / charScale));
  weaponObj = weaponProto.clone();
  weaponObj.traverse(c => { if (c.isMesh) c.castShadow = true; });
  anchor.add(weaponObj);
  apply();
}
async function loadWeapon(name) {
  currentWeapon = name;
  const gltf = await load(WEAPONS[name]);
  weaponProto = gltf.scene;
  const wb = new THREE.Box3().setFromObject(weaponProto);
  wlen = Math.max(wb.max.x - wb.min.x, wb.max.y - wb.min.y, wb.max.z - wb.min.z) || 1;
  if (weaponObj) { weaponObj.parent.remove(weaponObj); weaponObj = null; }
  rebuildWeapon();
}
$('weapon').addEventListener('change', e => loadWeapon(e.target.value));

loadCharacter('soldier').catch(e => console.error(e));
loadWeapon('ovoschemet').catch(e => console.error(e));
syncInputs(); refreshJSON();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (mixer) mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
window.render_game_to_text = () => JSON.stringify({ viewer: true, char: !!charRoot, weapon: !!weaponObj });
window.advanceTime = () => renderer.render(scene, camera);
window.__scene = scene;
