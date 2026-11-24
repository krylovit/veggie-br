// All tuning constants live here — the Luau Config module is a
// mechanical translation of this table.
export const CONFIG = {
  world: {
    size: 384,            // two ~170 m sectors + margins
    seed: 1337,
    // Named districts, each built around its centre point and joined by
    // the east-west highway. Sectors share drop/loot placement.
    sectors: [
      { x: -92, z: 0, kind: 'city' },
      { x: 92, z: 0, kind: 'farm' },
      { x: 0, z: -135, kind: 'park' },   // amusement park in the north wilds
    ],
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
    crates: 26,         // crates scattered around the map at match start
    indoorShare: 0.65,  // fraction tucked inside buildings — go loot-hunting
    openRange: 2.4,     // E distance to pop the lid
    botLootRange: 300,  // an unarmed bot walks to a crate within this range
    botLootTime: 1.6,   // seconds a bot stands at the lid prying it open
    consolationHp: 12,  // already own the rolled gun? heal instead
    vegOdds: 0.6,       // chance the crate holds the veggie launcher
  },
  // Infection mode (test): a hatch in the map centre + a big red button
  // on the field. Players press the button, the hatch bursts open and a
  // wave of zombies hops out. One bite converts you — you keep your
  // lives, but now you hunt your former friends. Death cures.
  zombies: {
    waveSize: 6,           // zombies per button press
    spawnGap: 0.55,        // seconds between zombies popping out
    hp: 45,
    speed: 8.4,            // a bit faster than a walking player — still outrunnable in a sprint
    biteRange: 1.7,
    biteCooldown: 0.8,
    hopOut: 7,             // launch velocity bursting from the hatch
    hatchPos: { x: -92, z: 0 },    // middle of the city plaza
    buttonPos: { x: -83, z: -9 },  // on the plaza edge, next to the hatch
    pressRange: 2.8,
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
    startRadius: 290,     // beyond the map edge — the wall is off-world
    // PUBG-style schedule: hold `wait` seconds at the current radius,
    // then shrink to `to` over `dur` seconds at `dps` damage.
    phases: [
      { wait: 120, to: 170, dur: 60, dps: 4 },
      { wait: 75,  to: 100, dur: 50, dps: 8 },
      { wait: 60,  to: 55,  dur: 40, dps: 11 },
      { wait: 45,  to: 28,  dur: 30, dps: 14 },
      { wait: 40,  to: 12,  dur: 25, dps: 18 },
      { wait: 45,  to: 5,   dur: 35, dps: 22 },
    ],
  },
  // Drivable cars parked on the roads. E to board, WASD drives, E/Space
  // to bail out. Hard crashes throw you out at half HP; a fast car is
  // a lethal weapon — run something over and it's gone.
  cars: {
    count: 5,
    maxSpeed: 20,
    accel: 14,
    brake: 24,
    drag: 0.7,          // fraction of speed bled per second
    turnRate: 1.8,      // rad/s at speed
    radius: 1.7,        // collision circle
    enterRange: 3,
    hp: 120,
    crashSpeed: 9,      // wall hits faster than this eject the driver
    crashDmg: 50,       // ejection costs half a health bar
    runoverSpeed: 6,    // entities die when hit faster than this
    ejectUp: 9,
  },
  // The amusement-park coaster: a rail loop with carts that run on
  // gravity — they crawl up the lift hill and rocket back down.
  coaster: {
    carts: 3,
    boardRange: 3.2,
    gravity: 16,        // slope acceleration along the track
    minSpeed: 3,        // chain-lift keeps carts moving
    maxSpeed: 26,
    stationLen: 10,     // s-window around the station where brakes bite
    stationSpeed: 2.2,  // crawl through the platform — boarding window
    // closed loop around the park: {x, z, h} waypoints, h = rail top.
    // Minecraft-style: every segment is straight or a clean 45° bevel.
    track: [
      { x: -10, z: -110, h: 2.0 },   // station straight
      { x: 16,  z: -110, h: 2.3 },
      { x: 20,  z: -114, h: 2.8 },   // 45° bevel
      { x: 30,  z: -124, h: 4.5 },   // 45° diagonal climb
      { x: 30,  z: -160, h: 10.5 },  // long straight lift — the crest
      { x: 24,  z: -166, h: 10.3 },  // 45° bevel
      { x: -24, z: -166, h: 6.5 },   // first drop heading west — straight
      { x: -34, z: -156, h: 5.0 },   // 45° diagonal south-west
      { x: -34, z: -138, h: 5.8 },   // south straight — camelback
      { x: -34, z: -124, h: 3.8 },   // drop again
      { x: -30, z: -120, h: 3.0 },   // 45° bevel
      { x: -30, z: -114, h: 2.6 },   // straight south
      { x: -26, z: -110, h: 2.2 },   // 45° bevel into the station
    ],
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
