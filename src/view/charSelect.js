// Character picker: a slowly-turning 3D carousel of every cast GLB,
// opened between the lobby and the drop. Selection persists in
// localStorage and rides input packets so remote players see it too.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from '../../vendor/utils/SkeletonUtils.js';

// Indices match CHAR_FILES in sceneView.js (zombie excluded — it's for
// the infected, not a pickable skin).
export const CHAR_LIST = [
  { file: 'character-soldier',   name: 'Солдат' },
  { file: 'character-raider',    name: 'Рейдер' },
  { file: 'character-worker',    name: 'Рабочий' },
  { file: 'character-male-a',    name: 'Антон' },
  { file: 'character-male-b',    name: 'Борис' },
  { file: 'character-male-c',    name: 'Витёк' },
  { file: 'character-male-d',    name: 'Гриша' },
  { file: 'character-male-e',    name: 'Дима' },
  { file: 'character-male-f',    name: 'Егор' },
  { file: 'character-male-g',    name: 'Женя' },
  { file: 'character-female-a',  name: 'Аня' },
  { file: 'character-female-b',  name: 'Вера' },
  { file: 'character-female-c',  name: 'Галя' },
  { file: 'character-female-d',  name: 'Даша' },
  { file: 'character-female-e',  name: 'Ева' },
  { file: 'character-female-f',  name: 'Жанна' },
];

let session = null;   // active picker session or null

export function openCharSelect(onPick, onBack) {
  if (session) session.close();
  const el = document.getElementById('charSel');
  el.classList.remove('hidden');

  const canvas = document.getElementById('csCanvas');
  const nameEl = document.getElementById('csName');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0f0a, 14, 30);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 60);
  const R = 6.6;
  camera.position.set(0, 1.7, R + 5.0);
  camera.lookAt(0, 1.1, R * 0.55);

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a4a2e, 1.15));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(4, 8, 7);
  scene.add(sun);
  // podium the characters stand on + a highlight ring for the picked one
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 1.4, R + 1.4, 0.3, 40),
    new THREE.MeshStandardMaterial({ color: 0x223020, roughness: 0.9 }));
  podium.position.y = -0.15;
  scene.add(podium);
  const mark = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.08, 8, 28).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0x8a6a10 }));
  mark.position.set(0, 0.06, R);
  scene.add(mark);

  const ring = new THREE.Group();
  scene.add(ring);
  const N = CHAR_LIST.length;
  const step = (Math.PI * 2) / N;
  const mixers = [];
  const gltf = new GLTFLoader();
  CHAR_LIST.forEach((c, i) => {
    gltf.load(`assets/models/characters/${c.file}.glb`, (g) => {
      const m = cloneSkeleton(g.scene);
      const bb = new THREE.Box3().setFromObject(m);
      const k = 1.8 / Math.max(bb.max.y - bb.min.y, 1e-4);
      m.scale.setScalar(k);
      const a = i * step;
      m.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
      m.rotation.y = a;                       // face outward
      ring.add(m);
      if (g.animations?.length) {
        const mx = new THREE.AnimationMixer(m);
        const clip = g.animations.find((x) => /idle/i.test(x.name)) || g.animations[0];
        mx.clipAction(clip).play();
        mixers.push(mx);
      }
    }, undefined, () => {});
  });

  let sel = +(localStorage.getItem('veggie_skin') ?? 0) || 0;
  sel = ((sel % N) + N) % N;
  ring.rotation.y = -sel * step;
  const show = () => { nameEl.textContent = CHAR_LIST[sel].name; };
  const turn = (d) => { sel = ((sel + d) % N + N) % N; show(); };
  show();

  const s = {
    sel: () => sel,
    close: () => {
      cancelAnimationFrame(s.raf);
      window.removeEventListener('keydown', s.onKey);
      renderer.dispose();
      el.classList.add('hidden');
      session = null;
    },
  };
  document.getElementById('csPrev').onclick = () => turn(-1);
  document.getElementById('csNext').onclick = () => turn(1);
  document.getElementById('csGo').onclick = () => { const p = sel; s.close(); onPick(p); };
  document.getElementById('csBack').onclick = () => { s.close(); onBack?.(); };
  s.onKey = (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') turn(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') turn(1);
    else if (e.code === 'Enter') document.getElementById('csGo').click();
    else if (e.code === 'Escape') document.getElementById('csBack').click();
  };
  window.addEventListener('keydown', s.onKey);

  let last = performance.now();
  const tick = (now) => {
    s.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // spin the ring so the pick faces the camera, shortest way round
    let tgt = -sel * step;
    tgt += Math.round((ring.rotation.y - tgt) / (Math.PI * 2)) * Math.PI * 2;
    ring.rotation.y += (tgt - ring.rotation.y) * Math.min(1, dt * 7);
    for (const m of mixers) m.update(dt);
    const w = canvas.clientWidth || 900, h = canvas.clientHeight || 420;
    if (canvas.width !== w * renderer.getPixelRatio()) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  };
  s.raf = requestAnimationFrame(tick);
  session = s;
  return s;
}
