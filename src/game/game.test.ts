import { beforeEach, describe, expect, it } from 'vitest'
import { ROUTES, SCORE_VALUES } from './config'
import { actionForCode, DEFAULT_BINDINGS, readableKey } from './input'
import { pointOnFlightArc, requiredFlightArc } from './flightPath'
import { sampleMissileTrajectory, type MissileTrajectory } from './missile'
import { mulberry32 } from './random'
import {
  REPLACEMENT_JOIN_DISTANCE,
  replacementTravelDistance,
} from './replacement'
import { scoreEvent, survivorBonus } from './scoring'
import { useGameStore } from '../store/gameStore'
import { lidBuildingCollision } from '../scene/GameWorld'
import * as THREE from 'three'

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

  it('lets a replacement catch and join a fleet slot moving forward', () => {
    const delta = 1 / 60
    const fleetSpeed = 3.05
    let slotPosition = 0
    let replacementPosition = 38

    for (let frame = 0; frame < 10 * 60; frame += 1) {
      slotPosition -= fleetSpeed * delta
      const distance = Math.abs(replacementPosition - slotPosition)
      replacementPosition -= replacementTravelDistance(distance, delta)
      if (
        Math.abs(replacementPosition - slotPosition) <
        REPLACEMENT_JOIN_DISTANCE
      ) {
        break
      }
    }

    expect(Math.abs(replacementPosition - slotPosition)).toBeLessThan(
      REPLACEMENT_JOIN_DISTANCE,
    )
  })

  it('arches a strike flight above a building in its corridor', () => {
    const start = { x: 0, y: 10, z: 20 }
    const target = { x: 0, y: 3, z: -20 }
    const building = {
      position: [0, 7, 0] as const,
      scale: [12, 20, 9] as const,
    }
    const arcHeight = requiredFlightArc(start, target, [building], null)
    const midpoint = pointOnFlightArc(start, target, 0.5, arcHeight)

    expect(arcHeight).toBeGreaterThan(0)
    expect(midpoint.y).toBeGreaterThanOrEqual(24)
  })

  it('keeps a direct flight when buildings are outside its corridor', () => {
    const arcHeight = requiredFlightArc(
      { x: 0, y: 10, z: 20 },
      { x: 0, y: 3, z: -20 },
      [
        {
          position: [40, 7, 0],
          scale: [12, 20, 9],
        },
      ],
      null,
    )

    expect(arcHeight).toBe(0)
  })

  it('detects a flying oil-tank lid striking an apartment building', () => {
    const buildings = [
      {
        position: [0, 7, 0] as [number, number, number],
        scale: [12, 20, 9] as [number, number, number],
        color: '#ffffff',
        apartmentBlock: true,
        rotation: 0,
      },
    ]

    expect(
      lidBuildingCollision(new THREE.Vector3(8, 10, 0), buildings),
    ).toBe(0)
    expect(
      lidBuildingCollision(new THREE.Vector3(20, 10, 0), buildings),
    ).toBeNull()
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
      totalDrones: 16,
      launchesRemaining: 16,
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
    expect(useGameStore.getState().launchDrone()).toEqual({
      accepted: true,
      replacementAvailable: true,
      remaining: 15,
    })
    expect(useGameStore.getState().loseControlledDrone()).toBe(3)
    expect(useGameStore.getState().totalDrones).toBe(14)
    useGameStore.getState().togglePause()
    expect(useGameStore.getState().paused).toBe(true)
  })

  it('allows exactly the full 16-drone inventory to be launched', () => {
    const launches = Array.from({ length: 16 }, () =>
      useGameStore.getState().launchDrone(),
    )
    expect(launches.at(-1)).toEqual({
      accepted: true,
      replacementAvailable: false,
      remaining: 0,
    })
    expect(useGameStore.getState().launchDrone()).toEqual({
      accepted: false,
      replacementAvailable: false,
      remaining: 0,
    })
    expect(useGameStore.getState()).toMatchObject({
      totalDrones: 0,
      launchesRemaining: 0,
      survivors: 0,
    })
  })
})
