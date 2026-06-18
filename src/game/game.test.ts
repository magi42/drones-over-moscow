import { beforeEach, describe, expect, it } from 'vitest'
import { ROUTES, SCORE_VALUES } from './config'
import { actionForCode, DEFAULT_BINDINGS, readableKey } from './input'
import { sampleMissileTrajectory, type MissileTrajectory } from './missile'
import { mulberry32 } from './random'
import { scoreEvent, survivorBonus } from './scoring'
import { useGameStore } from '../store/gameStore'

describe('route and scoring rules', () => {
  it('applies each route multiplier', () => {
    expect(scoreEvent('checkpoint', 'finland')).toBe(
      Math.round(SCORE_VALUES.checkpoint * ROUTES.finland.scoreMultiplier),
    )
    expect(scoreEvent('oilTank', 'ukraine')).toBe(975)
    expect(scoreEvent('airDefense', 'estonia')).toBe(1100)
  })

  it('awards survivor bonuses and rejects negative survivors', () => {
    expect(survivorBonus(4, 'estonia')).toBe(4800)
    expect(survivorBonus(-2, 'latvia')).toBe(0)
  })
})

describe('input mapping', () => {
  it('maps configurable key codes to actions', () => {
    expect(actionForCode('KeyA', DEFAULT_BINDINGS)).toBe('left')
    expect(actionForCode('Escape', DEFAULT_BINDINGS)).toBe('pause')
    expect(actionForCode('Space', DEFAULT_BINDINGS)).toBeNull()
    expect(actionForCode('Enter', DEFAULT_BINDINGS)).toBeNull()
    expect(readableKey('ArrowLeft')).toBe('Arrow Left')
  })
})

describe('deterministic simulation helpers', () => {
  it('repeats a seeded random sequence', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('follows one trajectory and lands exactly on its endpoint', () => {
    const trajectory: MissileTrajectory = {
      start: { x: 0, y: 0, z: 0 },
      controlA: { x: 4, y: 10, z: 4 },
      controlB: { x: -3, y: 8, z: 16 },
      end: { x: 10, y: 2, z: 20 },
      duration: 4,
      wobble: 1.2,
    }
    const middle = sampleMissileTrajectory(trajectory, 2)
    const impact = sampleMissileTrajectory(trajectory, 4)
    expect(middle.position.y).toBeGreaterThan(trajectory.end.y)
    expect(impact.position).toEqual(trajectory.end)
    expect(impact.complete).toBe(true)
  })
})

describe('game state machine', () => {
  beforeEach(() => {
    useGameStore.setState({
      phase: 'boot',
      route: null,
      score: 0,
      bestScore: 0,
      survivors: 4,
      runSeed: 1,
      paused: false,
      runWon: false,
      settingsOpen: false,
    })
  })

  it('moves from boot through launch and results', () => {
    const state = useGameStore.getState()
    state.advance()
    expect(useGameStore.getState().phase).toBe('operator')
    useGameStore.getState().advance()
    expect(useGameStore.getState().phase).toBe('countrySelect')
    useGameStore.getState().selectRoute('latvia')
    expect(useGameStore.getState().phase).toBe('briefing')
    useGameStore.getState().startRun()
    expect(useGameStore.getState().phase).toBe('flyover')
    useGameStore.getState().addScore('checkpoint')
    useGameStore.getState().finishRun(true)
    expect(useGameStore.getState()).toMatchObject({
      phase: 'results',
      runWon: true,
      survivors: 4,
    })
  })

  it('supports drone loss and pause', () => {
    expect(useGameStore.getState().loseDrone()).toBe(3)
    useGameStore.getState().replenishFleet()
    expect(useGameStore.getState().survivors).toBe(4)
    useGameStore.getState().togglePause()
    expect(useGameStore.getState().paused).toBe(true)
  })
})
