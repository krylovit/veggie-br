// Three.js presentation layer. Reads the logic state and mirrors it with
// meshes; never feeds back into the simulation. First-person camera.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from '../../vendor/utils/SkeletonUtils.js';
import { CONFIG } from '../logic/config.js';

const VEG_COLOR = {
  tomato: 0xe23b2e, cucumber: 0x3f9b3f, banana: 0xf3d13c,
  broccoli: 0x2e7d32, carrot: 0xe8832a, potato: 0xa87c4f,
};
const BOT_COLORS = [0xc94f4f, 0xc97b3f, 0xb84fc9, 0x4f8fc9, 0x8fc94f, 0xc94f8f, 0x4fc9a5];

function mat(color, rough = 0.6) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

// Pixel-art cube textures drawn on canvas — grass/dirt/sand/brick,
// 16px per 1 m cube face, like Minecraft.
function makeTex(base, speckle, extra) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = speckle[(Math.random() * speckle.length) | 0];
    g.fillRect((Math.random() * 16) | 0, (Math.random() * 16) | 0, Math.random() < 0.3 ? 2 : 1, 1);
  }
  if (extra) extra(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEX = {
  grass: makeTex('#55a04a', ['#4c9142', '#63b356', '#3e7c34'], (g) => {
    g.strokeStyle = 'rgba(0,0,0,.15)';
    g.strokeRect(0.5, 0.5, 15, 15);   // faint 1 m cell border
  }),
  dirt: makeTex('#7a5636', ['#6b4a2e', '#8a6540', '#5d4128']),
  sand: makeTex('#dbc380', ['#cbb26d', '#e8d194', '#c4a95e']),
  brick: makeTex('#8a4a3a', ['#7c4234', '#96543f', '#a35b45'], (g) => {
    g.fillStyle = '#c9b8a0';
    for (const y of [3, 7, 11, 15]) g.fillRect(0, y, 16, 1);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (const x of [off, off + 8]) g.fillRect(x, row * 4, 1, 4);
    }
  }),
  bin: makeTex('#3f5a46', ['#37503d', '#48644f', '#2f4638'], (g) => {
    g.fillStyle = '#2a3d31';
    g.fillRect(0, 0, 16, 3);            // dark rim
    g.fillStyle = '#54705c';
    for (const x of [2, 7, 12]) g.fillRect(x, 4, 2, 12);  // vertical ribs
  }),
  briefs: makeTex('#f2f2ee', ['#e6e6e0', '#fafaf6', '#d9d9d2'], (g) => {
    g.fillStyle = '#d23b2e';            // tiny red hearts — семейные!
    for (const [x, y] of [[3, 3], [11, 8], [5, 12]]) {
      g.fillRect(x, y, 2, 1); g.fillRect(x + 3, y, 2, 1);
      g.fillRect(x, y + 1, 5, 2); g.fillRect(x + 1, y + 3, 3, 1); g.fillRect(x + 2, y + 4, 1, 1);
    }
  }),
  bra: makeTex('#f0a8c8', ['#e89ab8', '#f8bcd4', '#d988a8'], (g) => {
    g.fillStyle = '#c76b95';
    g.fillRect(0, 13, 16, 3);           // underband
  }),
  stone: makeTex('#8f9096', ['#838488', '#9c9da3', '#76777c'], (g) => {
    g.fillStyle = '#6e6f75';
    g.fillRect(0, 7, 16, 2);            // slab seam
  }),
  log: makeTex('#6b4a2a', ['#5d4124', '#7a5636', '#54371e'], (g) => {
    g.fillStyle = '#54371e';
    for (const x of [1, 5, 9, 13]) g.fillRect(x, 0, 2, 16);   // bark stripes
  }),
  leaf: makeTex('#3d7a2f', ['#356b28', '#4a8a3a', '#2c5c22'], (g) => {
    g.fillStyle = '#2c5c22';
    for (const [x, y] of [[2, 3], [9, 1], [13, 8], [4, 11], [7, 6], [11, 13]]) {
      g.fillRect(x, y, 2, 2);           // leaf gaps
    }
  }),
  path: makeTex('#8d8578', ['#7f7768', '#9b937f', '#6f6758'], (g) => {
    g.fillStyle = '#6f6758';
    g.fillRect(0, 7, 16, 2);            // paving seam
  }),
};
const MATS = {};
for (const [k, t] of Object.entries(TEX)) {
  MATS[k] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
}

// Recognizable veggies — every mesh flies business-end first (+Z after orient).
function makeVeggieMesh(type) {
  const g = new THREE.Group();
  if (type === 'tomato') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), mat(VEG_COLOR.tomato, 0.45)));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.14, 6), mat(0x2e7d32));
    stem.position.y = 0.3;
    g.add(stem);
    g.userData.spin = true;
  } else if (type === 'cucumber') {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.15, 0.48, 4, 8).rotateX(Math.PI / 2), mat(0x2f7a2f, 0.5));
    g.add(body);
    for (const dz of [-0.18, 0, 0.18]) {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mat(0x54b054, 0.4));
      bump.position.set(0, 0.14, dz);
      g.add(bump);
    }
    g.userData.orient = true;
  } else if (type === 'banana') {
    const body = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.085, 8, 14, Math.PI * 0.85), mat(VEG_COLOR.banana, 0.5));
    body.rotation.z = Math.PI * 0.07;
    g.add(body);
    for (const [x, y] of [[0.26, 0.02], [-0.26, 0.02]]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), mat(0x6b4a2a));
      tip.position.set(x, y, 0);
      g.add(tip);
    }
    g.userData.spin = true;
  } else if (type === 'broccoli') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.3, 8), mat(0xb9a06b));
    trunk.rotation.x = Math.PI / 2;
    trunk.position.z = 0.12;
    g.add(trunk);
    for (const [x, y, z, r] of [[0, 0, -0.14, 0.17], [0.11, 0.1, -0.1, 0.13], [-0.11, 0.1, -0.1, 0.13], [0, 0.16, -0.12, 0.12]]) {
      const floret = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(VEG_COLOR.broccoli, 0.8));
      floret.position.set(x, y, z);
      g.add(floret);
    }
    g.userData.orient = true;
  } else if (type === 'carrot') {
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.55, 10).rotateX(Math.PI / 2), mat(VEG_COLOR.carrot, 0.55));
    g.add(body);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6).rotateX(-Math.PI / 2), mat(0x3fa34d));
    leaf.position.z = -0.34;
    g.add(leaf);
    g.userData.orient = true;
  } else { // potato
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), mat(VEG_COLOR.potato, 0.95));
    body.scale.set(1.2, 0.8, 1);
    g.add(body);
    g.userData.spin = true;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Household junk — the junk launcher's ammo. All of it tumbles.
function makeJunkMesh(type) {
  const g = new THREE.Group();
  const box = (w, h, d, color, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, 0.5));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (type === 'toaster') {
    box(0.42, 0.28, 0.24, 0xc9c9cf);                       // steel body
    box(0.34, 0.03, 0.1, 0x333338, 0, 0.15, 0);            // slot on top
    const lever = box(0.05, 0.14, 0.05, 0xd23b2e);         // push lever
    lever.position.set(0.24, 0, 0);
  } else if (type === 'coffeemaker') {
    box(0.3, 0.36, 0.26, 0x2a2a30);                        // body
    box(0.2, 0.14, 0.2, 0x8a6b4a, 0, 0.25, 0);             // top reservoir
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.16, 10), mat(0x5a4028, 0.3));
    pot.position.set(0, -0.02, 0.17);
    g.add(pot);
  } else if (type === 'fork' || type === 'spoon') {
    const metal = mat(0xd8d8de, 0.25);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.025, 0.42, 6).rotateX(Math.PI / 2), metal);
    handle.position.z = 0.1;
    g.add(handle);
    if (type === 'fork') {
      for (const dx of [-0.045, -0.015, 0.015, 0.045]) {
        const tine = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.015, 0.14), metal);
        tine.position.set(dx, 0, -0.18);
        g.add(tine);
      }
      box(0.12, 0.015, 0.06, 0xd8d8de, 0, 0, -0.09);       // tine base
    } else {
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), metal);
      bowl.scale.set(1, 0.28, 1.35);
      bowl.position.z = -0.16;
      g.add(bowl);
    }
  } else { // iron / misc junk
    box(0.34, 0.1, 0.18, 0x4a4a55);                        // sole plate
    box(0.2, 0.16, 0.14, 0xd8d8de, 0, 0.12, -0.02);        // body
    box(0.05, 0.08, 0.14, 0xd23b2e, 0, 0.2, -0.02);        // handle
  }
  g.userData.spin = true;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Projectile mesh dispatcher: veggies, junk, slime.
function makeAmmoMesh(type) {
  return type === 'slime' ? makeSlimeMesh()
    : CONFIG.junk.order.includes(type) ? makeJunkMesh(type)
    : makeVeggieMesh(type);
}

// Flying slime: an irregular stretched glob, oriented along velocity.
function makeSlimeMesh() {
  const g = new THREE.Group();
  const m = (r, x, y, z, sx, sy, sz, c = 0x4fd35a) => {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.22 }));
    s.position.set(x, y, z);
    s.scale.set(sx, sy, sz);
    g.add(s);
    return s;
  };
  m(0.3, 0, 0, 0.15, 0.9, 0.9, 1.3);                 // head
  m(0.22, 0.05, -0.04, -0.18, 0.8, 0.7, 1.0);        // middle
  m(0.12, -0.06, 0.05, -0.4, 0.8, 0.8, 1.2, 0x3fb84a); // tail drip
  m(0.07, 0.14, -0.12, -0.28, 1, 1, 1.4, 0x3fb84a);  // side drip
  g.userData.orient = true;                          // nose along velocity
  return g;
}

export function createView(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0x87b5e0, 70, 240);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.05, 500);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a7a3d, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.7);
  sun.position.set(45, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, far: 220 });
  sun.shadow.camera.updateProjectionMatrix();
  // layer 1 = the local player's own body: skipped by the main camera,
  // kept in the shadow pass so your fighter still casts a live shadow
  sun.shadow.camera.layers.enable(1);
  scene.add(sun);

  const groundTex = TEX.grass.clone();
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(CONFIG.world.size, CONFIG.world.size); // 1 tile = 1 m
  groundTex.needsUpdate = true;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.world.size, CONFIG.world.size, 192, 192),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let groundShaped = false;   // vertices get pushed to state.heightAt on first sync

  const zoneWall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 26, 72, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff4040, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  zoneWall.position.y = 13;
  scene.add(zoneWall);
  const zoneRing = new THREE.Mesh(
    new THREE.RingGeometry(0.985, 1, 96),
    new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  zoneRing.rotation.x = -Math.PI / 2;
  zoneRing.position.y = 0.03;
  scene.add(zoneRing);

  // First-person viewmodel: two weapon slots hanging bottom-right.
  // vmSlot[0] — veggie launcher, vmSlot[1] — junk launcher.
  const viewmodel = new THREE.Group();          // kick/recoil container
  const vmSlot = [new THREE.Group(), new THREE.Group()];
  viewmodel.add(vmSlot[0], vmSlot[1]);
  {
    const vmTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.19, 1.1, 12).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x5d4a36, roughness: 0.55 })
    );
    const vmGrip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.14), mat(0x3d3229));
    vmGrip.position.set(0, -0.2, 0.28);
    const vmRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 16), mat(0xc9402e));
    vmRing.position.z = -0.45;
    vmSlot[0].add(vmTube, vmGrip, vmRing);

    const jmBody = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.36, 0.75), mat(0x6b4f2e));
    const jmHopper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.34), mat(0x87683f));
    jmHopper.position.set(0, 0.28, -0.05);
    const jmMuzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.21, 0.22, 10).rotateX(Math.PI / 2), mat(0x3d3229));
    jmMuzzle.position.z = -0.48;
    vmSlot[1].add(jmBody, jmHopper, jmMuzzle);
  }
  vmSlot[1].visible = false;
  viewmodel.scale.setScalar(0.62);
  viewmodel.position.set(0.36, -0.32, -0.72);
  viewmodel.rotation.y = -0.05;
  camera.add(viewmodel);
  let vmKick = 0;

  // GLB viewmodels: files in assets/models/ replace the procedural
  // fallback of their slot. Tweak size/pos/rot below if one sits oddly
  // (rot in radians; size = longest model dimension in viewmodel units).
  const GLB_VM = [
    { file: 'assets/models/weapons/ovoschemet.glb', size: 1.0, pos: { x: 0, y: -0.02, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    { file: 'assets/models/weapons/Hlamomet.glb',   size: 1.0, pos: { x: 0.02, y: -0.05, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
  ];
  const gltf = new GLTFLoader();
  GLB_VM.forEach((cfg, i) => {
    gltf.load(cfg.file, (g) => {
      const m = g.scene;
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const k = cfg.size / Math.max(size.x, size.y, size.z, 1e-4);
      m.scale.setScalar(k);
      m.position.set(-c.x * k, -c.y * k, -c.z * k);   // centre on the grip point
      const holder = new THREE.Group();
      holder.add(m);
      holder.rotation.set(cfg.rot.x, cfg.rot.y, cfg.rot.z);
      holder.position.set(cfg.pos.x, cfg.pos.y, cfg.pos.z);
      vmSlot[i].clear();
      vmSlot[i].add(holder);
      m.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    }, undefined, () => {});
  });

  // Character bodies: one GLB template per cast member, cloned
  // (skeleton and all) per entity; guns attach to arm-right.
  const CHAR_FILES = [
    'character-soldier', 'character-raider', 'character-worker',
    'character-male-a', 'character-male-b', 'character-male-c',
    'character-male-d', 'character-male-e', 'character-male-f',
    'character-male-g', 'character-female-a', 'character-female-b',
    'character-female-c', 'character-female-d', 'character-female-e',
    'character-female-f',
    'character-zombie',
  ];
  const ZOMBIE_IDX = CHAR_FILES.length - 1;
  const charProtos = new Array(CHAR_FILES.length).fill(null);  // {scene, anims}
  CHAR_FILES.forEach((name, i) => {
    gltf.load(`assets/models/characters/${name}.glb`, (g) => {
      charProtos[i] = { scene: g.scene, anims: g.animations };
    }, undefined, () => {});
  });
  const charIdxFor = (e) => e.zombie ? ZOMBIE_IDX :
    (e.skin != null ? e.skin :
    ((e.netIdx != null ? e.netIdx : 0) % ZOMBIE_IDX + ZOMBIE_IDX) % ZOMBIE_IDX);
  const gunProtos = [null, null];       // slot -> {scene, wlen}
  const gunWlen = (g) => {
    const wb = new THREE.Box3().setFromObject(g.scene);
    const ws = wb.getSize(new THREE.Vector3());
    return Math.max(ws.x, ws.y, ws.z, 1e-4);
  };
  gltf.load('assets/models/weapons/ovoschemet.glb', (g) => { gunProtos[0] = { scene: g.scene, wlen: gunWlen(g) }; }, undefined, () => {});
  gltf.load('assets/models/weapons/Hlamomet.glb',   (g) => { gunProtos[1] = { scene: g.scene, wlen: gunWlen(g) }; }, undefined, () => {});

  // Weapon crates scattered at match start — same GLB cloned per
  // crate, lid plays its `open` clip when looted.
  let crateProto = null;                // {scene, anims}
  gltf.load('assets/models/props/crate-small.glb', (g) => {
    crateProto = { scene: g.scene, anims: g.animations };
  }, undefined, () => {});
  const crateViews = new Map();         // crateId -> {g, mixer, opened}
  const popViews = new Map();           // lootPop id -> {g} floating gun bubble
  const carViews = new Map();           // car idx -> {g, wheels, mat}
  const cartViews = new Map();          // cart idx -> {g}

  // Infection hatch at map centre — a stone-rimmed plate with a heavy
  // lid; pressing the field button slides the lid off and zombies pour.
  const hatchG = new THREE.Group();
  const hatchRing = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.4, 16), MATS.stone);
  hatchRing.position.y = 0.2;
  const hatchHole = new THREE.Mesh(
    new THREE.CylinderGeometry(1.95, 1.95, 0.42, 16),
    new THREE.MeshStandardMaterial({ color: 0x0b0b0b }));
  hatchHole.position.y = 0.2;
  const hatchDoor = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.22, 16), MATS.bin);
  hatchDoor.position.y = 0.45;
  hatchG.add(hatchRing, hatchHole, hatchDoor);
  hatchG.position.set(CONFIG.zombies.hatchPos.x, 0, CONFIG.zombies.hatchPos.z);
  hatchG.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(hatchG);
  let hatchSlide = 0;

  // The big red button on a post — players press it (E) to open the hatch.
  const buttonG = new THREE.Group();
  const btnPost = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.15, 0.55), MATS.stone);
  btnPost.position.y = 0.57;
  const btnDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xe23b2e, emissive: 0x771111 }));
  btnDome.position.y = 1.28;
  const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.18, 12), MATS.bin);
  btnBase.position.y = 1.1;
  buttonG.add(btnPost, btnBase, btnDome);
  buttonG.position.set(CONFIG.zombies.buttonPos.x, 0, CONFIG.zombies.buttonPos.z);
  buttonG.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(buttonG);

  const ANIM_NAMES = ['walk', 'holding-right', 'holding-right-shoot', 'fall', 'idle'];
  // Hand-fit per weapon slot — exported from fit-viewer.html.
  // Per-anim `fits` override `default` (hands sit differently per clip).
  const GUN_FIT = [
    {   // ovoschemet (slot 0) — same hand fit as the junk gun
      default: { ax: -0.315, ay: 0.045, az: 0.125, rx: -0.061, ry: 2.007, rz: 0, len: 0.80 },
      fits: {
        'walk':                 { ax: -0.265, ay: 0.065, az: 0.085, rx: 0,      ry: 1.894, rz: 0, len: 0.75 },
        'idle':                 { ax: -0.315, ay: 0.045, az: 0.125, rx: -0.061, ry: 2.007, rz: 0, len: 0.80 },
        'holding-right':        { ax: -0.300, ay: 0.040, az: 0.125, rx: 0,      ry: 2.051, rz: 0, len: 0.85 },
        'holding-right-shoot':  { ax: -0.275, ay: 0.045, az: 0.115, rx: 0,      ry: 2.086, rz: 0, len: 0.85 },
      },
    },
    {   // Hlamomet (slot 1) — fit in the viewer, 4 anims
      default: { ax: -0.275, ay: 0.045, az: 0.115, rx: 0, ry: 2.086, rz: 0, len: 0.85 },
      fits: {
        'walk':                 { ax: -0.265, ay: 0.065, az: 0.085, rx: 0,      ry: 1.894, rz: 0, len: 0.75 },
        'idle':                 { ax: -0.315, ay: 0.045, az: 0.125, rx: -0.061, ry: 2.007, rz: 0, len: 0.80 },
        'holding-right':        { ax: -0.300, ay: 0.040, az: 0.125, rx: 0,      ry: 2.051, rz: 0, len: 0.85 },
        'holding-right-shoot':  { ax: -0.275, ay: 0.045, az: 0.115, rx: 0,      ry: 2.086, rz: 0, len: 0.85 },
      },
    },
  ];

  function upgradeToSoldier(g, e) {
    const proto = charProtos[charIdxFor(e)];
    if (!proto) return;
    // rebuild when the body turns into a zombie or the skin changes
    const want = charIdxFor(e);
    if (g.userData.glb && g.userData.charZombie === !!e.zombie &&
        g.userData.charIdx === want) return;
    g.userData.glb = true;
    g.userData.charZombie = !!e.zombie;
    g.userData.charIdx = want;
    g.userData.anim = null;
    g.userData.guns = null;
    const color = e.bot ? botColor(e.id) : 0x7ec9ff;
    const model = cloneSkeleton(proto.scene);
    const bb = new THREE.Box3().setFromObject(model);
    const k = CONFIG.player.height / Math.max(bb.max.y - bb.min.y, 1e-4);
    model.scale.setScalar(k);
    model.position.y = -bb.min.y * k;
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;   // skinned meshes glitch-cull otherwise
        o.material = o.material.clone();
        o.material.color.multiplyScalar(1);
        o.material.color.lerp(new THREE.Color(color), 0.28);  // team tint
      }
    });
    const body = g.userData.body;
    body.clear();
    body.add(model);
    body.add(g.userData.stuck);          // re-attach stuck-veggie layer
    body.add(g.userData.slime);
    // guns into the right hand, slot visibility toggled in sync —
    // same hierarchy as fit-viewer: holder = anchor(pos) + gun(rot+scale)
    const hand = new THREE.Group();
    const armR = model.getObjectByName('arm-right');
    if (armR) armR.add(hand); else { hand.position.set(0.5, 1.1, 0.2); body.add(hand); }
    g.userData.guns = gunProtos.map((proto, i) => {
      if (!proto) return null;
      const holder = new THREE.Group();
      const w = proto.scene.clone();
      w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      holder.add(w);
      holder.userData = { wlen: proto.wlen, k, w };
      applyGunFit(holder, GUN_FIT[i].default);
      holder.visible = false;
      hand.add(holder);
      return holder;
    });
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const n of ANIM_NAMES) {
      const c = THREE.AnimationClip.findByName(proto.anims, n);
      if (c) actions[n] = mixer.clipAction(c);
    }
    g.userData.anim = { mixer, actions, cur: null };
    g.userData.shootT = 0;
    g.userData.lp = null;                // last pos — speed estimate
  }

  function applyGunFit(holder, fit) {
    holder.position.set(fit.ax, fit.ay, fit.az);
    holder.rotation.set(fit.rx, fit.ry, fit.rz);
    const u = holder.userData;
    u.w.scale.setScalar((fit.len / u.wlen) / u.k);
  }

  function playAnim(g, name, dt) {
    const anim = g.userData.anim;
    if (!anim || anim.cur === name) return;
    const next = anim.actions[name];
    if (!next) return;
    next.reset().fadeIn(0.15).play();
    if (anim.cur && anim.actions[anim.cur]) anim.actions[anim.cur].fadeOut(0.15);
    anim.cur = name;
  }

  // First-person chute: семейные трусы overhead while dropping in.
  const playerChute = makeChuteMesh('briefs', true);
  playerChute.position.set(0, 1.5, -0.55);
  playerChute.rotation.x = 0.28;
  playerChute.scale.setScalar(0.6);
  playerChute.visible = false;
  camera.add(playerChute);

  const voxelGeo = new THREE.BoxGeometry(1, 1, 1);
  let voxelMeshes = [];
  const tmpM4 = new THREE.Matrix4();

  const capGeo = new THREE.CapsuleGeometry(
    CONFIG.player.radius, CONFIG.player.height - 2 * CONFIG.player.radius, 6, 14);
  const tubeGeo = new THREE.CylinderGeometry(0.11, 0.16, 1.15, 10).rotateX(Math.PI / 2);
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x5d4a36, roughness: 0.6 });

  const entities = new Map();    // id -> Group
  const pviews = new Map();      // projectile id -> Mesh
  const pickViews = new Map();   // pickup id -> Mesh (toast slices)
  const effects = [];            // {mesh, t, ttl, grow, rise}
  const tmpV = new THREE.Vector3();

    // Minecraft-style veggie bin: textured cube body, ribs, and veggies
  // poking out of the open top.
  function makeBinMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.1), MATS.bin);
    body.position.y = 0.7;
    body.castShadow = true;
    g.add(body);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 1.2), mat(0x2a3d31));
    rim.position.y = 1.42;
    g.add(rim);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.2), mat(0x33463a));
    lid.position.set(0.55, 1.32, 0.75);
    lid.rotation.z = 0.5;
    lid.rotation.x = 0.9;
    g.add(lid);   // lid knocked half-off
    const keys = CONFIG.weapon.order;
    for (let i = 0; i < 4; i++) {
      const veg = makeVeggieMesh(keys[i % keys.length]);
      veg.scale.setScalar(0.45);
      veg.position.set((i % 2 - 0.5) * 0.55, 1.5 + (i % 2) * 0.12, (Math.floor(i / 2) - 0.5) * 0.55);
      veg.rotation.set(i * 1.1, i * 2.3, i * 0.6);
      g.add(veg);
    }
    g.visible = false;
    return g;
  }

  // A toast slice — golden bread with darker crust.
  function makeToastMesh() {
    const g = new THREE.Group();
    const crust = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.09), mat(0xa06832));
    const bread = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.1), mat(0xe8bc72));
    g.add(crust, bread);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // The drivable car: rounded box sedan on four wheels. Body colour
  // varies per car so parking spots read as different vehicles.
  function makeCarMesh(i) {
    const colors = [0xc94f38, 0x3f7fbf, 0xd8a437, 0x58a05a, 0x8a6bb8];
    const paint = mat(colors[i % colors.length], 0.4);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.85, 1.8), paint);
    body.position.y = 0.95;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 1.6),
      mat(0x222831, 0.2));
    cabin.position.set(-0.15, 1.65, 0);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 1.7), paint);
    hood.position.set(1.25, 1.15, 0);
    // dashboard + steering wheel live inside the cabin — they show only
    // when the cabin is hidden for the first-person driver
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 1.55),
      mat(0x2a2f36, 0.6));
    dash.position.set(0.72, 1.5, 0);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 8, 14),
      mat(0x1a1a1e, 0.8));
    wheel.position.set(0.42, 1.45, -0.42);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = -0.35;
    g.add(body, cabin, hood, dash, wheel);
    const wheels = [];
    const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    const wm = mat(0x1a1a1e, 0.9);
    for (const [wx, wz] of [[1.15, 0.95], [1.15, -0.95], [-1.15, 0.95], [-1.15, -0.95]]) {
      const w = new THREE.Mesh(wg, wm);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.42, wz);
      wheels.push(w);
      g.add(w);
    }
    for (const dz of [-0.55, 0.55]) {          // headlights
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.3),
        mat(0xfff2b8, 0.1));
      h.position.set(1.82, 1.0, dz);
      g.add(h);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { g, wheels, paint, cabin };
  }

  // Coaster cart: an open-top tub that rides the rail loop.
  function makeCartMesh(i) {
    const colors = [0xe05252, 0x52a0e0, 0xe0b052];
    const g = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.9),
      mat(colors[i % colors.length], 0.4));
    tub.position.y = 0.55;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 2.0),
      mat(0xf0f0f0, 0.5));
    rim.position.y = 0.95;
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 1.2),
      mat(0x2c2c34, 0.8));
    bogie.position.y = 0.1;
    g.add(tub, rim, bogie);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // Windmill rotor: four wooden spars with cloth sails in an X, spun by
  // the sync loop. Mounted on the farm mill's axle stub.
  function makeWindmillRotor() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5.2, 0.14), MATS.log);
      spar.position.y = 2.6;
      const sail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.0, 0.05),
        mat(0xe8e0c8, 0.9));
      sail.position.set(0.55, 3.0, 0);
      b.add(spar, sail);
      b.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;   // X pattern
      g.add(b);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.5, 10).rotateX(Math.PI / 2),
      mat(0x54371e, 0.8));
    g.add(hub);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // Ferris wheel: steel A-frame + a slow-spinning rim with hanging
  // gondolas that counter-rotate so they always stay level.
  function makeFerris() {
    const g = new THREE.Group();
    const steel = mat(0x5a6674, 0.55);
    for (const s of [-1, 1]) {                        // A-legs splayed along the axle
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 10.6, 0.45), steel);
      leg.position.set(0, 5.0, s * 1.6);
      leg.rotation.x = -s * 0.28;
      g.add(leg);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 6.6), steel);
    cross.position.y = 3.4;
    g.add(cross);
    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 4.2, 10).rotateX(Math.PI / 2), steel);
    axle.position.y = 10;
    g.add(axle);

    const wheel = new THREE.Group();
    wheel.position.y = 10;
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(8, 0.2, 6, 28), steel));
    for (let i = 0; i < 8; i++) {                     // spokes
      const t = (i / 8) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 8, 0.16), steel);
      sp.position.set(Math.cos(t) * 4, Math.sin(t) * 4, 0);
      sp.rotation.z = t + Math.PI / 2;
      wheel.add(sp);
    }
    const hub2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 0.6, 12).rotateX(Math.PI / 2),
      mat(0xe8a030, 0.5));
    wheel.add(hub2);
    const cabs = [];
    const cols = [0xe05252, 0xe8a030, 0x4fa0e0, 0x58c058];
    for (let i = 0; i < 8; i++) {                     // gondolas on free pivots
      const t = (i / 8) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(t) * 8, Math.sin(t) * 8, 0);
      const cab = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), steel);
      bar.position.y = -0.55;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 1.5),
        mat(cols[i % 4], 0.5));
      body.position.y = -1.75;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 1.7),
        mat(0xf2f0e8, 0.6));
      roof.position.y = -1.0;
      cab.add(bar, body, roof);
      pivot.add(cab);
      wheel.add(pivot);
      cabs.push(cab);
    }
    g.add(wheel);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { g, wheel, cabs };
  }

  let millRotor = null;   // built lazily once state.windmill is known
  let ferris = null;      // {g, wheel, cabs} — built once state.ferris is known

  // The junk-bin: a big readable chrome toaster, two toasts sticking
  // out of the slots, red lever on the side. Same footprint as the bin.
  function makeToasterBinMesh() {
    const g = new THREE.Group();
    const steel = mat(0xbfc4cc, 0.35);
    const dark = mat(0x2c2c34);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.15, 1.05), steel);
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.08, 1.07), mat(0x8f959e));
    top.position.y = 1.32;
    g.add(top);
    for (const dz of [-0.26, 0.26]) {          // two slots
      const slot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.16), dark);
      slot.position.set(0, 1.37, dz);
      g.add(slot);
    }
    for (const dz of [-0.26, 0.26]) {          // toasts peeking out
      const t = makeToastMesh();
      t.scale.setScalar(1.5);
      t.position.set(0, 1.62, dz);
      t.rotation.z = dz > 0 ? 0.12 : -0.1;
      g.add(t);
    }
    const leverBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.14), dark);
    leverBase.position.set(0.78, 0.75, 0);
    g.add(leverBase);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.22), mat(0xd23b2e));
    lever.position.set(0.85, 0.62, 0);
    g.add(lever);
    for (const [dx, dz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), dark);
      leg.position.set(dx, 0.08, dz);
      g.add(leg);
    }
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10).rotateZ(Math.PI / 2), dark);
    knob.position.set(0.78, 1.05, -0.35);
    g.add(knob);
    g.visible = false;
    return g;
  }

  function makeEntityMesh(id, color) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.65 }));
    cap.position.y = CONFIG.player.height / 2;
    cap.castShadow = true;
    body.add(cap);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(0, 1.55, 0.45);
    body.add(eye);
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.position.set(0.52, 1.35, 0.5);
    tube.castShadow = true;
    body.add(tube);
    const stuck = new THREE.Group();   // veggies glued to the body
    body.add(stuck);
    g.add(body);
    const bin = makeBinMesh();
    g.add(bin);
    const toast = makeToasterBinMesh();
    g.add(toast);
    const n = parseInt(id.slice(3), 10) || 0;
    const chute = makeChuteMesh(n % 2 ? 'bra' : 'briefs');
    chute.position.y = 3.2;
    chute.visible = false;
    g.add(chute);
    const slime = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1),
      new THREE.MeshStandardMaterial({ color: 0x4fd35a, roughness: 0.3 }));
    slime.scale.set(1, 0.75, 1);
    slime.position.y = 0.7;
    slime.visible = false;
    body.add(slime);
    g.userData = { id, body, stuck, bin, toast, chute, slime };
    scene.add(g);
    return g;
  }

  // Keep one small veggie mesh glued to the capsule per state.vegStuck
  // entry — golden-angle spiral around the body.
  function syncStuck(e, g) {
    const stuck = g.userData.stuck;
    while (stuck.children.length > e.vegStuck.length) {
      stuck.remove(stuck.children[stuck.children.length - 1]);
    }
    for (let i = stuck.children.length; i < e.vegStuck.length; i++) {
      const m = makeAmmoMesh(e.vegStuck[i]);
      const a = i * 2.39996;                    // golden angle
      const r = CONFIG.player.radius + 0.08;
      m.scale.setScalar(0.55);
      m.position.set(Math.cos(a) * r, 0.35 + (i % 6) * 0.27, Math.sin(a) * r);
      m.rotation.set(i * 1.3, i * 2.1, i * 0.7);
      stuck.add(m);
    }
  }

  // Underwear parachute: 'briefs' = family trunks, 'bra' = две чашечки.
  // fp=true builds the player's own rig with lines out of the view.
  function makeChuteMesh(kind, fp = false) {
    const g = new THREE.Group();
    const canopy = new THREE.Group();
    if (kind === 'briefs') {
      const waist = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 1.1), MATS.briefs);
      canopy.add(waist);
      for (const sx of [-0.45, 0.45]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.6, 1.05), MATS.briefs);
        leg.position.set(sx, -0.38, 0);
        leg.rotation.z = sx * 0.22;
        canopy.add(leg);
      }
    } else {
      for (const sx of [-0.45, 0.45]) {
        const cup = new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 9), MATS.bra);
        cup.scale.set(1, 0.68, 0.92);
        cup.position.set(sx, -0.08, 0);
        canopy.add(cup);
      }
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.16, 0.95), MATS.bra);
      band.position.y = -0.4;
      canopy.add(band);
      const bow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat(0xc94f8f));
      bow.position.set(0, -0.12, 0.42);
      canopy.add(bow);
    }
    // suspension lines down to the shoulders
    const lineMat = mat(0x2b2b2b);
    for (const [sx, sz] of [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]]) {
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 4), lineMat);
      str.position.set(sx * 0.6, -1.05, sz * 0.6);
      str.rotation.z = sx * 0.32;
      str.rotation.x = -sz * 0.32;
      canopy.add(str);
    }
    if (fp) {   // first-person rig: lines pass BESIDE/behind the camera,
      // so the player hangs inside them instead of staring at strings
      canopy.children.filter((c) => c.geometry?.type === 'CylinderGeometry')
        .forEach((c) => { c.visible = false; });
      for (const [sx, sz] of [[-1.0, -0.45], [1.0, -0.45], [-1.0, 0.3], [1.0, 0.3]]) {
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 4), lineMat);
        str.position.set(sx, -1.35, sz + 0.55);
        str.rotation.z = sx * 0.38;
        str.rotation.x = -(sz + 0.55) * 0.3;
        canopy.add(str);
      }
    }
    g.add(canopy);
    g.userData.canopy = canopy;
    return g;
  }

  function botColor(id) {
    const n = parseInt(id.slice(3), 10) || 0;
    return BOT_COLORS[n % BOT_COLORS.length];
  }

  // Floating name tag over a human player (canvas sprite, always faces cam)
  function makeNameSprite(name) {
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 56;
    const ctx = cnv.getContext('2d');
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 7;
    ctx.strokeText(name, 128, 40);
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(name, 128, 40);
    const tex = new THREE.CanvasTexture(cnv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(2.4, 0.52, 1);
    sp.position.y = 2.25;
    sp.renderOrder = 5;
    return sp;
  }

  function spawnEffect(pos, color, ttl, grow, size, rise = 0) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
    );
    mesh.position.set(pos.x, pos.y, pos.z);
    scene.add(mesh);
    effects.push({ mesh, t: 0, ttl, grow, rise });
  }

  // No floating labels — stuck veggies carry the message, misses stay
  // silent. A hit is just a small white blink.
  function syncEntity(e, color, time, dt) {
    if (!e.alive) {
      const g = entities.get(e.id);
      if (g) { scene.remove(g); entities.delete(e.id); }
      return;
    }
    let g = entities.get(e.id);
    if (!g) {
      g = makeEntityMesh(e.id, e.bot ? botColor(e.id) : 0x7ec9ff);
      if (!e.bot) g.add(makeNameSprite(e.name || 'игрок'));
      entities.set(e.id, g);
    }
    upgradeToSoldier(g, e);
    g.position.set(e.pos.x, e.pos.y, e.pos.z);
    g.rotation.y = e.yaw;
    g.userData.body.visible = !e.binned && !e.car;   // drivers sit inside the car
    g.userData.bin.visible = !!e.binned && e.binKind !== 'toast';
    g.userData.toast.visible = !!e.binned && e.binKind === 'toast';
    // kicked bin somersaults through the air
    const spin = (e.binFlyT || 0) > 0 ? time * CONFIG.bin.spinRate : 0;
    g.userData.bin.rotation.x = spin;
    g.userData.toast.rotation.x = -spin * 0.8;
    g.userData.chute.visible = !!e.chute;
    if (e.chute) {
      g.userData.chute.rotation.z = Math.sin(time * 1.5 + e.chutePhase) * 0.14;
      g.userData.chute.rotation.x = Math.cos(time * 1.1 + e.chutePhase) * 0.08;
    }
    g.userData.slime.visible = (e.slimedTimer || 0) > 0;
    if (!e.binned) syncStuck(e, g);
    // soldier rig: pick the clip by what the entity is doing
    const anim = g.userData.anim;
    if (anim) {
      const lp = g.userData.lp;
      const speed = lp && dt > 0
        ? Math.hypot(e.pos.x - lp.x, e.pos.z - lp.z) / dt : 0;
      g.userData.lp = { x: e.pos.x, z: e.pos.z };
      g.userData.shootT = Math.max(0, (g.userData.shootT || 0) - dt);
      let want = speed > 0.8 ? 'walk' : 'holding-right';
      if (e.chute) want = 'fall';
      if (e.mounted != null) want = 'holding-right';
      if (g.userData.shootT > 0) want = 'holding-right-shoot';
      playAnim(g, want, dt);
      anim.mixer.update(dt);
      if (g.userData.guns) {
        const cur = e.slot || 0;
        g.userData.guns.forEach((gun, i) => { if (gun) gun.visible = i === cur && (!e.guns || e.guns[i]) && !e.zombie; });
        // the visible gun re-fits for the current clip (hand pose shifts)
        const fg = g.userData.guns[cur];
        const gfit = GUN_FIT[cur];
        if (fg && gfit) applyGunFit(fg, (gfit.fits && gfit.fits[want]) || gfit.default);
      }
    }
  }

  // Balcony ring: several independent arc platforms at a FIXED radius —
  // the shrinking zone wall slides underneath, nothing deforms.
  const balconyIM = new THREE.InstancedMesh(voxelGeo, MATS.stone, 500);
  balconyIM.castShadow = true;
  scene.add(balconyIM);
  const balconyTrim = new THREE.InstancedMesh(voxelGeo, MATS.brick, 220);
  scene.add(balconyTrim);

  // Sniper cannon: pedestal + swivel + long barrel with muzzle ring,
  // scope on top and bipod legs — mounted on the walkway edge.
  function makeCannonMesh() {
    const cg = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), MATS.stone);
    base.position.y = 0.35;
    cg.add(base);
    const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.45, 10), MATS.bin);
    swivel.position.y = 0.9;
    cg.add(swivel);
    const gun = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.16, 2.9, 10).rotateX(Math.PI / 2), MATS.bin);
    barrel.position.z = -1.3;
    gun.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 14), MATS.stone);
    muzzle.position.z = -2.75;
    gun.add(muzzle);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.7), MATS.brick);
    scope.position.set(0, 0.24, -0.9);
    gun.add(scope);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.9), MATS.bin);
    housing.position.z = 0.1;
    gun.add(housing);
    for (const sx of [-0.3, 0.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), MATS.bin);
      leg.position.set(sx, -0.35, -1.9);
      leg.rotation.x = 0.5;
      leg.rotation.z = sx * 0.4;
      gun.add(leg);
    }
    gun.position.y = 1.25;
    gun.rotation.x = -0.1;   // slight downward angle toward the field
    cg.add(gun);
    cg.userData.muzzle = muzzle;   // scope camera rides the barrel tip
    cg.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return cg;
  }
  const cannons = [];
  for (let i = 0; i < CONFIG.balcony.platforms * CONFIG.balcony.cannons.length; i++) {
    const cg = makeCannonMesh();
    scene.add(cg);
    cannons.push(cg);
  }

  function syncBalcony(state) {
    const b = state.balcony;
    const bc = CONFIG.balcony;
    const h = bc.height;
    const span = bc.span;
    const put = (im, i, a, rr, y) => {
      tmpM4.identity();
      tmpM4.setPosition(
        state.zone.cx + Math.cos(a) * rr, y,
        state.zone.cz + Math.sin(a) * rr);
      im.setMatrixAt(i, tmpM4);
    };
    let i = 0;
    let k = 0;
    let cg = 0;
    for (let pi = 0; pi < bc.platforms; pi++) {
      const base = b.angle + (pi * Math.PI * 2) / bc.platforms;
      const r = bc.radius;
      // 4-deep walkway, fixed 1 m pitch from the leading edge
      for (let row = 1; row <= bc.width; row++) {
        const rr = r - row;
        const n = Math.floor(span * rr);
        for (let j = 0; j < n && i < 460; j++) put(balconyIM, i++, base + j / rr, rr, h - 0.5);
      }
      // skirts under both edges — reads as a solid hanging structure
      for (const rr of [r - 1, r - bc.width]) {
        const n = Math.floor(span * rr);
        for (let j = 0; j < n && i < 500; j++) put(balconyIM, i++, base + j / rr, rr, h - 1.5);
      }
      // outer rail: single-height brick posts — visible edge, no wall.
      // NO field-side curb: the scope sight line must stay clear.
      {
        const rr = r - 0.5;
        const n = Math.max(2, Math.floor((span * rr) / 2));
        for (let j = 0; j <= n && k < 180; j++) {
          put(balconyTrim, k++, base + (j * 2) / rr, rr, h + 0.5);
        }
      }
      // cannons sit on the field-side edge, barrels overhanging the void
      for (let ci = 0; ci < bc.cannons.length && cg < cannons.length; ci++, cg++) {
        const a = base + bc.cannons[ci];
        const cr = r - bc.width + 0.2;   // same spot as logic cannonPos
        cannons[cg].position.set(
          state.zone.cx + Math.cos(a) * cr, h,
          state.zone.cz + Math.sin(a) * cr);
        cannons[cg].rotation.y = Math.PI / 2 - a;   // barrel faces the field
      }
    }
    balconyIM.count = i;
    balconyIM.instanceMatrix.needsUpdate = true;
    balconyTrim.count = k;
    balconyTrim.instanceMatrix.needsUpdate = true;
  }

  const view = {
    renderer, scene, camera,
    canvas: renderer.domElement,

    sync(state, aim, dtReal) {
      // one-time: bend the flat ground into the terrain relief
      if (!groundShaped && state.heightAt) {
        groundShaped = true;
        const pos = ground.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const wx = pos.getX(i), wz = -pos.getY(i);   // plane local Y -> world -Z
          pos.setZ(i, state.heightAt(wx, wz));
        }
        pos.needsUpdate = true;
        ground.geometry.computeVertexNormals();
      }
      // one-time: hang the spinning rotor on the windmill axle
      if (!millRotor && state.windmill) {
        millRotor = makeWindmillRotor();
        millRotor.position.set(state.windmill.x, state.windmill.y, state.windmill.z);
        scene.add(millRotor);
      }
      if (millRotor) millRotor.rotation.z += dtReal * 1.1;
      // one-time: mount the ferris wheel; then keep it turning slowly,
      // gondolas counter-rotate to hang level
      if (!ferris && state.ferris) {
        ferris = makeFerris();
        ferris.g.position.set(state.ferris.x, 0, state.ferris.z);
        scene.add(ferris.g);
      }
      if (ferris) {
        ferris.wheel.rotation.z += dtReal * 0.12;
        for (const cab of ferris.cabs) cab.rotation.z = -ferris.wheel.rotation.z;
      }
      // player is first-person: the mesh goes to layer 1 — invisible to
      // the main camera but still rendered into the sun's shadow map,
      // so your own fighter casts a live silhouette on the ground
      for (const e of state.humans.concat(state.bots, state.zombies || [])) {
        syncEntity(e, 0, state.time, dtReal);
        if (e === state.player) {
          const pg = entities.get(e.id);
          if (pg) pg.traverse((o) => o.layers.set(1));
        }
      }

      syncBalcony(state);

      const seen = new Set();
      for (const p of state.projectiles) {
        seen.add(p.id);
        let m = pviews.get(p.id);
        if (!m) { m = makeAmmoMesh(p.type); pviews.set(p.id, m); scene.add(m); }
        m.position.set(p.pos.x, p.pos.y, p.pos.z);
        if (m.userData.orient) {
          tmpV.set(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
          m.lookAt(tmpV);
        } else {
          m.rotation.z += 9 * dtReal;
          m.rotation.x += 4 * dtReal;
        }
      }
      for (const [id, m] of pviews) {
        if (!seen.has(id)) { scene.remove(m); pviews.delete(id); }
      }

      const seenPick = new Set();
      for (const p of state.pickups) {
        seenPick.add(p.id);
        let m = pickViews.get(p.id);
        if (!m) { m = makeToastMesh(); pickViews.set(p.id, m); scene.add(m); }
        m.position.set(p.pos.x, p.pos.y, p.pos.z);
        const settled = p.vel.x === 0 && p.vel.y === 0 && p.vel.z === 0;
        if (settled) {          // gentle idle bob + spin once landed
          m.position.y = p.pos.y + Math.sin(state.time * 3 + p.id) * 0.06;
          m.rotation.y += 2.2 * dtReal;
        } else {
          m.rotation.x += 7 * dtReal;
          m.rotation.z += 5 * dtReal;
        }
      }
      for (const [id, m] of pickViews) {
        if (!seenPick.has(id)) { scene.remove(m); pickViews.delete(id); }
      }

      // loot pops: the gun that burst out of a crate floats in a bubble
      // above the lid, spinning gently until somebody grabs it
      const seenPops = new Set();
      for (const lp of state.lootPops || []) {
        seenPops.add(lp.id);
        let pv = popViews.get(lp.id);
        if (!pv) {
          const g = new THREE.Group();
          const proto = gunProtos[lp.slot];
          if (proto) {
            const w = proto.scene.clone();
            const wb = new THREE.Box3().setFromObject(w);
            const ws = wb.getSize(new THREE.Vector3());
            w.scale.setScalar(0.85 / Math.max(ws.x, ws.y, ws.z, 1e-4));
            g.add(w);
          }
          g.add(new THREE.Mesh(
            new THREE.SphereGeometry(0.62, 16, 12),
            new THREE.MeshStandardMaterial({
              color: 0x9adfff, transparent: true, opacity: 0.2,
              emissive: 0x17445e, depthWrite: false,
            })));
          g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          scene.add(g);
          pv = { g };
          popViews.set(lp.id, pv);
        }
        pv.g.position.set(
          lp.pos.x,
          lp.pos.y + Math.sin(state.time * 2.2 + lp.pos.x) * 0.14,
          lp.pos.z);
        pv.g.rotation.y += dtReal * 1.8;
      }
      for (const [id, pv] of popViews) {
        if (!seenPops.has(id)) { scene.remove(pv.g); popViews.delete(id); }
      }

      // weapon crates: clone the GLB per crate, pop the lid on loot
      if (crateProto) {
        for (const c of state.crates) {
          let cv = crateViews.get(c.id);
          if (!cv) {
            const g = cloneSkeleton(crateProto.scene);
            const bb = new THREE.Box3().setFromObject(g);
            const ws = bb.getSize(new THREE.Vector3());
            const k = 1.0 / Math.max(ws.x, ws.y, ws.z, 1e-4);   // ~1 m wide
            g.scale.setScalar(k);
            g.position.set(c.pos.x, c.pos.y - bb.min.y * k, c.pos.z);
            g.rotation.y = c.yaw;
            g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
            scene.add(g);
            cv = { g, mixer: new THREE.AnimationMixer(g), opened: false };
            crateViews.set(c.id, cv);
          }
          if (c.opened && !cv.opened) {
            cv.opened = true;
            const clip = THREE.AnimationClip.findByName(crateProto.anims, 'open');
            if (clip) {
              const a = cv.mixer.clipAction(clip);
              a.setLoop(THREE.LoopOnce);
              a.clampWhenFinished = true;
              a.play();
            }
          }
          cv.mixer.update(dtReal);
        }
      }

      // drivable cars: spawn meshes lazily, follow the logic state
      for (const c of state.cars || []) {
        let cv = carViews.get(c.idx);
        if (!cv) {
          cv = makeCarMesh(c.idx);
          carViews.set(c.idx, cv);
          scene.add(cv.g);
        }
        cv.g.position.set(c.pos.x, c.pos.y, c.pos.z);
        cv.g.rotation.y = c.yaw - Math.PI / 2;    // mesh nose points +X
        cv.g.rotation.z = c.steer * 0.03;
        cv.cabin.visible = c.driver !== state.player;   // first-person: see the hood + dash, not the roof
        cv.paint.color.setHex(c.dead ? 0x3a3a3a : [0xc94f38, 0x3f7fbf, 0xd8a437, 0x58a05a, 0x8a6bb8][c.idx % 5]);
        const roll = c.speed * dtReal / 0.42;
        for (const w of cv.wheels) w.rotation.z -= roll;
      }
      // coaster carts ride the rail loop
      if (state.coaster) {
        for (const c of state.coaster.carts) {
          let cv = cartViews.get(c.idx);
          if (!cv) {
            cv = { g: makeCartMesh(c.idx) };
            cartViews.set(c.idx, cv);
            scene.add(cv.g);
          }
          cv.g.position.set(c.pos.x, c.pos.y, c.pos.z);
          cv.g.rotation.y = c.yaw - Math.PI / 2;
          cv.g.visible = c.rider !== state.player;   // first-person: own cart hidden
        }
      }

      // hatch lid slides off once the button is pressed
      hatchSlide += (((state.hatch && state.hatch.open) ? 1 : 0) - hatchSlide) * Math.min(1, dtReal * 3);
      hatchDoor.position.x = -3.6 * hatchSlide;
      hatchDoor.position.y = 0.45 + hatchSlide * 0.4;
      hatchDoor.rotation.z = hatchSlide * 0.35;
      // button dome: armed red → spent grey
      if (state.button && state.button.pressed) {
        btnDome.material.color.setHex(0x4fd35a);
        btnDome.material.emissive.setHex(0x0d3d10);
      }
      btnDome.position.y = 1.28 + Math.sin(state.time * 4) * 0.03;

      zoneWall.scale.set(state.zone.radius, 1, state.zone.radius);
      zoneRing.scale.set(state.zone.radius, state.zone.radius, 1);
      zoneWall.material.opacity = 0.13 + 0.05 * Math.sin(state.time * 3);

      for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i];
        fx.t += dtReal;
        const k = fx.t / fx.ttl;
        if (k >= 1) { scene.remove(fx.mesh); effects.splice(i, 1); continue; }
        if (fx.grow) fx.mesh.scale.multiplyScalar(1 + fx.grow * dtReal);
        if (fx.rise) fx.mesh.position.y += fx.rise * dtReal;
        if (fx.billboard) fx.mesh.lookAt(camera.position);
        if (fx.fly) {   // launched bin: ballistic arc + tumble
          fx.fly.vy -= 24 * dtReal;
          fx.mesh.position.x += fx.fly.vx * dtReal;
          fx.mesh.position.y += fx.fly.vy * dtReal;
          fx.mesh.position.z += fx.fly.vz * dtReal;
          fx.mesh.rotation.x += 6 * dtReal;
          fx.mesh.rotation.z += 4.5 * dtReal;
        }
        const fade = fx.fadeFrom != null ? Math.max(0, 1 - Math.max(0, k - fx.fadeFrom) / (1 - fx.fadeFrom)) : 1 - k;
        fx.mesh.traverse?.((o) => { if (o.material?.transparent) o.material.opacity = fade * 0.9; });
        if (fx.mesh.material?.transparent) fx.mesh.material.opacity = fade * 0.9;
      }

      vmKick = Math.max(0, vmKick - dtReal * 1.4);
      viewmodel.position.z = -0.72 + vmKick;
      viewmodel.rotation.x = vmKick * 1.6;
      const curSlot = state.player.slot || 0;
      viewmodel.visible =
        !state.player.binned && !state.player.onBalcony && state.player.mounted == null &&
        !state.player.car &&                                    // hands on the wheel
        (!state.player.guns || state.player.guns[curSlot]);   // unarmed = empty hands
      vmSlot.forEach((g, i) => { g.visible = curSlot === i; });

      // sniper scope zoom while manning a balcony cannon
      const wantFov = state.player.mounted != null ? 22 : CONFIG.camera.fov;
      if (Math.abs(camera.fov - wantFov) > 0.05) {
        camera.fov += (wantFov - camera.fov) * Math.min(1, dtReal * 9);
        camera.updateProjectionMatrix();
      }
      playerChute.visible = !!state.player.chute;
      if (state.player.chute) {
        playerChute.rotation.z = Math.sin(state.time * 1.6) * 0.09;
        playerChute.position.x = Math.sin(state.time * 1.1) * 0.12;
      }

      // first-person camera at eye height (peeking out of the bin when
      // binned); while manning a cannon the eye is AT THE MUZZLE TIP —
      // overhanging the void, nothing on the platform can occlude it
      const p = state.player.pos;
      const eyeY = p.y + (state.player.binned ? 1.1 : CONFIG.player.eyeHeight);
      if (state.player.mounted != null) {
        const m = state.player.mounted;
        const cg = cannons[m.p * CONFIG.balcony.cannons.length + m.c];
        cg.userData.muzzle.getWorldPosition(camera.position);
      } else {
        camera.position.set(p.x, eyeY, p.z);
      }
      tmpV.set(
        camera.position.x + aim.x,
        camera.position.y + aim.y,
        camera.position.z + aim.z);
      camera.lookAt(tmpV);
      // kicked as a bin — one slow somersault + fov punch, you see
      // the map drop away instead of a motion-blurred spin
      const flyT = state.player.binFlyT || 0;
      if (flyT > 0) {
        const el = CONFIG.bin.flyTime - flyT;
        camera.rotateZ(el * 1.9);
        camera.fov = 95;
        camera.updateProjectionMatrix();
      } else if (camera.fov !== CONFIG.camera.fov) {
        camera.fov = CONFIG.camera.fov;
        camera.updateProjectionMatrix();
      }
    },

    onEvent(e) {
      if (e.type === 'fire') {
        const fg = entities.get(e.owner);
        if (fg) fg.userData.shootT = 0.35;          // shoot anim trigger
        if (e.owner === 'player') vmKick = 0.14;   // no muzzle flash — quiet
      } else if (e.type === 'hit') {
        spawnEffect(e.pos, 0xffffff, 0.14, 1.4, 0.35);   // quiet blink — no labels
      } else if (e.type === 'slimed') {
        spawnEffect(e.pos, 0x6ee86e, 0.4, 2.4, 0.55);
      } else if (e.type === 'binned') {
        spawnEffect(e.pos, 0xd8ffd0, 0.5, 2.6, 0.7);
      } else if (e.type === 'binKicked') {
        // the real entity flies now (snapshot carries it) — just a flash
        spawnEffect(e.pos, 0xfff2a0, 0.25, 2, 0.5);
      } else if (e.type === 'revived') {
        spawnEffect(e.pos, 0xa8ffb0, 0.4, 2.2, 0.5);
      } else if (e.type === 'heal') {
        spawnEffect(e.pos, 0x7dff9a, 0.3, 1.8, 0.5);   // toast eaten — green pop
      } else if (e.type === 'landed') {
        spawnEffect(e.pos, 0xcfe8c0, 0.4, 2.4, 0.5);   // dust poof on touchdown
      } else if (e.type === 'kill') {
        const g = entities.get(e.victim);
        if (g) spawnEffect(g.position, 0xffe08a, 0.6, 3.2, 0.6);
      }
    },

    reset(state) {
      for (const [, g] of entities) scene.remove(g);
      entities.clear();
      for (const [, m] of pviews) scene.remove(m);
      pviews.clear();
      for (const [, m] of pickViews) scene.remove(m);
      pickViews.clear();
      for (const [, cv] of crateViews) scene.remove(cv.g);
      crateViews.clear();
      for (const [, pv] of popViews) scene.remove(pv.g);
      popViews.clear();
      for (const fx of effects) scene.remove(fx.mesh);
      effects.length = 0;
      for (const m of voxelMeshes) scene.remove(m);
      voxelMeshes = [];
      const byMat = {};
      for (const v of state.voxels) (byMat[v.mat] ??= []).push(v);
      for (const [mkey, list] of Object.entries(byMat)) {
        const im = new THREE.InstancedMesh(voxelGeo, MATS[mkey], list.length);
        list.forEach((v, i) => {
          tmpM4.makeRotationY(v.ry ?? 0);
          tmpM4.scale(tmpV.set(v.sx ?? 1, v.sy ?? 1, v.sz ?? 1));
          tmpM4.setPosition(v.x, v.y, v.z);
          im.setMatrixAt(i, tmpM4);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        scene.add(im);
        voxelMeshes.push(im);
      }
      zoneWall.position.set(state.zone.cx, 13, state.zone.cz);
      zoneRing.position.set(state.zone.cx, 0.03, state.zone.cz);
    },
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return view;
}
