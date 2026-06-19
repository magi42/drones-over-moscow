# Drones Over Moscow

A stylized browser arcade vertical slice built with React, React Three Fiber,
Three.js, Rapier, and Zustand.

## Preview

https://magi.fi/ohjelmointi/games/drones-over-moscow/

## Run locally

```bash
npm install
npm run dev
```

Use WASD or a gamepad left stick to steer the formation. Click a rooftop
air-defense station or oil tank to detach one drone; it automatically
accelerates to the selected target while the player continues guiding the
fleet. Striking an oil tank triggers its explosion and launches its roof. The
camera always stays locked to the fleet and does not follow attack drones.
A successful strike on a rooftop air-defense station replenishes the
formation. Ukraine is the only enabled launch corridor in the first phase, and
the aircraft use an FP-1-inspired fixed-wing silhouette. Press Escape to pause.
The looping soundtrack begins on the operator screen. The run lasts 72 seconds;
crossing checkpoints and baiting defensive fire builds score.

## Verification

```bash
npm test
npm run build
npm run test:e2e -- --project=chromium
```

Install Playwright browsers with `npx playwright install` before running all
three configured browser projects.

## Architecture

- React owns phase screens, HUD, settings, and results.
- Zustand owns coarse game state and persisted preferences.
- React Three Fiber owns rendering and the frame loop.
- The flight simulation advances at a fixed 60 Hz.
- Rapier handles detached oil-tank roofs and significant debris.
- Buildings are instanced; missiles are maintained in a reusable pool.

The geography, routes, defense behavior, and scenario are fictionalized and
intentionally presented in an exaggerated low-poly style.
