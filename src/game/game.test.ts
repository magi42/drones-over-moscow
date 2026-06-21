import { beforeEach, describe, expect, it } from 'vitest'
import { ROUTES, SCORE_VALUES, TOTAL_DRONE_INVENTORY } from './config'
import { actionForCode, DEFAULT_BINDINGS, readableKey } from './input'
import {
  BUILDING_RENDER_ROW_COUNT,
  FLEET_FORWARD_SPEED,
  buildingWindowStartRow,
  isBuildingRowVisible,
  stationIndicesByRowBand,
} from './buildingVisibility'
import { protectedBuildingIndices } from './buildingProtection'
import { pointOnFlightArc, requiredFlightArc } from './flightPath'
import {
  isPersonJumpWindow,
  rooftopPersonEdgePlacement,
} from './rooftopPerson'
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
    const fleetSpeed = FLEET_FORWARD_SPEED
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
        storeyCount: 10 as const,
        color: '#ffffff',
        apartmentBlock: true,
        rotation: 0,
        row: 3,
        person: null,
      },
    ]

    expect(
      lidBuildingCollision(new THREE.Vector3(8, 10, 0), buildings),
    ).toBe(0)
    expect(
      lidBuildingCollision(new THREE.Vector3(20, 10, 0), buildings),
    ).toBeNull()
  })

  it('keeps exactly ten rows of apartment models in the moving window', () => {
    const startRow = buildingWindowStartRow(-37)

    expect(startRow).toBe(3)
    expect(isBuildingRowVisible(3, startRow)).toBe(true)
    expect(
      isBuildingRowVisible(
        startRow + BUILDING_RENDER_ROW_COUNT - 1,
        startRow,
      ),
    ).toBe(true)
    expect(
      isBuildingRowVisible(startRow + BUILDING_RENDER_ROW_COUNT, startRow),
    ).toBe(false)
    expect(isBuildingRowVisible(startRow - 1, startRow)).toBe(false)
  })

  it('selects four air-defense stations from each ten-row band', () => {
    const rows = [
      3, 4, 5, 6, 7,
      10, 11, 12, 13, 14,
      20, 21, 22, 23, 24,
    ]
    const indices = stationIndicesByRowBand(rows)

    expect(indices).toHaveLength(12)
    expect(indices.map((index) => Math.floor(rows[index] / 10))).toEqual([
      0, 0, 0, 0,
      1, 1, 1, 1,
      2, 2, 2, 2,
    ])
  })

  it('allows rooftop jumps only two to four rows ahead', () => {
    expect(isPersonJumpWindow(8, 4, 4)).toBe(true)
    expect(isPersonJumpWindow(8, 5, 3)).toBe(true)
    expect(isPersonJumpWindow(8, 6, 2)).toBe(true)
    expect(isPersonJumpWindow(8, 3, 4)).toBe(false)
    expect(isPersonJumpWindow(8, 7, 2)).toBe(false)
  })

  it('places people on the player-facing or center-facing edge', () => {
    expect(rooftopPersonEdgePlacement('player', 24, 13.4, 9, 0)).toEqual({
      offset: [0, 4.2],
      direction: [0, 2.2],
    })
    expect(rooftopPersonEdgePlacement('center', 24, 13.4, 9, 0)).toEqual({
      offset: [-6.4, 0],
      direction: [-2.2, 0],
    })
    expect(rooftopPersonEdgePlacement('center', -24, 13.4, 9, 0)).toEqual({
      offset: [6.4, 0],
      direction: [2.2, 0],
    })
  })

  it('protects station and occupied buildings from missile impacts', () => {
    const protectedIndices = protectedBuildingIndices(
      [1, 5],
      [true, true, false, true, false, false],
    )

    expect([...protectedIndices].sort((a, b) => a - b)).toEqual([
      0, 1, 3, 5,
    ])
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
      totalDrones: TOTAL_DRONE_INVENTORY,
      launchesRemaining: TOTAL_DRONE_INVENTORY,
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
      remaining: TOTAL_DRONE_INVENTORY - 1,
    })
    expect(useGameStore.getState().loseControlledDrone()).toBe(3)
    expect(useGameStore.getState().totalDrones).toBe(
      TOTAL_DRONE_INVENTORY - 2,
    )
    useGameStore.getState().togglePause()
    expect(useGameStore.getState().paused).toBe(true)
  })

  it('allows exactly one launch for every target in the game', () => {
    const launches = Array.from({ length: TOTAL_DRONE_INVENTORY }, () =>
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

  it('restarts the current route and returns directly to the main screen', () => {
    useGameStore.setState({
      phase: 'results',
      route: 'ukraine',
      score: 4200,
      survivors: 1,
      launchesRemaining: 3,
      totalDrones: 3,
      paused: true,
      settingsOpen: true,
    })

    useGameStore.getState().restartRun()
    expect(useGameStore.getState()).toMatchObject({
      phase: 'flyover',
      route: 'ukraine',
      score: 0,
      survivors: 4,
      launchesRemaining: TOTAL_DRONE_INVENTORY,
      paused: false,
      settingsOpen: false,
    })

    useGameStore.getState().returnToMain()
    expect(useGameStore.getState()).toMatchObject({
      phase: 'operator',
      route: null,
      score: 0,
      survivors: 4,
      launchesRemaining: TOTAL_DRONE_INVENTORY,
      paused: false,
    })
  })
})
