// All tuning constants live here — the Luau Config module is a
// mechanical translation of this table.
export const CONFIG = {
  world: {
    size: 220,            // square flat map edge length
    seed: 1337,
  },
  player: {
    radius: 0.55,         // capsule radius
    height: 1.8,          // capsule total height
    eyeHeight: 1.55,      // camera/muzzle anchor above feet
    hitCenterY: 0.95,     // hit sphere center above feet
    hitRadius: 0.95,      // single-sphere approximation of the capsule
    walkSpeed: 9,
    sprintSpeed: 15,
    jumpSpeed: 11,        // jump apex ~2.3 m — enough for every crate
    gravity: 26,
    maxHp: 100,
    spawn: { x: 0, y: 0, z: 34 },
    spawnYaw: Math.PI,    // face the map center (-Z from spawn)
  },
  camera: {
    fov: 75,
    pitchMin: -0.85,
    pitchMax: 0.85,
    sensitivity: 0.0025,
  },
  weapon: {
    cooldown: 0.22,       // seconds between player shots
    speed: 46,
    gravity: 8,           // slight projectile arc
    radius: 0.26,
    ttl: 3.0,
    muzzleY: 1.55,        // projectile spawn height above feet (eye level)
    muzzleFwd: 1.0,       // spawn this far along the aim direction
    // Ammo type is picked at random per shot — purely cosmetic.
    veggies: {
      tomato:   { name: 'помидор'   },
      cucumber: { name: 'огурец'    },
      banana:   { name: 'банан'     },
      broccoli: { name: 'брокколи'  },
      carrot:   { name: 'морковь'   },
      potato:   { name: 'картофель' },
    },
    order: ['tomato', 'cucumber', 'banana', 'broccoli', 'carrot', 'potato'],
  },
  // Хламомёт — JunkLauncher, weapon slot 2 (keys 1/2 + mouse wheel).
  // A 4-barrel junk SHOTGUN: every trigger pull throws a whole cutlery
  // set. Each stuck piece counts `sticks` toward the bin, so two
  // point-blank blasts (8 pieces × 2) already make a bin.
  junk: {
    cooldown: 0.55,
    speed: 38,
    gravity: 14,          // junk drops faster — feels heavier
    radius: 0.32,
    ttl: 3.0,
    muzzleY: 1.55,
    muzzleFwd: 1.0,
    pellets: 4,           // barrels — a tableware set per shot
    spread: 0.10,         // radians of shotgun scatter
    sticks: 2,            // bin points per stuck piece (2 blasts = bin)
    types: {
      toaster:     { name: 'тостер'    },
      coffeemaker: { name: 'кофеварка' },
      fork:        { name: 'вилка'     },
      spoon:       { name: 'ложка'     },
    },
    order: ['toaster', 'coffeemaker', 'fork', 'spoon'],
  },
  weaponSlots: 2,
  // Weapon crates: everyone drops unarmed, guns come from loot boxes.
  loot: {
    crates: 14,         // crates scattered around the map at match start
    openRange: 2.4,     // E distance to pop the lid
    botLootRange: 300,  // an unarmed bot walks to a crate within this range
    consolationHp: 12,  // already own the rolled gun? heal instead
    vegOdds: 0.6,       // chance the crate holds the veggie launcher
  },
  // Junk-binned victims turn into a BIG TOASTER instead of a veggie bin.
  // Kicking it pops out toast slices — pickups that heal whoever grabs
  // them. The kick itself still scores the kill as usual.
  toaster: {
    heal: 14,           // HP per toast slice
    count: 4,           // slices popped out on kick
    ttl: 8,             // seconds a slice stays on the ground
    pickupR: 1.1,       // grab radius (m, XZ)
    popUp: 6.5,         // pop velocity upward
    popSide: 2.4,       // sideways scatter
  },
  // Veggies stick to the victim. Enough of them and the entity turns into
  // a veggie bin: kick it (E / bots auto-kick) for the kill, or it pops
  // back out at half health when the timer ends.
  bin: {
    hits: 10,             // stuck veggies needed to become a bin
    hitDmg: 3,            // hp lost per stuck point (junk counts double)
    duration: 3.0,        // seconds before auto-revive
    reviveHp: 0.5,        // fraction of maxHp restored on revive
    kickRange: 2.4,       // metres — how close you must be to kick
    botSeekRange: 10,     // bots walk to a bin to kick it inside this range
    flySpeed: 9,          // launched bin: mostly UP, a little sideways
    flyUp: 34,            // apex ~22 m — a real launch over the map
    flyTime: 3.4,         // seconds the kicked bin tumbles before scoring
    bounce: 0.45,         // ground bounce damping on landing
    spinRate: 7,          // tumble speed (rad/s) while flying
  },
  // Match start: everyone drops in under underwear parachutes.
  drop: {
    height: 32,           // spawn altitude for the chute descent
    fallSpeed: 5.5,       // capped descent speed under the chute
    sway: 1.4,            // gentle horizontal drift while descending
  },
  // Three lives. Death sends you to a balcony ring riding the zone wall;
  // after the timer you re-drop. Balcony snipers fire pinning slime.
  lives: 3,
  balcony: {
    time: 30,             // seconds spent on the balcony before re-drop
    height: 30,           // above the 26 m zone wall — it slides underneath
    radius: 45,           // FIXED — the platform never deforms with the zone
    platforms: 3,         // separate arc platforms around the ring
    span: 0.34,           // arc length of each platform (radians)
    width: 4,             // walkable depth inwards (m)
    angVel: 0,            // static platforms — nothing moves or deforms
    walkSpeed: 2.6,       // movement along the ring (m/s tangential)
    cannons: [0.07, 0.26],// cannon angle offsets inside each arc
    mountRange: 1.8,      // E to mount within this distance
    botSnipeRange: 65,    // bots plink slime at runners within this range
    botAimSpread: 0.09,   // radians of scatter on bot slime shots
  },
  slime: {
    speed: 100,
    gravity: 1,           // nearly flat — flies through the crosshair
    radius: 0.4,
    ttl: 4,
    cooldown: 0.9,
    pinTime: 2.5,         // seconds the victim is glued in place
  },
  zone: {
    cx: 0, cz: 0,
    startRadius: 92,
    endRadius: 9,
    shrinkDelay: 8,       // seconds before the circle starts shrinking
    shrinkTime: 80,       // seconds from startRadius to endRadius
    dpsStart: 4,
    dpsEnd: 18,
  },
  lobby: {
    slots: 11,          // humans + bots total; bots fill the rest
    startDelay: 60,     // match starts N seconds after the first player joins
    snapHz: 12,         // host -> clients snapshot rate
    inputHz: 30,        // client -> host input rate
  },
  bots: {
    count: 10,
    maxHp: 100,
    walkSpeed: 7.5,
    aggroRange: 45,       // start tracking enemies inside this range
    fireRange: 32,        // actually shoot inside this range
    junkRange: 13,        // closer than this: switch to the junk shotgun
    engageNear: 8,        // back off if an enemy is closer than this
    engageFar: 20,        // close in if an enemy is farther than this
    toastHp: 0.7,         // grab a toast slice when hp below this fraction
    toastRange: 15,       // how far a bot smells toast pickups
    fireInterval: [0.7, 1.4],
    fireCooldown: 0.8,    // min seconds between bot shots
    aimSpread: 0.07,
    thinkInterval: [0.7, 1.8],
  },
  sim: {
    dt: 1 / 60,           // fixed timestep
    maxSteps: 6,          // per rendered frame
  },
};
