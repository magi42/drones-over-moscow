/// <reference types="vite/client" />

import type { useGameStore } from './store/gameStore'

declare global {
  interface Window {
    __DOM_GAME__?: typeof useGameStore
  }
}
