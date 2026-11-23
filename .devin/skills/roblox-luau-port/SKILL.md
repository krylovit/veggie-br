---
name: roblox-luau-port
description: Port the Veggie Battle Royale prototype logic to Roblox Luau and connect to Roblox Studio via its built-in MCP server
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Roblox Studio MCP server

This project's MCP config lives in `.devin/mcp_config.json`. The `Roblox_Studio`
entry points at Studio's **built-in** MCP server (`%LOCALAPPDATA%\Roblox\mcp.bat`
on Windows) and is **disabled by default**.

To activate it:

1. Install Roblox Studio, sign in, open a place.
2. In Studio: Assistant → `…` → **Manage MCP Servers** → enable
   **Studio as MCP server** (this creates `%LOCALAPPDATA%\Roblox\mcp.bat`).
3. In Devin CLI: run `devin mcp enable Roblox_Studio` (or set `"disabled": false`
   in `.devin/mcp_config.json`) and restart the session.
4. Verify: `list_roblox_studios` should show the open Studio instance; pass its
   `studio_id` to subsequent tools when more than one instance is open.

Useful tools once connected: `script_read`, `multi_edit`, `script_search`,
`script_grep`, `insert_asset`, `run_code` (execute Luau in the session),
`start_playtest`/`stop_playtest`, `list_roblox_studios`.
Docs: https://create.roblox.com/docs/studio/mcp

# Porting the prototype to Luau

The game logic in `src/logic/` is engine-free on purpose. Port it 1:1:

| JS (src/logic/)        | Roblox/Luau equivalent                                        |
|------------------------|---------------------------------------------------------------|
| `vec3.js` {x,y,z} fns  | `Vector3` (or keep plain-table math for deterministic logic)   |
| `config.js`            | a `Config` ModuleScript in ReplicatedStorage                   |
| `raycast.js` segment-sphere | `workspace:Spherecast`/`workspace:Raycast` per Heartbeat step |
| `world.js` `step()`    | server Script loop on `RunService.Heartbeat` (fixed dt)        |
| `weapon.js` VeggieLauncher | Tool + server Script; projectile = Part or pure-logic point |
| `bots.js`              | server Script driving NPC Humanoids (or pure-logic dummies)    |
| `zone.js`              | shrinking cylinder Part + server damage tick                   |

Rules that keep the port easy:

- Logic files must never import `three` or touch the DOM/canvas.
- Entities are plain data: `{pos={x,y,z}, vel, hp, alive, ...}` — no meshes,
  no class instances with hidden state.
- All hit detection is `segmentSphere`/`segmentGround` on the segment
  `prevPos -> newPos` per fixed step (swept hitscan). In Luau replace with
  `workspace:Spherecast(start, radius, delta)`.
- One fixed-timestep `step(state, input, dt)` mutates a JSON-serializable
  `state`. In Roblox the server owns this state; clients send inputs via
  RemoteEvents, the server replicates snapshots.
- All tuning numbers live in `config.js` so the Luau `Config` module is a
  mechanical translation.
