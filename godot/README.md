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

## Test

```bash
make -C godot test
make -C godot smoke
```

## Linux export

Install the matching Godot export templates, then run:

```bash
make -C godot export-linux
```

The executable is written to `build/drones-over-moscow-godot.x86_64`.

## Structure

- `scripts/main.gd` owns the mission screens, HUD, pause menu, and results.
- `scripts/flight_world.gd` owns procedural scenery, flight, attacks, missiles,
  camera movement, and target destruction.
- `scripts/game_state.gd` owns inventory and scoring rules.
- `assets/` contains native project copies of shared source assets.
