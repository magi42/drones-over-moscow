# Drones Over Moscow

A stylized arcade game. Each engine implementation lives in its own project
directory so they can be developed independently.

- [`web/`](web/README.md): the playable browser game, built with React,
  React Three Fiber, Three.js, Rapier, and Zustand.
- [`godot/`](godot/README.md): the native Godot 4 project for local Linux play.

## Run the web game

```bash
cd web
npm install
npm run dev
```

Live preview: https://magi.fi/ohjelmointi/games/drones-over-moscow/

## Verify and build

Run from `web/`:

```bash
npm test
npm run build
npm run test:e2e -- --project=chromium
```

The deployable site is generated in `web/dist/`. Configure web hosting with
`web/` as the project root, `npm run build` as the build command, and `dist/`
as the output directory relative to that root. From the repository root,
commands can also be run with `npm --prefix web run build` (or another script).

See the [web project documentation](web/README.md) for gameplay, architecture,
and release packaging.

## Run the Godot game

```bash
make -C godot run
```

See the [Godot project documentation](godot/README.md) for controls, tests, and
Linux export instructions.
