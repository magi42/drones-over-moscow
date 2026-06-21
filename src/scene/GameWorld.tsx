import { Sky, useGLTF, useTexture } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  CHECKPOINTS,
  ROUTES,
  RUN_DURATION_SECONDS,
} from '../game/config'
import { actionForCode } from '../game/input'
import { pointOnFlightArc, requiredFlightArc } from '../game/flightPath'
import { protectedBuildingIndices } from '../game/buildingProtection'
import {
  CITY_FIRST_ROW_Z,
  CITY_ROW_SPACING,
  FLEET_FORWARD_SPEED,
  availableJumpAheadRows,
  buildingWindowStartRow,
  cityRowForZ,
  isBuildingRowVisible,
  stationIndicesByRowBand,
} from '../game/buildingVisibility'
import { mulberry32 } from '../game/random'
import {
  REPLACEMENT_JOIN_DISTANCE,
  replacementTravelDistance,
} from '../game/replacement'
import {
  sampleMissileTrajectory,
  segmentPointDistanceSquared,
  type MissileTrajectory,
} from '../game/missile'
import { useGameStore } from '../store/gameStore'
import oilTankRoofUrl from '../assets/assets/models/oil_tank_roof_blowoff_flat.glb'
import groundTextureUrl from '../assets/assets/models/textures/texture-ground.jpg'
import {
  SimplifiedApartmentBlock,
  type RooftopPersonConfig,
} from './SimplifiedApartmentBlock'

type GameWorldProps = {
  onProgress: (progress: number) => void
  onAltitude: (altitude: number) => void
  onAttackMode: (active: boolean) => void
  onStations: (destroyed: number, total: number) => void
  onFleetSlots: (
    slots: Array<'ready' | 'refilling' | 'lost'>,
    queued: number,
  ) => void
}

type InputState = {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
}

const aircraftPartOffsets = [
  [0, 0, -2.35],
  [0, 0, 2.25],
  [-2.9, 0, -0.25],
  [2.9, 0, -0.25],
  [-1.05, 0.05, 1.45],
  [1.05, 0.05, 1.45],
  [0, -0.28, -0.65],
] as const

type StructureHit =
  | { kind: 'building'; index: number }
  | { kind: 'tank'; index: number }
  | { kind: 'station'; index: number }
  | { kind: 'lid'; index: number }

function aircraftPartsAt(
  group: THREE.Group,
  offset: readonly [number, number, number] = [0, 0, 0],
) {
  group.updateWorldMatrix(true, false)
  return aircraftPartOffsets.map(([x, y, z]) => {
    const local = new THREE.Vector3(x, y, z)
      .applyEuler(new THREE.Euler(0.08, 0, 0))
      .add(new THREE.Vector3(...offset))
    return group.localToWorld(local)
  })
}

function findStructureHit(
  parts: THREE.Vector3[],
  buildings: BuildingData[],
  damagedBuildings: BuildingDamage,
  tanks: TankData[],
  explodedTanks: Set<number>,
  stations: StationData[],
  destroyedStations: Set<number>,
  lidPositions: Map<number, THREE.Vector3>,
  excludedBuildingIndex: number | null = null,
) {
  const now = performance.now() / 1000
  for (const part of parts) {
    const buildingIndex = findBuildingCollision(
      part,
      buildings,
      damagedBuildings,
      now,
      0.12,
      excludedBuildingIndex,
    )
    if (buildingIndex !== null) {
      return { kind: 'building', index: buildingIndex } satisfies StructureHit
    }
    const tankIndex = tanks.findIndex((tank, index) => {
      if (explodedTanks.has(index)) return false
      const dx = part.x - tank.position[0]
      const dz = part.z - tank.position[2]
      return dx * dx + dz * dz <= 4.5 ** 2 && part.y >= -0.3 && part.y <= 4
    })
    if (tankIndex >= 0) {
      return { kind: 'tank', index: tankIndex } satisfies StructureHit
    }
    const stationIndex = stations.findIndex((station, index) => {
      if (destroyedStations.has(index)) return false
      const stationY =
        station.position[1] -
        buildingCollapseDrop(
          station.buildingIndex,
          buildings,
          damagedBuildings,
          now,
        )
      const dx = part.x - station.position[0]
      const dz = part.z - station.position[2]
      return (
        dx * dx + dz * dz <= 4 ** 2 &&
        part.y >= stationY - 5 &&
        part.y <= stationY + 4.8
      )
    })
    if (stationIndex >= 0) {
      return { kind: 'station', index: stationIndex } satisfies StructureHit
    }
    for (const [lidIndex, lidPosition] of lidPositions) {
      if (part.distanceTo(lidPosition) < 4.4) {
        return { kind: 'lid', index: lidIndex } satisfies StructureHit
      }
    }
  }
  return null
}

function isUnderBlackCloud(
  parts: THREE.Vector3[],
  cloudPositions: Map<number, THREE.Vector3>,
) {
  return parts.some((part) =>
    Array.from(cloudPositions.values()).some((cloud) => {
      const dx = part.x - cloud.x
      const dz = part.z - cloud.z
      return dx * dx + dz * dz < 11 ** 2 && part.y < cloud.y
    }),
  )
}

const droneOffsets: [number, number, number][] = [
  [0, 0, 0],
  [-4.4, -0.35, 2.4],
  [4.4, -0.35, 2.4],
  [0, -0.55, 5],
]

type BuildingData = {
  position: [number, number, number]
  scale: [number, number, number]
  storeyCount: 10 | 11 | 15
  color: string
  apartmentBlock: boolean
  rotation: number
  row: number
  person: RooftopPersonConfig | null
}

type StationData = {
  buildingIndex: number
  position: [number, number, number]
}

type TankData = {
  position: [number, number, number]
  row: number
}

type CityLayout = {
  buildings: BuildingData[]
  tanks: TankData[]
  stations: StationData[]
  crossRoads: number[]
}

type BuildingDamage = Map<number, number>

const BUILDING_COLLAPSE_SECONDS = 6

function buildingDamageProgress(
  buildingIndex: number,
  damage: BuildingDamage,
  now: number,
) {
  const hitAt = damage.get(buildingIndex)
  if (hitAt === undefined) return 0
  return THREE.MathUtils.clamp(
    (now - hitAt) / BUILDING_COLLAPSE_SECONDS,
    0,
    1,
  )
}

function buildingCollapseDrop(
  buildingIndex: number,
  buildings: BuildingData[],
  damage: BuildingDamage,
  now: number,
) {
  return (
    buildings[buildingIndex].scale[1] *
    (2 / 3) *
    buildingDamageProgress(buildingIndex, damage, now)
  )
}

function createCityLayout(seed: number): CityLayout {
  const random = mulberry32(seed)
  const columns = [-72, -48, -24, 0, 24, 48, 72]

  // Create 28x7 grid of cells and make them a flat list
  const cells = Array.from({ length: 28 }, (_, row) =>
    columns.map((x, column) => ({
      x,
      z: CITY_FIRST_ROW_Z - row * CITY_ROW_SPACING,
      row,
      column,
      // This will be used to randomize the order of cells for tank/building placement
      sort: random(),
    })),
  ).flat()

  // Randomly select 12 cells for tanks and 52 for buildings
  const availableCells = [...cells].sort((a, b) => a.sort - b.sort)
  const tankCells = availableCells.splice(0, 12)
  const buildingCount = 52
  const buildingCandidates = availableCells.filter((cell) => cell.row >= 3)
  const stationCount = 4 // Must be at most the buildings in each band
  const guaranteedStationCells = [0, 1, 2].flatMap((band) =>
    buildingCandidates
      .filter((cell) => Math.floor(cell.row / 10) === band)
      .slice(0, stationCount),
  )
  const guaranteedCellKeys = new Set(
    guaranteedStationCells.map((cell) => `${cell.row}:${cell.column}`),
  )
  const buildingCells = [
    ...guaranteedStationCells,
    ...buildingCandidates.filter(
      (cell) => !guaranteedCellKeys.has(`${cell.row}:${cell.column}`),
    ),
  ].slice(0, buildingCount)

  // Create building and tank data with random heights and rotations
  const upperBodyColors = ['#d94c4c', '#315fbd', '#d7a92f', '#4f8f59']
  const lowerBodyColors = ['#26334d', '#4a382f', '#2f493c', '#4b355b']
  const buildings = buildingCells.map((cell, buildingIndex) => {
    const storeyHeight = 1.6
    const basementHeight = 1.8
    const storeyRoll = random()
    const storeyCount: 10 | 11 | 15 =
      storeyRoll < 0.4 ? 10 : storeyRoll < 0.7 ? 11 : 15
    // Wall textures contain the basement below the stated storey count.
    const visibleHeight = basementHeight + storeyCount * storeyHeight
    const scale: [number, number, number] = [13.4, visibleHeight, 9]
    const rowTravelSeconds = CITY_ROW_SPACING / FLEET_FORWARD_SPEED
    const jumpAheadOptions = availableJumpAheadRows(cell.row)
    const person =
      buildingIndex % 2 === 0
        ? {
            edge:
              cell.x === 0 || random() < 0.5
                ? ('player' as const)
                : ('center' as const),
            jumpAheadRows:
              jumpAheadOptions[
                Math.floor(random() * jumpAheadOptions.length)
              ],
            jumpDelayWithinRow:
              rowTravelSeconds * (0.12 + random() * 0.72),
            upperColor:
              upperBodyColors[
                Math.floor(random() * upperBodyColors.length)
              ],
            lowerColor:
              lowerBodyColors[
                Math.floor(random() * lowerBodyColors.length)
              ],
            edgeOffset: (random() - 0.5) * 0.72,
            hasCompanions: random() < 0.75,
          }
        : null
    return {
      position: [
        cell.x,
        -3 + visibleHeight / 2,
        cell.z,
      ] as [number, number, number],
      scale,
      storeyCount,
      color: '#ffffff',
      apartmentBlock: true,
      rotation: random() > 0.5 ? Math.PI : 0,
      row: cell.row,
      person,
    }
  })
  const tanks = tankCells.map((cell) => ({
    position: [cell.x, 1.5, cell.z] as [number, number, number],
    row: cell.row,
  }))

  // Use 4 buildings in every 10-row band as air defense stations
  const stationIndices = stationIndicesByRowBand(
    buildings.map((building) => building.row),
    stationCount,
  )
  stationIndices.forEach((buildingIndex) => {
    buildings[buildingIndex].person = null
  })
  const stations = stationIndices.map((buildingIndex) => {
    const building = buildings[buildingIndex]
    return {
      buildingIndex,
      position: [
        building.position[0],
        building.position[1] + building.scale[1] / 2 + 0.42,
        building.position[2],
      ] as [number, number, number],
    }
  })
  const crossRoads: number[] = []
  let roadRow = 3 + Math.floor(random() * 3)
  while (roadRow < 28) {
    crossRoads.push(8 - roadRow * 15 + 7.5)
    roadRow += 1 + Math.floor(random() * 3)
  }

  return { buildings, tanks, stations, crossRoads }
}

export function collidesWithBuilding(
  position: THREE.Vector3,
  buildings: BuildingData[],
  damagedBuildings: BuildingDamage = new Map(),
  now = 0,
  radius = 1.1,
) {
  return findBuildingCollision(
    position,
    buildings,
    damagedBuildings,
    now,
    radius,
  ) !== null
}

export function lidBuildingCollision(
  position: THREE.Vector3,
  buildings: BuildingData[],
  damagedBuildings: BuildingDamage = new Map(),
  now = 0,
) {
  return findBuildingCollision(
    position,
    buildings,
    damagedBuildings,
    now,
    3.8,
  )
}

function findBuildingCollision(
  position: THREE.Vector3,
  buildings: BuildingData[],
  damagedBuildings: BuildingDamage,
  now: number,
  radius = 1.1,
  excludedIndex: number | null = null,
) {
  const index = buildings.findIndex((building, buildingIndex) => {
    if (buildingIndex === excludedIndex) return false
    const [x, y, z] = building.position
    const [width, originalHeight, depth] = building.scale
    const progress = buildingDamageProgress(
      buildingIndex,
      damagedBuildings,
      now,
    )
    const height = THREE.MathUtils.lerp(
      originalHeight,
      originalHeight / 3,
      progress,
    )
    const centerY = THREE.MathUtils.lerp(y, -3 + height / 2, progress)
    return (
      Math.abs(position.x - x) <= width / 2 + radius &&
      Math.abs(position.y - centerY) <= height / 2 + radius &&
      Math.abs(position.z - z) <= depth / 2 + radius
    )
  })
  return index >= 0 ? index : null
}

function useFlightInput() {
  const bindings = useGameStore((state) => state.settings.bindings)
  const input = useRef<InputState>({
    left: false,
    right: false,
    up: false,
    down: false,
  })

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      const action = actionForCode(event.code, bindings)
      if (!action || action === 'pause') return
      input.current[action] = pressed
    }
    const down = (event: KeyboardEvent) => setKey(event, true)
    const up = (event: KeyboardEvent) => setKey(event, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [bindings])

  return input
}

function Drone({
  offset,
  active,
  blackened = false,
}: {
  offset: [number, number, number]
  active: boolean
  blackened?: boolean
}) {
  if (!active) return null

  return (
    <group position={offset} rotation={[0.08, 0, 0]}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.22, 0.38, 3.8, 10]} />
        <meshStandardMaterial
          color={blackened ? '#161815' : '#d5d0b9'}
          emissive={blackened ? '#020202' : '#5d604f'}
          emissiveIntensity={blackened ? 0.02 : 0.14}
          roughness={0.62}
          metalness={0.18}
        />
      </mesh>
      <mesh position={[0, 0, -2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.38, 0.72, 10]} />
        <meshStandardMaterial color={blackened ? '#181a17' : '#e2dec9'} roughness={0.58} />
      </mesh>
      <mesh position={[0, 0, -0.25]} castShadow>
        <boxGeometry args={[5.8, 0.12, 0.72]} />
        <meshStandardMaterial color={blackened ? '#131512' : '#c9c5af'} roughness={0.66} metalness={0.16} />
      </mesh>
      <mesh position={[0, 0.05, 1.45]} castShadow>
        <boxGeometry args={[2.1, 0.1, 0.48]} />
        <meshStandardMaterial color={blackened ? '#171916' : '#b9b6a4'} roughness={0.68} />
      </mesh>
      <mesh position={[0, 0.46, 1.58]} rotation={[0.15, 0, 0]} castShadow>
        <boxGeometry args={[0.1, 0.9, 0.62]} />
        <meshStandardMaterial color={blackened ? '#10120f' : '#aaa795'} roughness={0.7} />
      </mesh>
      <group position={[0, 0, 2.02]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.24, 0.34, 10]} />
          <meshStandardMaterial color="#4b4d46" />
        </mesh>
        <mesh position={[0, 0, 0.2]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[1.45, 0.055, 0.1]} />
          <meshStandardMaterial color="#d8d5c5" transparent opacity={0.68} />
        </mesh>
      </group>
      <mesh position={[0, -0.28, -0.65]}>
        <boxGeometry args={[0.72, 0.34, 1.15]} />
        <meshStandardMaterial color={blackened ? '#090a09' : '#707467'} roughness={0.55} />
      </mesh>
    </group>
  )
}

const curvedRoofTemplates = new WeakMap<THREE.Object3D, THREE.Object3D>()

function curvedRoofTemplate(scene: THREE.Object3D) {
  const cached = curvedRoofTemplates.get(scene)
  if (cached) return cached

  const template = scene.clone(true)
  const radius = 4
  const curvature = 0.2
  const domeHeight = radius * curvature

  template.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry.clone()
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const x = positions.getX(vertex)
      const y = positions.getY(vertex)
      const normalizedRadiusSquared = (x * x + y * y) / (radius * radius)
      if (normalizedRadiusSquared < 1) {
        const ellipsoidHeight =
          domeHeight * Math.sqrt(1 - normalizedRadiusSquared)
        positions.setZ(vertex, positions.getZ(vertex) + ellipsoidHeight)
      }
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    object.geometry = geometry
    object.castShadow = true
    object.receiveShadow = true
  })
  curvedRoofTemplates.set(scene, template)
  return template
}

function OilTankRoofModel() {
  const { scene } = useGLTF(oilTankRoofUrl)
  const model = useMemo(
    () => curvedRoofTemplate(scene).clone(true),
    [scene],
  )

  return (
    <primitive
      object={model}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={1.06}
    />
  )
}

useGLTF.preload(oilTankRoofUrl)

function City({
  buildings: buildingData,
  damagedBuildings,
  crossRoads,
  buildingStartRow,
  paused,
}: {
  buildings: BuildingData[]
  damagedBuildings: BuildingDamage
  crossRoads: number[]
  buildingStartRow: number
  paused: boolean
}) {
  const { gl } = useThree()
  const groundTexture = useTexture(groundTextureUrl)
  useEffect(() => {
    groundTexture.colorSpace = THREE.SRGBColorSpace
    groundTexture.wrapS = THREE.RepeatWrapping
    groundTexture.wrapT = THREE.RepeatWrapping
    groundTexture.repeat.set(18, 14)
    groundTexture.anisotropy = Math.min(
      8,
      gl.capabilities.getMaxAnisotropy(),
    )
    groundTexture.needsUpdate = true
  }, [gl, groundTexture])
  const visibleBuildings = useMemo(
    () =>
      buildingData
        .map((building, index) => ({ building, index }))
        .filter(({ building }) =>
          isBuildingRowVisible(building.row, buildingStartRow),
        ),
    [buildingData, buildingStartRow],
  )

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, -190]} receiveShadow>
        <planeGeometry args={[340, 470]} />
        <meshStandardMaterial
          map={groundTexture}
          color="#b5bab4"
          roughness={1}
        />
      </mesh>
      {crossRoads.map((z, index) =>
        isBuildingRowVisible(cityRowForZ(z), buildingStartRow) ? (
        <group key={index}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.94, z]}>
            <planeGeometry args={[330, 6]} />
            <meshStandardMaterial color="#171a19" roughness={0.9} />
          </mesh>
          {Array.from({ length: 20 }, (_, marker) => (
            <mesh
              key={marker}
              position={[-152 + marker * 16, -2.88, z]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[5, 0.14]} />
              <meshBasicMaterial color="#d9b566" />
            </mesh>
          ))}
        </group>
        ) : null,
      )}
      {visibleBuildings.map(({ building, index }) => (
        <SimplifiedApartmentBlock
          key={`${building.position.join('-')}-${index}`}
          position={building.position}
          scale={building.scale}
          storeyCount={building.storeyCount}
          rotation={building.rotation}
          hitAt={damagedBuildings.get(index)}
          collapseSeconds={BUILDING_COLLAPSE_SECONDS}
          person={building.person}
          paused={paused}
          buildingRow={building.row}
          fleetRow={buildingStartRow}
        />
      ))}
    </group>
  )
}

function OilTank({
  index,
  position,
  exploded,
  targeted,
  onSelect,
  onLidPosition,
}: {
  index: number
  position: [number, number, number]
  exploded: boolean
  targeted: boolean
  onSelect: () => void
  onLidPosition: (index: number, position: THREE.Vector3 | null) => void
}) {
  return (
    <group
      position={position}
      onClick={(event) => {
        event.stopPropagation()
        if (!exploded) onSelect()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        if (!exploded) document.body.style.cursor = 'crosshair'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      <mesh position={[0, -1.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[4.3, 4.3, 6.2, 20]} />
        <meshStandardMaterial
          color={exploded ? '#4c4b45' : '#b7b9ae'}
          metalness={0.58}
          roughness={0.48}
        />
      </mesh>
      {!exploded && (
        <group position={[0, 1.93, 0]}>
          <OilTankRoofModel />
          <mesh position={[0, 1.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[5, 5.35, 32]} />
            <meshBasicMaterial
              color={targeted ? '#ffcf45' : '#ff7b35'}
              transparent
              opacity={targeted ? 0.95 : 0.42}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}
      {exploded && (
        <FlyingTankLid
          index={index}
          position={position}
          onPosition={onLidPosition}
        />
      )}
      {exploded && <Explosion />}
    </group>
  )
}

function FlyingTankLid({
  index,
  position,
  onPosition,
}: {
  index: number
  position: [number, number, number]
  onPosition: (index: number, position: THREE.Vector3 | null) => void
}) {
  const body = useRef<import('@react-three/rapier').RapierRigidBody>(null)

  useFrame(() => {
    if (!body.current) return
    const translation = body.current.translation()
    onPosition(
      index,
      new THREE.Vector3(translation.x, translation.y, translation.z),
    )
  })

  useEffect(
    () => () => {
      onPosition(index, null)
    },
    [index, onPosition],
  )

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      position={[0, 1.93, 0]}
      colliders="hull"
      mass={2}
      restitution={0.42}
      linearVelocity={[position[0] > 0 ? -7 : 7, 24, 3]}
      angularVelocity={[8, 4, 12]}
    >
      <OilTankRoofModel />
    </RigidBody>
  )
}

function Explosion() {
  const group = useRef<THREE.Group>(null)
  const born = useRef(0)
  useFrame((_, delta) => {
    born.current += delta
    if (!group.current) return
    const t = Math.min(born.current / 1.5, 1)
    group.current.scale.setScalar(1 + t * 5)
    group.current.rotation.y += delta * 1.8
    group.current.children.forEach((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      material.opacity = Math.max(0, 1 - t)
    })
  })
  return (
    <group ref={group}>
      <mesh><icosahedronGeometry args={[1.2, 1]} /><meshBasicMaterial color="#ffb12b" transparent /></mesh>
      <mesh scale={0.62}><icosahedronGeometry args={[1.2, 1]} /><meshBasicMaterial color="#fff0b3" transparent /></mesh>
    </group>
  )
}

function PollutionCloud({
  index,
  position,
  reducedEffects,
  onPosition,
}: {
  index: number
  position: [number, number, number]
  reducedEffects: boolean
  onPosition: (index: number, position: THREE.Vector3 | null) => void
}) {
  const cloud = useRef<THREE.Group>(null)
  const rain = useRef<THREE.InstancedMesh>(null)
  const age = useRef(0)
  const random = useMemo(() => mulberry32(17000 + index), [index])
  const cloudBlobs = useMemo(
    () =>
      Array.from({ length: reducedEffects ? 7 : 14 }, () => ({
        position: [
          (random() - 0.5) * 17,
          (random() - 0.5) * 4.5,
          (random() - 0.5) * 13,
        ] as [number, number, number],
        scale: [
          3.8 + random() * 4.8,
          1.7 + random() * 2.6,
          3.2 + random() * 4.4,
        ] as [number, number, number],
      })),
    [random, reducedEffects],
  )
  const rainDrops = useMemo(
    () =>
      Array.from({ length: reducedEffects ? 28 : 80 }, () => ({
        x: (random() - 0.5) * 18,
        y: random() * 22,
        z: (random() - 0.5) * 14,
        speed: 8 + random() * 11,
        length: 0.5 + random() * 1.2,
      })),
    [random, reducedEffects],
  )

  useFrame((_, delta) => {
    age.current += delta
    if (cloud.current) {
      const growth = Math.min(1, age.current / 4)
      cloud.current.scale.setScalar(0.15 + growth * 0.85)
      cloud.current.position.x += delta * 0.38
      onPosition(
        index,
        new THREE.Vector3(
          position[0] + cloud.current.position.x,
          23,
          position[2],
        ),
      )
    }
    if (!rain.current) return
    const transform = new THREE.Object3D()
    rainDrops.forEach((drop, dropIndex) => {
      const y = 21 - ((age.current * drop.speed + drop.y) % 25)
      transform.position.set(drop.x, y, drop.z)
      transform.scale.set(1, drop.length, 1)
      transform.updateMatrix()
      rain.current!.setMatrixAt(dropIndex, transform.matrix)
    })
    rain.current.instanceMatrix.needsUpdate = true
  })

  useEffect(
    () => () => {
      onPosition(index, null)
    },
    [index, onPosition],
  )

  return (
    <group position={[position[0], 0, position[2]]}>
      <group ref={cloud} position={[0, 23, 0]} scale={0.15}>
        {cloudBlobs.map((blob, blobIndex) => (
          <mesh key={blobIndex} position={blob.position} scale={blob.scale}>
            <icosahedronGeometry args={[1, 2]} />
            <meshStandardMaterial
              color="#070907"
              emissive="#020302"
              emissiveIntensity={0.25}
              roughness={1}
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
      <instancedMesh
        ref={rain}
        args={[undefined, undefined, rainDrops.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.025, 0.045, 1, 4]} />
        <meshBasicMaterial
          color="#090b09"
          transparent
          opacity={0.78}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  )
}

function AirDefenseStation({
  position,
  buildingIndex,
  buildings,
  damagedBuildings,
  destroyed,
  targeted,
  onSelect,
}: {
  position: [number, number, number]
  buildingIndex: number
  buildings: BuildingData[]
  damagedBuildings: BuildingDamage
  destroyed: boolean
  targeted: boolean
  onSelect: () => void
}) {
  const group = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!group.current) return
    group.current.position.y =
      position[1] -
      buildingCollapseDrop(
        buildingIndex,
        buildings,
        damagedBuildings,
        performance.now() / 1000,
      )
  })

  return (
    <group
      ref={group}
      position={position}
      onClick={(event) => {
        event.stopPropagation()
        if (!destroyed) onSelect()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        if (!destroyed) document.body.style.cursor = 'crosshair'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      {!destroyed && (
        <mesh position={[0, -2.3, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[2.35, 2.7, 5.4, 12]} />
          <meshStandardMaterial
            color="#687361"
            metalness={0.28}
            roughness={0.72}
          />
        </mesh>
      )}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[3.3, 3.8, 0.8, 10]} />
        <meshStandardMaterial color={destroyed ? '#292723' : '#596451'} roughness={0.82} />
      </mesh>
      {!destroyed && (
        <>
          <mesh position={[0, 1, 0]} castShadow>
            <boxGeometry args={[3.2, 1.3, 3.8]} />
            <meshStandardMaterial color="#75806c" metalness={0.35} roughness={0.64} />
          </mesh>
          <group position={[0, 2.25, 0]} rotation={[0.52, 0, 0]}>
            {[-0.7, 0.7].map((x) => (
              <mesh key={x} position={[x, 0, 0]} castShadow>
                <cylinderGeometry args={[0.22, 0.3, 3.8, 8]} />
                <meshStandardMaterial color="#d4d0b4" metalness={0.52} roughness={0.42} />
              </mesh>
            ))}
          </group>
          <mesh position={[0, 2.2, -1.6]}>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            <meshStandardMaterial
              color="#ffd84a"
              emissive="#ffd84a"
              emissiveIntensity={1.15}
            />
          </mesh>
          <mesh position={[0, 4.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[3.7, 4, 32]} />
            <meshBasicMaterial
              color={targeted ? '#ffcf45' : '#ff5b35'}
              transparent
              opacity={targeted ? 0.95 : 0.5}
              side={THREE.DoubleSide}
            />
          </mesh>
        </>
      )}
      {destroyed && <Explosion />}
    </group>
  )
}

function Missiles({
  target,
  active,
  intensity,
  destroyedStations,
  destroyedTanks,
  onImpact,
  buildings: buildingData,
  stations: stationData,
  tanks: tankData,
  damagedBuildings,
  activeFleetSlots,
  onFleetHit,
}: {
  target: React.RefObject<THREE.Group | null>
  active: boolean
  intensity: number
  destroyedStations: Set<number>
  destroyedTanks: Set<number>
  onImpact: (impact: MissileImpact) => void
  buildings: BuildingData[]
  stations: StationData[]
  tanks: TankData[]
  damagedBuildings: BuildingDamage
  activeFleetSlots: number[]
  onFleetHit: (slot: number, position: THREE.Vector3) => void
}) {
  const meshRefs = useRef<(THREE.Group | null)[]>([])
  const random = useMemo(() => mulberry32(8128), [])
  const missiles = useRef<
    {
      trajectory: MissileTrajectory | null
      age: number
      impact: MissileImpact | null
      targetsFleet: boolean
      previousPosition: { x: number; y: number; z: number } | null
    }[]
  >(
    Array.from({ length: 24 }, () => ({
      trajectory: null,
      age: 0,
      impact: null,
      targetsFleet: false,
      previousPosition: null,
    })),
  )
  const spawnClock = useRef(0)
  const spawnIndex = useRef(0)
  const directFireStations = useRef<Set<number>>(new Set())

  useFrame((_, delta) => {
    if (!active || !target.current) return
    spawnClock.current += delta
    const spawnEvery = Math.max(0.48, 1.35 / intensity)
    const targetZ = target.current.position.z
    const availableStations = stationData
      .map((station, index) => {
        const stationDrop = buildingCollapseDrop(
          station.buildingIndex,
          buildingData,
          damagedBuildings,
          performance.now() / 1000,
        )
        return {
          ...station,
          index,
          launchY: station.position[1] + 3.6 - stationDrop,
          stationLevel: station.position[1] - stationDrop,
        }
      })
      .filter(
        (station) =>
          !destroyedStations.has(station.index) &&
          Math.abs(station.position[2] - targetZ) < 75,
      )
    const directStations = availableStations.filter(
      (station) => target.current!.position.y >= station.stationLevel,
    )
    const newlyTriggeredStations = directStations.filter(
      (station) => !directFireStations.current.has(station.index),
    )
    newlyTriggeredStations.forEach((station) => {
      directFireStations.current.add(station.index)
    })

    const launchMissile = (
      station: (typeof availableStations)[number],
      targetsFleet: boolean,
    ) => {
      const index = spawnIndex.current++ % missiles.current.length
      let impact: MissileImpact | null = null
      let end: { x: number; y: number; z: number }
      if (targetsFleet) {
        const currentDistance = Math.hypot(
          target.current!.position.x - station.position[0],
          target.current!.position.z - station.position[2],
        )
        const estimatedDuration = THREE.MathUtils.clamp(
          currentDistance / 20,
          2.6,
          5.4,
        )
        end = {
          x: target.current!.position.x,
          y: target.current!.position.y,
          z:
            target.current!.position.z -
            FLEET_FORWARD_SPEED * estimatedDuration,
        }
      } else {
        const missileProtectedBuildings = protectedBuildingIndices(
          stationData.map((candidate) => candidate.buildingIndex),
          buildingData.map((building) => building.person !== null),
        )
        const possibleImpacts: MissileImpact[] = [
          ...tankData
            .map((tank, tankIndex) => ({
              kind: 'tank' as const,
              index: tankIndex,
              position: {
                x: tank.position[0],
                y: tank.position[1] + 2.2,
                z: tank.position[2],
              },
            }))
            .filter((candidate) => !destroyedTanks.has(candidate.index)),
          ...buildingData
            .map((building, buildingIndex) => ({
              kind: 'building' as const,
              index: buildingIndex,
              position: {
                x: building.position[0],
                y:
                  building.position[1] +
                  THREE.MathUtils.lerp(
                    building.scale[1] / 2,
                    -building.scale[1] / 6,
                    buildingDamageProgress(
                      buildingIndex,
                      damagedBuildings,
                      performance.now() / 1000,
                    ),
                  ),
                z: building.position[2],
              },
            }))
            .filter(
              (candidate) =>
                !missileProtectedBuildings.has(candidate.index),
            ),
        ]
        const visibleImpacts = possibleImpacts.filter(
          (candidate) => Math.abs(candidate.position.z - targetZ) < 75,
        )
        const impactPool =
          visibleImpacts.length > 0 ? visibleImpacts : possibleImpacts
        impact = impactPool[Math.floor(random() * impactPool.length)] ?? null
        if (!impact) return
        end = impact.position
      }
      const start = {
        x: station.position[0],
        y: station.launchY,
        z: station.position[2],
      }
      const distance = Math.hypot(
        end.x - start.x,
        end.z - start.z,
      )
      const peak = Math.max(start.y, end.y) + 13 + random() * 12
      missiles.current[index] = {
        trajectory: {
          start,
          controlA: {
            x: start.x + (random() - 0.5) * 22,
            y: peak,
            z: start.z + (end.z - start.z) * 0.27,
          },
          controlB: {
            x: end.x + (random() - 0.5) * 22,
            y: peak * 0.72,
            z: start.z + (end.z - start.z) * 0.73,
          },
          end,
          duration: THREE.MathUtils.clamp(distance / 20, 2.6, 5.4),
          wobble: random() * 2.4,
        },
        age: 0,
        impact,
        targetsFleet,
        previousPosition: start,
      }
    }

    newlyTriggeredStations.forEach((station) => {
      launchMissile(station, true)
    })
    if (spawnClock.current > spawnEvery && availableStations.length > 0) {
      spawnClock.current = 0
      const stationPool =
        directStations.length > 0 ? directStations : availableStations
      const station =
        stationPool[Math.floor(random() * stationPool.length)]
      launchMissile(station, directStations.length > 0)
    }

    const fleetParts = activeFleetSlots.map((slot) => ({
      slot,
      parts: aircraftPartsAt(target.current!, droneOffsets[slot]),
    }))
    const hitSlots = new Set<number>()
    missiles.current.forEach((missile, index) => {
      if (!missile.trajectory) {
        meshRefs.current[index]?.position.set(1000, -1000, 1000)
        return
      }
      missile.age += Math.min(delta, 1 / 20)
      const sample = sampleMissileTrajectory(missile.trajectory, missile.age)
      const mesh = meshRefs.current[index]
      if (!mesh) return
      const previousPosition = missile.previousPosition ?? sample.position
      const fleetHit = fleetParts.find(
        ({ slot, parts }) =>
          !hitSlots.has(slot) &&
          parts.some(
            (part) =>
              segmentPointDistanceSquared(
                previousPosition,
                sample.position,
                part,
              ) <= 0.85 ** 2,
          ),
      )
      missile.previousPosition = sample.position
      if (fleetHit) {
        hitSlots.add(fleetHit.slot)
        onFleetHit(
          fleetHit.slot,
          new THREE.Vector3(
            sample.position.x,
            sample.position.y,
            sample.position.z,
          ),
        )
        missile.trajectory = null
        missile.impact = null
        missile.previousPosition = null
        mesh.position.set(1000, -1000, 1000)
        return
      }
      mesh.position.set(
        sample.position.x,
        sample.position.y,
        sample.position.z,
      )
      mesh.lookAt(
        sample.position.x + sample.velocity.x,
        sample.position.y + sample.velocity.y,
        sample.position.z + sample.velocity.z,
      )
      if (sample.complete) {
        if (missile.impact) onImpact(missile.impact)
        missile.trajectory = null
        missile.impact = null
        missile.previousPosition = null
        mesh.position.set(1000, -1000, 1000)
      }
    })
  })

  return (
    <>
      {missiles.current.map((_, index) => (
        <group key={index} ref={(node) => { meshRefs.current[index] = node }}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.2, 1.7, 7]} />
            <meshStandardMaterial color="#d6d1b7" />
          </mesh>
          <mesh position={[0, 0, 0.95]}>
            <boxGeometry args={[0.3, 0.3, 0.5]} />
            <meshBasicMaterial color="#ffe14f" />
          </mesh>
        </group>
      ))}
    </>
  )
}

type MissileImpact = {
  kind: 'building' | 'tank'
  index: number
  position: { x: number; y: number; z: number }
}

type AttackFlightData = {
  id: number
  slot: number
  targetKind: 'station' | 'tank'
  targetIndex: number
  targetPosition: [number, number, number]
  targetBuildingIndex: number | null
  blackened: boolean
  start: [number, number, number]
  arcHeight: number
}

type AttackTarget = Pick<
  AttackFlightData,
  'targetKind' | 'targetIndex' | 'targetPosition' | 'targetBuildingIndex'
> & {
  replacementAvailable: boolean
}

type ReplacementFlightData = {
  id: number
  slot: number
  start: [number, number, number]
}

function AttackFlight({
  flight,
  paused,
  lidPositions,
  buildings,
  damagedBuildings,
  tanks,
  explodedTanks,
  stations,
  destroyedStations,
  cloudPositions,
  onStrike,
  onStructureHit,
  onDestroyed,
}: {
  flight: AttackFlightData
  paused: boolean
  lidPositions: React.RefObject<Map<number, THREE.Vector3>>
  buildings: BuildingData[]
  damagedBuildings: BuildingDamage
  tanks: TankData[]
  explodedTanks: Set<number>
  stations: StationData[]
  destroyedStations: Set<number>
  cloudPositions: React.RefObject<Map<number, THREE.Vector3>>
  onStrike: (flight: AttackFlightData, position: THREE.Vector3) => void
  onStructureHit: (
    flight: AttackFlightData,
    hit: StructureHit,
    position: THREE.Vector3,
  ) => void
  onDestroyed: (flight: AttackFlightData, position: THREE.Vector3) => void
}) {
  const group = useRef<THREE.Group>(null)
  const age = useRef(0)
  const progress = useRef(0)
  const complete = useRef(false)
  const [blackened, setBlackened] = useState(flight.blackened)

  useFrame((_, delta) => {
    if (paused || complete.current || !group.current) return
    age.current += delta
    const target = new THREE.Vector3(...flight.targetPosition)
    if (flight.targetBuildingIndex !== null) {
      target.y -= buildingCollapseDrop(
        flight.targetBuildingIndex,
        buildings,
        damagedBuildings,
        performance.now() / 1000,
      )
    }
    const speed = Math.min(30, 3.05 + age.current * 4.5)
    const start = new THREE.Vector3(...flight.start)
    const directDistance = Math.max(1, start.distanceTo(target))
    progress.current = Math.min(
      1,
      progress.current + (speed * delta) / directDistance,
    )
    const nextPosition = pointOnFlightArc(
      start,
      target,
      progress.current,
      flight.arcHeight,
    )
    group.current.position.set(
      nextPosition.x,
      nextPosition.y,
      nextPosition.z,
    )
    const lookAhead = pointOnFlightArc(
      start,
      target,
      Math.min(1, progress.current + 0.015),
      flight.arcHeight,
    )
    group.current.lookAt(lookAhead.x, lookAhead.y, lookAhead.z)
    group.current.rotation.y += Math.PI

    const parts = aircraftPartsAt(group.current)
    if (!blackened && isUnderBlackCloud(parts, cloudPositions.current)) {
      setBlackened(true)
    }
    const structureHit = findStructureHit(
      parts,
      buildings,
      damagedBuildings,
      tanks,
      explodedTanks,
      stations,
      destroyedStations,
      lidPositions.current,
      flight.targetBuildingIndex,
    )
    if (structureHit) {
      complete.current = true
      if (
        (flight.targetKind === 'tank' && structureHit.kind === 'tank') ||
        (flight.targetKind === 'station' && structureHit.kind === 'station')
      ) {
        onStrike(flight, group.current.position.clone())
      } else {
        onStructureHit(flight, structureHit, group.current.position.clone())
      }
      return
    }

    if (progress.current >= 1) {
      complete.current = true
      onStrike(flight, group.current.position.clone())
    }
  })

  return (
    <group ref={group} position={flight.start}>
      <Drone offset={[0, 0, 0]} active blackened={blackened} />
    </group>
  )
}

function ReplacementFlight({
  flight,
  formation,
  paused,
  lidPositions,
  buildings,
  damagedBuildings,
  tanks,
  explodedTanks,
  stations,
  destroyedStations,
  cloudPositions,
  onJoined,
  onCollision,
}: {
  flight: ReplacementFlightData
  formation: React.RefObject<THREE.Group | null>
  paused: boolean
  lidPositions: React.RefObject<Map<number, THREE.Vector3>>
  buildings: BuildingData[]
  damagedBuildings: BuildingDamage
  tanks: TankData[]
  explodedTanks: Set<number>
  stations: StationData[]
  destroyedStations: Set<number>
  cloudPositions: React.RefObject<Map<number, THREE.Vector3>>
  onJoined: (flight: ReplacementFlightData) => void
  onCollision: (
    flight: ReplacementFlightData,
    hit: StructureHit,
    position: THREE.Vector3,
  ) => void
}) {
  const group = useRef<THREE.Group>(null)
  const joined = useRef(false)
  const [blackened, setBlackened] = useState(false)

  useFrame((_, delta) => {
    if (paused || joined.current || !group.current || !formation.current) return
    const offset = droneOffsets[flight.slot]
    const target = formation.current.localToWorld(
      new THREE.Vector3(offset[0], offset[1], offset[2]),
    )
    const distance = group.current.position.distanceTo(target)
    group.current.position.add(
      target
        .clone()
        .sub(group.current.position)
        .normalize()
        .multiplyScalar(replacementTravelDistance(distance, delta)),
    )
    formation.current.getWorldQuaternion(group.current.quaternion)
    const parts = aircraftPartsAt(group.current)
    if (!blackened && isUnderBlackCloud(parts, cloudPositions.current)) {
      setBlackened(true)
    }
    const structureHit = findStructureHit(
      parts,
      buildings,
      damagedBuildings,
      tanks,
      explodedTanks,
      stations,
      destroyedStations,
      lidPositions.current,
    )
    if (structureHit) {
      joined.current = true
      onCollision(flight, structureHit, group.current.position.clone())
      return
    }
    const remainingDistance = group.current.position.distanceTo(target)
    if (remainingDistance < REPLACEMENT_JOIN_DISTANCE) {
      group.current.position.copy(target)
      joined.current = true
      onJoined(flight)
    }
  })

  return (
    <group ref={group} position={flight.start}>
      <Drone offset={[0, 0, 0]} active blackened={blackened} />
    </group>
  )
}

function Simulation({
  onProgress,
  onAltitude,
  onAttackMode,
  onStations,
  onFleetSlots,
}: GameWorldProps) {
  const routeId = useGameStore((state) => state.route)!
  const route = ROUTES[routeId]
  const runSeed = useGameStore((state) => state.runSeed)
  const paused = useGameStore((state) => state.paused)
  const survivors = useGameStore((state) => state.survivors)
  const launchesRemaining = useGameStore((state) => state.launchesRemaining)
  const addScore = useGameStore((state) => state.addScore)
  const launchDrone = useGameStore((state) => state.launchDrone)
  const loseControlledDrone = useGameStore(
    (state) => state.loseControlledDrone,
  )
  const finishRun = useGameStore((state) => state.finishRun)
  const reducedEffects = useGameStore((state) => state.settings.reducedEffects)
  const cityLayout = useMemo(() => createCityLayout(runSeed), [runSeed])
  const { buildings, tanks, stations, crossRoads } = cityLayout
  const input = useFlightInput()
  const formation = useRef<THREE.Group>(null)
  const buildingStartRowRef = useRef(buildingWindowStartRow(CITY_FIRST_ROW_Z))
  const [buildingStartRow, setBuildingStartRow] = useState(
    buildingStartRowRef.current,
  )
  const elapsed = useRef(0)
  const accumulator = useRef(0)
  const lastHudUpdate = useRef(0)
  const checkpointIndex = useRef(0)
  const nearMissIndex = useRef(1)
  const damageCooldown = useRef(0)
  const finished = useRef(false)
  const nextFlightId = useRef(1)
  const lidPositions = useRef<Map<number, THREE.Vector3>>(new Map())
  const lidBuildingHits = useRef<Set<string>>(new Set())
  const cloudPositions = useRef<Map<number, THREE.Vector3>>(new Map())
  const [explodedTanks, setExplodedTanks] = useState<Set<number>>(new Set())
  const [damagedBuildings, setDamagedBuildings] = useState<BuildingDamage>(
    new Map(),
  )
  const [destroyedStations, setDestroyedStations] = useState<Set<number>>(
    new Set(),
  )
  const [attacks, setAttacks] = useState<AttackFlightData[]>([])
  const [pendingAttacks, setPendingAttacks] = useState<AttackTarget[]>([])
  const [replacements, setReplacements] = useState<ReplacementFlightData[]>([])
  const [refillingSlots, setRefillingSlots] = useState<Set<number>>(new Set())
  const [inactiveSlots, setInactiveSlots] = useState<Set<number>>(new Set())
  const [blackenedSlots, setBlackenedSlots] = useState<Set<number>>(new Set())
  const [droneExplosions, setDroneExplosions] = useState<
    { id: number; position: [number, number, number] }[]
  >([])
  const explosionId = useRef(0)
  const { camera } = useThree()

  useEffect(() => {
    onAttackMode(attacks.length + pendingAttacks.length > 0)
  }, [attacks.length, onAttackMode, pendingAttacks.length])

  useEffect(() => {
    onStations(destroyedStations.size, stations.length)
  }, [destroyedStations.size, onStations, stations.length])

  useEffect(() => {
    onFleetSlots(
      droneOffsets.map((_, slot) => {
        if (refillingSlots.has(slot)) return 'refilling'
        if (inactiveSlots.has(slot)) return 'lost'
        return 'ready'
      }),
      pendingAttacks.length,
    )
  }, [inactiveSlots, onFleetSlots, pendingAttacks.length, refillingSlots])

  const addImpactExplosion = (position: { x: number; y: number; z: number }) => {
    setDroneExplosions((current) => [
      ...current.slice(-7),
      {
        id: explosionId.current++,
        position: [position.x, position.y, position.z],
      },
    ])
  }

  const beginLaunch = (target: AttackTarget, availableSlot: number) => {
    if (!formation.current) return false
    const launchedBlackened = blackenedSlots.has(availableSlot)
    setBlackenedSlots((current) => {
      const next = new Set(current)
      next.delete(availableSlot)
      return next
    })
    const id = nextFlightId.current++
    const offset = droneOffsets[availableSlot]
    const start: [number, number, number] = [
      formation.current.position.x + offset[0],
      formation.current.position.y + offset[1],
      formation.current.position.z + offset[2],
    ]
    const arcHeight = requiredFlightArc(
      { x: start[0], y: start[1], z: start[2] },
      {
        x: target.targetPosition[0],
        y: target.targetPosition[1],
        z: target.targetPosition[2],
      },
      buildings,
      target.targetBuildingIndex,
    )
    setAttacks((current) => [
      ...current,
      {
        id,
        slot: availableSlot,
        ...target,
        blackened: launchedBlackened,
        start,
        arcHeight,
      },
    ])
    if (target.replacementAvailable) {
      setReplacements((current) => [
        ...current,
        {
          id,
          slot: availableSlot,
          start: [
            formation.current!.position.x + offset[0],
            formation.current!.position.y + offset[1] - 1.5,
            formation.current!.position.z + 38 + availableSlot * 3,
          ],
        },
      ])
      setRefillingSlots((current) => new Set(current).add(availableSlot))
    } else {
      setInactiveSlots((current) => new Set(current).add(availableSlot))
    }
    if (!target.replacementAvailable && survivors <= 1) {
      finished.current = true
      finishRun(false)
    }
    return true
  }

  const launchAtTarget = (
    targetKind: AttackFlightData['targetKind'],
    targetIndex: number,
    targetPosition: [number, number, number],
    targetBuildingIndex: number | null = null,
  ) => {
    const targeted = attacks.some(
      (attack) =>
        attack.targetKind === targetKind && attack.targetIndex === targetIndex,
    ) || pendingAttacks.some(
      (attack) =>
        attack.targetKind === targetKind && attack.targetIndex === targetIndex,
      )
    const availableSlots = droneOffsets
      .map((_, slot) => slot)
      .filter(
        (slot) => !inactiveSlots.has(slot) && !refillingSlots.has(slot),
      )
    if (
      paused ||
      launchesRemaining <= 0 ||
      (targetKind === 'station'
        ? destroyedStations.has(targetIndex)
        : explodedTanks.has(targetIndex)) ||
      targeted ||
      !formation.current
    ) {
      return
    }
    const launch = launchDrone()
    if (!launch.accepted) return
    const target: AttackTarget = {
      targetKind,
      targetIndex,
      targetPosition,
      targetBuildingIndex,
      replacementAvailable: launch.replacementAvailable,
    }
    const availableSlot = launch.replacementAvailable
      ? (availableSlots[0] ?? -1)
      : (availableSlots.at(-1) ?? -1)
    if (availableSlot >= 0) {
      beginLaunch(target, availableSlot)
    } else {
      setPendingAttacks((current) => [...current, target])
    }
  }

  useEffect(() => {
    if (paused || pendingAttacks.length === 0) return
    const availableSlots = droneOffsets
      .map((_, slot) => slot)
      .filter(
        (slot) => !inactiveSlots.has(slot) && !refillingSlots.has(slot),
      )
    if (availableSlots.length === 0) return
    const target = pendingAttacks[0]
    const targetGone =
      target.targetKind === 'station'
        ? destroyedStations.has(target.targetIndex)
        : explodedTanks.has(target.targetIndex)
    setPendingAttacks((current) => current.slice(1))
    if (targetGone) return
    const slot = target.replacementAvailable
      ? availableSlots[0]
      : availableSlots.at(-1)!
    beginLaunch(target, slot)
  }, [
    destroyedStations,
    explodedTanks,
    inactiveSlots,
    paused,
    pendingAttacks,
    refillingSlots,
    survivors,
  ])

  const completeAttack = (
    flight: AttackFlightData,
    position: THREE.Vector3,
  ) => {
    setAttacks((current) => current.filter((item) => item.id !== flight.id))
    if (flight.targetKind === 'station') {
      setDestroyedStations((current) => {
        if (current.has(flight.targetIndex)) return current
        const next = new Set(current).add(flight.targetIndex)
        onStations(next.size, stations.length)
        return next
      })
      addScore('airDefense')
    } else {
      setExplodedTanks((current) => new Set(current).add(flight.targetIndex))
      addScore('oilTank')
    }
    addImpactExplosion(position)
  }

  const destroyAttack = (
    flight: AttackFlightData,
    position: THREE.Vector3,
  ) => {
    setAttacks((current) => current.filter((item) => item.id !== flight.id))
    addImpactExplosion(position)
  }

  const damageBuilding = (buildingIndex: number) => {
    setDamagedBuildings((current) => {
      if (current.has(buildingIndex)) return current
      const next = new Map(current)
      next.set(buildingIndex, performance.now() / 1000)
      return next
    })
  }

  const trackLidPosition = (
    lidIndex: number,
    position: THREE.Vector3 | null,
  ) => {
    if (!position) {
      lidPositions.current.delete(lidIndex)
      return
    }

    lidPositions.current.set(lidIndex, position)
    const buildingIndex = lidBuildingCollision(
      position,
      buildings,
      damagedBuildings,
      performance.now() / 1000,
    )
    if (buildingIndex === null) return

    const impactKey = `${lidIndex}:${buildingIndex}`
    if (lidBuildingHits.current.has(impactKey)) return
    lidBuildingHits.current.add(impactKey)
    damageBuilding(buildingIndex)
    addImpactExplosion(position)
  }

  const applyStructureImpact = (
    hit: StructureHit,
    playerStrike: boolean,
  ) => {
    if (hit.kind === 'building') {
      damageBuilding(hit.index)
    } else if (hit.kind === 'tank') {
      setExplodedTanks((current) => new Set(current).add(hit.index))
      if (playerStrike) addScore('oilTank')
    } else if (hit.kind === 'station') {
      setDestroyedStations((current) => {
        if (current.has(hit.index)) return current
        const next = new Set(current).add(hit.index)
        onStations(next.size, stations.length)
        return next
      })
      if (playerStrike) addScore('airDefense')
    }
  }

  const attackHitsStructure = (
    flight: AttackFlightData,
    hit: StructureHit,
    position: THREE.Vector3,
  ) => {
    setAttacks((current) => current.filter((item) => item.id !== flight.id))
    applyStructureImpact(hit, true)
    addImpactExplosion(position)
  }

  const joinReplacement = (flight: ReplacementFlightData) => {
    setReplacements((current) => current.filter((item) => item.id !== flight.id))
    setRefillingSlots((current) => {
      const next = new Set(current)
      next.delete(flight.slot)
      return next
    })
  }

  const destroyReplacement = (
    flight: ReplacementFlightData,
    hit: StructureHit,
    position: THREE.Vector3,
  ) => {
    setReplacements((current) => current.filter((item) => item.id !== flight.id))
    setRefillingSlots((current) => {
      const next = new Set(current)
      next.delete(flight.slot)
      return next
    })
    setInactiveSlots((current) => new Set(current).add(flight.slot))
    applyStructureImpact(hit, false)
    addImpactExplosion(position)
    const remaining = loseControlledDrone()
    if (remaining === 0) {
      finished.current = true
      finishRun(false)
    }
  }

  const destroyFleetSlot = (
    slot: number,
    position: THREE.Vector3,
    hit?: StructureHit,
  ) => {
    setInactiveSlots((current) => new Set(current).add(slot))
    if (hit) applyStructureImpact(hit, false)
    addImpactExplosion(position)
    const remaining = loseControlledDrone()
    if (remaining === 0) {
      finished.current = true
      finishRun(false)
    }
  }

  useFrame((_, frameDelta) => {
    if (paused || finished.current || !formation.current) return
    accumulator.current += Math.min(frameDelta, 0.1)
    const fixedDelta = 1 / 60

    while (accumulator.current >= fixedDelta) {
      accumulator.current -= fixedDelta
      elapsed.current += fixedDelta
      damageCooldown.current = Math.max(0, damageCooldown.current - fixedDelta)
      const gamepad = navigator.getGamepads?.()[0]
      const horizontal =
        (input.current.right ? 1 : 0) -
        (input.current.left ? 1 : 0) +
        (gamepad?.axes[0] ?? 0)
      const vertical =
        (input.current.up ? 1 : 0) -
        (input.current.down ? 1 : 0) -
        (gamepad?.axes[1] ?? 0)
      formation.current.position.x = THREE.MathUtils.clamp(
        formation.current.position.x + horizontal * fixedDelta * 10,
        -32,
        32,
      )
      formation.current.position.y = THREE.MathUtils.clamp(
        formation.current.position.y + vertical * fixedDelta * 10,
        0.5,
        28,
      )
      formation.current.position.z -= fixedDelta * FLEET_FORWARD_SPEED
      const nextBuildingStartRow = buildingWindowStartRow(
        formation.current.position.z,
      )
      if (nextBuildingStartRow !== buildingStartRowRef.current) {
        buildingStartRowRef.current = nextBuildingStartRow
        setBuildingStartRow(nextBuildingStartRow)
      }
      formation.current.rotation.z = THREE.MathUtils.lerp(
        formation.current.rotation.z,
        -horizontal * 0.18,
        0.08,
      )
      formation.current.rotation.x = THREE.MathUtils.lerp(
        formation.current.rotation.x,
        vertical * 0.08,
        0.08,
      )

      const progress = elapsed.current / RUN_DURATION_SECONDS
      if (
        checkpointIndex.current < CHECKPOINTS.length &&
        progress >= CHECKPOINTS[checkpointIndex.current]
      ) {
        checkpointIndex.current += 1
        addScore('checkpoint')
      }
      if (elapsed.current >= nearMissIndex.current * 11.5) {
        nearMissIndex.current += 1
        addScore(nearMissIndex.current % 3 === 0 ? 'collateral' : 'nearMiss')
      }

      if (damageCooldown.current === 0 && formation.current.position.y < 0.75) {
        damageCooldown.current = 8
        const slot = droneOffsets.findIndex(
          (_, index) =>
            !inactiveSlots.has(index) && !refillingSlots.has(index),
        )
        if (slot >= 0) destroyFleetSlot(slot, formation.current.position.clone())
      }

      if (damageCooldown.current === 0) {
        const activeSlots = droneOffsets
          .map((_, slot) => slot)
          .filter(
            (slot) =>
              !inactiveSlots.has(slot) && !refillingSlots.has(slot),
          )
        for (const slot of activeSlots) {
          const parts = aircraftPartsAt(formation.current, droneOffsets[slot])
          if (
            !blackenedSlots.has(slot) &&
            isUnderBlackCloud(parts, cloudPositions.current)
          ) {
            setBlackenedSlots((current) => new Set(current).add(slot))
          }
          const hit = findStructureHit(
            parts,
            buildings,
            damagedBuildings,
            tanks,
            explodedTanks,
            stations,
            destroyedStations,
            lidPositions.current,
          )
          if (!hit) continue
          damageCooldown.current = 3
          destroyFleetSlot(slot, parts[0], hit)
          break
        }
      }

      if (elapsed.current >= RUN_DURATION_SECONDS) {
        finished.current = true
        finishRun(true)
      }
    }

    if (elapsed.current - lastHudUpdate.current > 0.1) {
      lastHudUpdate.current = elapsed.current
      onProgress(Math.min(1, elapsed.current / RUN_DURATION_SECONDS))
      onAltitude(
        Math.round(
          80 +
            formation.current.position.y * 24,
        ),
      )
    }
    const formationPosition = formation.current.position
    const desiredCamera = new THREE.Vector3(
      formationPosition.x,
      formationPosition.y + 5.5,
      formationPosition.z + 15,
    )
    camera.position.lerp(desiredCamera, 0.055)
    camera.lookAt(
      formationPosition.x,
      formationPosition.y,
      formationPosition.z - 14,
    )
  })

  return (
    <>
      <City
        buildings={buildings}
        damagedBuildings={damagedBuildings}
        crossRoads={crossRoads}
        buildingStartRow={buildingStartRow}
        paused={paused}
      />
      <group ref={formation} position={[0, 5, 8]}>
        {droneOffsets.map((offset, index) => (
          <Drone
            key={index}
            offset={offset}
            active={
              !inactiveSlots.has(index) &&
              !refillingSlots.has(index)
            }
            blackened={blackenedSlots.has(index)}
          />
        ))}
      </group>
      {attacks.map((flight) => (
        <AttackFlight
          key={flight.id}
          flight={flight}
          paused={paused}
          lidPositions={lidPositions}
          buildings={buildings}
          damagedBuildings={damagedBuildings}
          tanks={tanks}
          explodedTanks={explodedTanks}
          stations={stations}
          destroyedStations={destroyedStations}
          cloudPositions={cloudPositions}
          onStrike={completeAttack}
          onStructureHit={attackHitsStructure}
          onDestroyed={destroyAttack}
        />
      ))}
      {replacements.map((flight) => (
        <ReplacementFlight
          key={flight.id}
          flight={flight}
          formation={formation}
          paused={paused}
          lidPositions={lidPositions}
          buildings={buildings}
          damagedBuildings={damagedBuildings}
          tanks={tanks}
          explodedTanks={explodedTanks}
          stations={stations}
          destroyedStations={destroyedStations}
          cloudPositions={cloudPositions}
          onJoined={joinReplacement}
          onCollision={destroyReplacement}
        />
      ))}
      <Missiles
        target={formation}
        active={!paused}
        intensity={route.defenseIntensity}
        destroyedStations={destroyedStations}
        destroyedTanks={explodedTanks}
        buildings={buildings}
        stations={stations}
        tanks={tanks}
        damagedBuildings={damagedBuildings}
        activeFleetSlots={droneOffsets
          .map((_, slot) => slot)
          .filter(
            (slot) =>
              !inactiveSlots.has(slot) && !refillingSlots.has(slot),
          )}
        onFleetHit={(slot, position) => {
          if (inactiveSlots.has(slot) || refillingSlots.has(slot)) return
          destroyFleetSlot(slot, position)
        }}
        onImpact={(impact) => {
          addImpactExplosion(impact.position)
          if (impact.kind === 'tank') {
            setExplodedTanks((current) => {
              if (current.has(impact.index)) return current
              return new Set(current).add(impact.index)
            })
          } else {
            damageBuilding(impact.index)
          }
        }}
      />
      {stations.map((station, index) =>
        isBuildingRowVisible(
          buildings[station.buildingIndex].row,
          buildingStartRow,
        ) ? (
          <AirDefenseStation
            key={index}
            position={station.position}
            buildingIndex={station.buildingIndex}
            buildings={buildings}
            damagedBuildings={damagedBuildings}
            destroyed={destroyedStations.has(index)}
            targeted={attacks.some(
              (attack) =>
                attack.targetKind === 'station' &&
                attack.targetIndex === index,
            ) || pendingAttacks.some(
              (attack) =>
                attack.targetKind === 'station' &&
                attack.targetIndex === index,
            )}
            onSelect={() =>
              launchAtTarget('station', index, [
                station.position[0],
                station.position[1] + 1.5,
                station.position[2],
              ], station.buildingIndex)
            }
          />
        ) : null,
      )}
      {tanks.map((tank, index) =>
        isBuildingRowVisible(tank.row, buildingStartRow) ? (
        <OilTank
          key={index}
          index={index}
          position={tank.position}
          exploded={explodedTanks.has(index)}
          targeted={attacks.some(
            (attack) =>
              attack.targetKind === 'tank' && attack.targetIndex === index,
          ) || pendingAttacks.some(
            (attack) =>
              attack.targetKind === 'tank' && attack.targetIndex === index,
          )}
          onSelect={() =>
            launchAtTarget('tank', index, [
              tank.position[0],
              tank.position[1] + 1.5,
              tank.position[2],
            ])
          }
          onLidPosition={trackLidPosition}
        />
        ) : null,
      )}
      {Array.from(explodedTanks).map((tankIndex) =>
        isBuildingRowVisible(tanks[tankIndex].row, buildingStartRow) ? (
        <PollutionCloud
          key={tankIndex}
          index={tankIndex}
          position={tanks[tankIndex].position}
          reducedEffects={reducedEffects}
          onPosition={(cloudIndex, position) => {
            if (position) {
              cloudPositions.current.set(cloudIndex, position)
            } else {
              cloudPositions.current.delete(cloudIndex)
            }
          }}
        />
        ) : null,
      )}
      {droneExplosions.map((explosion) => (
        <group key={explosion.id} position={explosion.position}>
          <Explosion />
        </group>
      ))}
      {!reducedEffects && (
        <points position={[0, 12, -70]}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array(Array.from({ length: 450 }, (_, index) => ((index * 97) % 31) - 15)), 3]}
            />
          </bufferGeometry>
          <pointsMaterial color="#c7d4ce" size={0.04} transparent opacity={0.3} />
        </points>
      )}
    </>
  )
}

export function GameWorld(props: GameWorldProps) {
  const paused = useGameStore((state) => state.paused)
  return (
    <>
      <color attach="background" args={['#78868b']} />
      <fog attach="fog" args={['#78868b', 34, 150]} />
      <Sky sunPosition={[18, 8, -30]} turbidity={8} rayleigh={2.2} />
      <hemisphereLight args={['#f3fbfa', '#798178', 1.75]} />
      <ambientLight intensity={1.4} />
      <directionalLight
        castShadow
        position={[-25, 38, 18]}
        intensity={2.8}
        color="#ffe0b5"
        shadow-mapSize={[1024, 1024]}
      />
      <Physics gravity={[0, -14, 0]} paused={paused}>
        <Simulation {...props} />
        <RigidBody type="fixed" colliders="cuboid">
          <mesh position={[0, -3.3, -85]} visible={false}>
            <boxGeometry args={[150, 0.5, 260]} />
          </mesh>
        </RigidBody>
      </Physics>
    </>
  )
}
