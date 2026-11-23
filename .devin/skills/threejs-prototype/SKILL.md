---
name: threejs-prototype
description: Conventions and commands for the Three.js Veggie Battle Royale prototype (run, test, architecture rules)
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Veggie Battle Royale — Three.js prototype

Battle-royale prototype in `D:\robloxBR`. Plain ES modules, no bundler.

## Run / verify

- Serve: `npx serve .` or `python -m http.server 8000` from `D:\robloxBR`,
  then open `http://localhost:8000`.
- Syntax check: `node --check <file>` for each `src/**/*.js` (all files are
  ES modules; `node --check` accepts ESM syntax for `.js` files here).
- Headless playtest uses `window.render_game_to_text()` and
  `window.advanceTime(ms)` — keep both implemented and working.

## Architecture (do not break)

- `src/logic/` — **pure game logic, no `three` imports, no DOM**. Everything
  is plain data + functions so it ports mechanically to Luau (see the
  `roblox-luau-port` skill). One fixed-timestep `step(state, input, dt)`.
- `src/view/` — Three.js rendering, camera, DOM HUD, and DOM input
  collection. Views read `state`; they never mutate it except through
  `step()`.
- `src/logic/config.js` holds **all** tuning constants — add new numbers
  there, not inline.
- Vectors in logic are plain `{x, y, z}` objects manipulated by the
  functions in `src/logic/vec3.js` (never `THREE.Vector3`).
- Hit detection = swept segment tests (`segmentSphere`, `segmentGround` in
  `src/logic/raycast.js`) evaluated inside `step()`. Do not use
  `THREE.Raycaster` for gameplay.

## Game facts

- First-person camera; WASD move (camera-relative), Space jump, Shift
  sprint, pointer-lock mouse-look, LMB fires. R restarts.
- Weapon «Овощемёт»: fires a RANDOM veggie each shot — uniform damage;
  tomato/cucumber/banana/broccoli/carrot/potato differ only visually.
- Map is a 1 m voxel grid: `buildMap()` emits `state.voxels` (render)
  + `state.obstacles` (grid-aligned AABBs for collision). Block sides
  are walls, tops are floors you can jump onto.
- ~7 bot capsules wander inside the shrinking zone and return fire.
- Zone circle shrinks over time; being outside drains HP. Last capsule
  standing wins.
