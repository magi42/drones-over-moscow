import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BINDINGS, type KeyBindings } from '../game/input'
import { scoreEvent, survivorBonus, type ScoreEvent } from '../game/scoring'
import { TOTAL_DRONE_INVENTORY, type RouteId } from '../game/config'

export type GamePhase =
  | 'boot'
  | 'operator'
  | 'countrySelect'
  | 'briefing'
  | 'flyover'
  | 'results'

type Settings = {
  masterVolume: number
  reducedEffects: boolean
  bindings: KeyBindings
}

type GameState = {
  phase: GamePhase
  route: RouteId | null
  score: number
  bestScore: number
  survivors: number
  totalDrones: number
  launchesRemaining: number
  runSeed: number
  paused: boolean
  runWon: boolean
  settingsOpen: boolean
  settings: Settings
  advance: () => void
  selectRoute: (route: RouteId) => void
  startRun: () => void
  addScore: (event: ScoreEvent) => void
  launchDrone: () => {
    accepted: boolean
    replacementAvailable: boolean
    remaining: number
  }
  loseControlledDrone: () => number
  finishRun: (won: boolean) => void
  togglePause: () => void
  setSettingsOpen: (open: boolean) => void
  updateSettings: (settings: Partial<Settings>) => void
  updateBinding: (action: keyof KeyBindings, code: string) => void
  restart: () => void
}

const nextPhase: Partial<Record<GamePhase, GamePhase>> = {
  boot: 'operator',
  operator: 'countrySelect',
  countrySelect: 'briefing',
  briefing: 'flyover',
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      phase: 'boot',
      route: null,
      score: 0,
      bestScore: 0,
      survivors: 4,
      totalDrones: TOTAL_DRONE_INVENTORY,
      launchesRemaining: TOTAL_DRONE_INVENTORY,
      runSeed: 1,
      paused: false,
      runWon: false,
      settingsOpen: false,
      settings: {
        masterVolume: 0.65,
        reducedEffects: false,
        bindings: DEFAULT_BINDINGS,
      },
      advance: () =>
        set((state) => ({
          phase: nextPhase[state.phase] ?? state.phase,
        })),
      selectRoute: (route) => set({ route, phase: 'briefing' }),
      startRun: () =>
        set({
          phase: 'flyover',
          score: 0,
          survivors: 4,
          totalDrones: TOTAL_DRONE_INVENTORY,
          launchesRemaining: TOTAL_DRONE_INVENTORY,
          runSeed: Date.now(),
          paused: false,
          runWon: false,
        }),
      addScore: (event) => {
        const route = get().route
        if (!route) return
        set((state) => ({ score: state.score + scoreEvent(event, route) }))
      },
      launchDrone: () => {
        const state = get()
        if (state.launchesRemaining <= 0) {
          return {
            accepted: false,
            replacementAvailable: false,
            remaining: 0,
          }
        }
        const replacementAvailable = state.launchesRemaining > 4
        const remaining = state.launchesRemaining - 1
        set({
          launchesRemaining: remaining,
          totalDrones: remaining,
          survivors: replacementAvailable
            ? state.survivors
            : Math.max(0, state.survivors - 1),
        })
        return { accepted: true, replacementAvailable, remaining }
      },
      loseControlledDrone: () => {
        const survivors = Math.max(0, get().survivors - 1)
        const totalDrones = Math.max(0, get().totalDrones - 1)
        set({ survivors, totalDrones })
        return survivors
      },
      finishRun: (won) => {
        const state = get()
        const finalScore =
          state.score +
          (state.route ? survivorBonus(state.survivors, state.route) : 0)
        set({
          phase: 'results',
          runWon: won,
          paused: false,
          score: finalScore,
          bestScore: Math.max(state.bestScore, finalScore),
        })
      },
      togglePause: () => set((state) => ({ paused: !state.paused })),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      updateSettings: (settings) =>
        set((state) => ({
          settings: { ...state.settings, ...settings },
        })),
      updateBinding: (action, code) =>
        set((state) => ({
          settings: {
            ...state.settings,
            bindings: { ...state.settings.bindings, [action]: code },
          },
        })),
      restart: () =>
        set({
          phase: 'operator',
          route: null,
          score: 0,
          survivors: 4,
          totalDrones: TOTAL_DRONE_INVENTORY,
          launchesRemaining: TOTAL_DRONE_INVENTORY,
          runSeed: 1,
          paused: false,
          runWon: false,
        }),
    }),
    {
      name: 'drones-over-moscow',
      merge: (persisted, current) => {
        const saved = persisted as Partial<GameState>
        return {
          ...current,
          ...saved,
          settings: {
            ...current.settings,
            ...saved.settings,
            bindings: {
              ...DEFAULT_BINDINGS,
              ...saved.settings?.bindings,
            },
          },
        }
      },
      partialize: (state) => ({
        bestScore: state.bestScore,
        settings: state.settings,
      }),
    },
  ),
)
