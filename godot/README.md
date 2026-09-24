# Drones Over Moscow — Godot

The native Godot 4 version of the game. It is an independent implementation
of the browser game, built for fast local play and iteration on Linux.

## Requirements

- Godot 4.7 or newer (Godot 4.7.1 from Flathub is supported)
- A Vulkan 1.0 or OpenGL 3.3 capable GPU

The project uses Godot's GL Compatibility renderer so it also runs on older
Linux graphics hardware.

## Run

With the Flathub installation, open the project editor from the repository
root with:

```bash
make -C godot open
```

Press **F5** in the editor to play. You can also launch the game directly:

```bash
make -C godot run
```

The equivalent command without Make is:

```bash
flatpak run org.godotengine.Godot --editor --path "$(pwd)/godot"
```

The Flatpak package has access to files under your home directory, so this
repository does not require an additional filesystem override.

Controls:

- **WASD**, arrow keys, or left stick: guide the formation
- **Mouse click**: detach a drone to attack an oil tank or air defense station
- **Escape**: pause or resume

Only the Ukraine corridor is enabled, matching the current web version. A run
lasts 72 seconds. Four aircraft fly in formation with twenty replacements in
reserve.

The native implementation currently includes:

- fixed-duration missions, checkpoints, survivor bonuses, and personal bests;
- clickable oil tanks and rooftop air-defense stations;
- queued attack orders and visible replacement aircraft;
- guided defensive missiles with swept collision checks and formation damage;
- fixed-step 60 Hz flight simulation matching the browser game timing;
- obstacle-clearing strike paths and whole-aircraft structure collisions;
- curved, physics-driven oil-tank roofs that can damage multiple buildings and
  aircraft, plus twin-tube rooftop defense launchers;
- growing pollution clouds with dark rain, blackened aircraft, and timed
  rooftop jumps with retreating companions;
- a full-route summer storm field, with live reduced-effects switching for
  weather, pollution detail, and physics debris;
- textured city scenery, randomized marked cross streets, and the shared
  oil-tank roof model from the web game;
- apartment roof equipment and persistent damaged remains for destroyed targets;
- a seeded 28-row city with 52 apartment blocks, 12 tanks, and 12 rooftop
  defenses, using the web version's Mulberry32 sequence and layout rules;
- a pulsing terminal boot sequence, native operator room, route map, mission
  briefing, and FP-1 blueprint display;
- a procedural overcast sky, layered explosions, HUD vignette, briefing
  scanlines, application metadata, and a native icon;
- background music and synthesized propeller-engine audio;
- persistent volume, reduced-effects, and keyboard-binding settings;
- keyboard, mouse, and controller flight input.

Godot currently renders the full city throughout a run. Keep this behavior
unless profiling shows that row culling is needed.

## Test

```bash
make -C godot test
make -C godot smoke
```

## Linux export

In Godot, open **Editor > Manage Export Templates**, install the templates for
Godot 4.7.1, then run:

```bash
make -C godot export-linux
```

The executable is written to `build/drones-over-moscow-godot.x86_64`, with
the bundled fonts' license texts in `build/licenses/`.

## Fonts

The interface bundles Barlow Condensed and IBM Plex Mono from the Google Fonts
repository. Both are distributed under the SIL Open Font License 1.1; their
license files are included beside the font files in `assets/fonts/`.

## Structure

- `scripts/main.gd` owns the mission screens, HUD, pause menu, and results.
- `scripts/flight_world.gd` owns procedural scenery, flight, attacks, missiles,
  camera movement, and target destruction.
- `scripts/game_state.gd` owns inventory and scoring rules.
- `scripts/web_random.gd` reproduces the browser game's seeded Mulberry32
  random-number sequence for deterministic city layouts.
- `scripts/route_map.gd` and `scripts/drone_blueprint.gd` draw the native
  mission-selection and briefing visuals.
- `assets/` contains native project copies of shared source assets.
