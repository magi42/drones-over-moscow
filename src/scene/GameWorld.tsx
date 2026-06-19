import { Sky, useGLTF } from '@react-three/drei'
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
import { mulberry32 } from '../game/random'
import {
  sampleMissileTrajectory,
  type MissileTrajectory,
} from '../game/missile'
import { useGameStore } from '../store/gameStore'
import apartmentBlockUrl from '../assets/assets/models/rundown_15_storey_panel_block.glb'
import oilTankRoofUrl from '../assets/assets/models/oil_tank_roof_blowoff_flat.glb'

type GameWorldProps = {
  onProgress: (progress: number) => void
  onAltitude: (altitude: number) => void
  onAttackMode: (active: boolean) => void
  onStations: (destroyed: number, total: number) => void
}

type InputState = {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
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
  color: string
  apartmentBlock: boolean
  rotation: number
}

type StationData = {
  buildingIndex: number
  position: [number, number, number]
}

type TankData = {
  position: [number, number, number]
}

type CityLayout = {
  buildings: BuildingData[]
  tanks: TankData[]
  stations: StationData[]
  crossRoads: number[]
}

type BuildingDamage = Map<number, number>

const BUILDING_COLLAPSE_SECONDS = 10

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
  const cells = Array.from({ length: 28 }, (_, row) =>
    columns.map((x, column) => ({
      x,
      z: 8 - row * 15,
      row,
      column,
      sort: random(),
    })),
  ).flat()
  const availableCells = [...cells].sort((a, b) => a.sort - b.sort)
  const tankCells = availableCells.splice(0, 12)
  const buildingCells = availableCells
    .filter((cell) => cell.row >= 3)
    .slice(0, 52)
  const buildings = buildingCells.map((cell) => {
    const visibleHeight = 9 + random() * 17
    const scale: [number, number, number] = [13.4, visibleHeight, 9]
    return {
      position: [
        cell.x,
        -3 + visibleHeight / 2,
        cell.z,
      ] as [number, number, number],
      scale,
      color: '#ffffff',
      apartmentBlock: true,
      rotation: random() > 0.5 ? Math.PI : 0,
    }
  })
  const tanks = tankCells.map((cell) => ({
    position: [cell.x, 1.5, cell.z] as [number, number, number],
  }))
  const stationIndices = [7, 17, 29, 39]
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
  let roadRow = 1 + Math.floor(random() * 3)
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
}: {
  offset: [number, number, number]
  active: boolean
}) {
  if (!active) return null

  return (
    <group position={offset} rotation={[0.08, 0, 0]}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.22, 0.38, 3.8, 10]} />
        <meshStandardMaterial
          color="#d5d0b9"
          emissive="#5d604f"
          emissiveIntensity={0.14}
          roughness={0.62}
          metalness={0.18}
        />
      </mesh>
      <mesh position={[0, 0, -2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.38, 0.72, 10]} />
        <meshStandardMaterial color="#e2dec9" roughness={0.58} />
      </mesh>
      <mesh position={[0, 0, -0.25]} castShadow>
        <boxGeometry args={[5.8, 0.12, 0.72]} />
        <meshStandardMaterial color="#c9c5af" roughness={0.66} metalness={0.16} />
      </mesh>
      <mesh position={[0, 0.05, 1.45]} castShadow>
        <boxGeometry args={[2.1, 0.1, 0.48]} />
        <meshStandardMaterial color="#b9b6a4" roughness={0.68} />
      </mesh>
      <mesh position={[0, 0.46, 1.58]} rotation={[0.15, 0, 0]} castShadow>
        <boxGeometry args={[0.1, 0.9, 0.62]} />
        <meshStandardMaterial color="#aaa795" roughness={0.7} />
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
        <meshStandardMaterial color="#707467" roughness={0.55} />
      </mesh>
    </group>
  )
}

function ApartmentBlock({
  building,
  hitAt,
}: {
  building: BuildingData
  hitAt: number | undefined
}) {
  const { scene } = useGLTF(apartmentBlockUrl)
  const group = useRef<THREE.Group>(null)
  const materials = useRef<
    {
      material: THREE.MeshStandardMaterial
      baseColor: THREE.Color
      baseEmissive: THREE.Color
      baseEmissiveIntensity: number
    }[]
  >([])
  const model = useMemo(() => {
    const clone = scene.clone(true)
    materials.current = []
    clone.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
        const sourceMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material]
        const brightened = sourceMaterials.map((sourceMaterial) => {
          const material = sourceMaterial.clone()
          if (material instanceof THREE.MeshStandardMaterial) {
            material.color.lerp(new THREE.Color('#ffffff'), 0.68)
            material.emissive.set('#69746d')
            material.emissiveIntensity = 0.38
            material.roughness = Math.min(material.roughness, 0.76)
            materials.current.push({
              material,
              baseColor: material.color.clone(),
              baseEmissive: material.emissive.clone(),
              baseEmissiveIntensity: material.emissiveIntensity,
            })
          }
          return material
        })
        object.material = Array.isArray(object.material)
          ? brightened
          : brightened[0]
      }
    })
    return clone
  }, [scene])
  const modelScale = 0.55
  const fullModelHeight = 48.83 * modelScale
  const roofHeight = building.position[1] + building.scale[1] / 2

  useFrame(() => {
    const progress =
      hitAt === undefined
        ? 0
        : THREE.MathUtils.clamp(
            (performance.now() / 1000 - hitAt) / BUILDING_COLLAPSE_SECONDS,
            0,
            1,
          )
    if (group.current) {
      group.current.position.y =
        roofHeight -
        fullModelHeight -
        building.scale[1] * (2 / 3) * progress
      group.current.scale.y = modelScale
    }
    materials.current.forEach((entry) => {
      entry.material.color.copy(entry.baseColor).lerp(
        new THREE.Color('#080908'),
        progress * 0.88,
      )
      entry.material.emissive.copy(entry.baseEmissive).lerp(
        new THREE.Color('#020202'),
        progress,
      )
      entry.material.emissiveIntensity = THREE.MathUtils.lerp(
        entry.baseEmissiveIntensity,
        0.05,
        progress,
      )
    })
  })

  return (
    <group
      ref={group}
      position={[
        building.position[0],
        roofHeight - fullModelHeight,
        building.position[2],
      ]}
      rotation={[0, building.rotation, 0]}
      scale={[modelScale, modelScale, modelScale]}
    >
      <primitive object={model} />
    </group>
  )
}

useGLTF.preload(apartmentBlockUrl)

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
}: {
  buildings: BuildingData[]
  damagedBuildings: BuildingDamage
  crossRoads: number[]
}) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, -190]} receiveShadow>
        <planeGeometry args={[340, 470]} />
        <meshStandardMaterial color="#202622" roughness={1} />
      </mesh>
      {crossRoads.map((z, index) => (
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
      ))}
      {buildingData.map((building, index) => (
        <ApartmentBlock
          key={`${building.position.join('-')}-${index}`}
          building={building}
          hitAt={damagedBuildings.get(index)}
        />
      ))}
    </group>
  )
}

const debrisData = Array.from({ length: 100 }, (_, index) => {
  const random = mulberry32(9300 + index)
  return {
    position: [
      -16 + random() * 5,
      2 + random() * 4,
      -35 + random() * 5,
    ] as [number, number, number],
    scale: [
      0.14 + random() * 0.34,
      0.1 + random() * 0.25,
      0.18 + random() * 0.5,
    ] as [number, number, number],
    velocity: [
      -5 + random() * 10,
      7 + random() * 16,
      -4 + random() * 8,
    ] as [number, number, number],
    angular: [
      -8 + random() * 16,
      -8 + random() * 16,
      -8 + random() * 16,
    ] as [number, number, number],
  }
})

function DebrisField({ count }: { count: number }) {
  return (
    <>
      {debrisData.slice(0, count).map((debris, index) => (
        <RigidBody
          key={index}
          colliders="cuboid"
          position={debris.position}
          linearVelocity={debris.velocity}
          angularVelocity={debris.angular}
          mass={0.08}
        >
          <mesh scale={debris.scale} castShadow>
            <boxGeometry />
            <meshStandardMaterial
              color={index % 3 === 0 ? '#d98935' : '#626861'}
              metalness={0.65}
              roughness={0.48}
            />
          </mesh>
        </RigidBody>
      ))}
    </>
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
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[4.3, 4.3, 3.4, 20]} />
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
}: {
  index: number
  position: [number, number, number]
  reducedEffects: boolean
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
            <sphereGeometry args={[0.55, 12, 8]} />
            <meshStandardMaterial color="#202823" emissive="#f13f2f" emissiveIntensity={1.8} />
          </mesh>
          <pointLight position={[0, 2.2, -1.6]} color="#ff3d2c" intensity={2} distance={9} />
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
}) {
  const meshRefs = useRef<(THREE.Group | null)[]>([])
  const random = useMemo(() => mulberry32(8128), [])
  const missiles = useRef<
    {
      trajectory: MissileTrajectory | null
      age: number
      impact: MissileImpact | null
    }[]
  >(
    Array.from({ length: 24 }, () => ({
      trajectory: null,
      age: 0,
      impact: null,
    })),
  )
  const spawnClock = useRef(0)
  const spawnIndex = useRef(0)

  useFrame((_, delta) => {
    if (!active || !target.current) return
    spawnClock.current += delta
    const spawnEvery = Math.max(0.48, 1.35 / intensity)
    if (spawnClock.current > spawnEvery) {
      spawnClock.current = 0
      const availableStations = stationData
        .map((station, index) => ({ ...station, index }))
        .filter((station) => !destroyedStations.has(station.index))
      if (availableStations.length === 0) return
      const index = spawnIndex.current++ % missiles.current.length
      const station =
        availableStations[
          Math.floor(random() * availableStations.length)
        ]
      const stationDrop = buildingCollapseDrop(
        station.buildingIndex,
        buildingData,
        damagedBuildings,
        performance.now() / 1000,
      )
      const targetZ = target.current.position.z
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
          .filter((impact) => !destroyedTanks.has(impact.index)),
        ...buildingData.map((building, buildingIndex) => ({
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
        })),
      ]
      const visibleImpacts = possibleImpacts.filter(
        (impact) => Math.abs(impact.position.z - targetZ) < 75,
      )
      const impactPool =
        visibleImpacts.length > 0 ? visibleImpacts : possibleImpacts
      const impact =
        impactPool[Math.floor(random() * impactPool.length)]
      const start = {
        x: station.position[0],
        y: station.position[1] + 3.6 - stationDrop,
        z: station.position[2],
      }
      const distance = Math.hypot(
        impact.position.x - start.x,
        impact.position.z - start.z,
      )
      const peak = Math.max(start.y, impact.position.y) + 13 + random() * 12
      missiles.current[index] = {
        trajectory: {
          start,
          controlA: {
            x: start.x + (random() - 0.5) * 22,
            y: peak,
            z: start.z + (impact.position.z - start.z) * 0.27,
          },
          controlB: {
            x: impact.position.x + (random() - 0.5) * 22,
            y: peak * 0.72,
            z: start.z + (impact.position.z - start.z) * 0.73,
          },
          end: impact.position,
          duration: THREE.MathUtils.clamp(distance / 20, 2.6, 5.4),
          wobble: random() * 2.4,
        },
        age: 0,
        impact,
      }
    }
    missiles.current.forEach((missile, index) => {
      if (!missile.trajectory) {
        meshRefs.current[index]?.position.set(1000, -1000, 1000)
        return
      }
      missile.age += Math.min(delta, 1 / 20)
      const sample = sampleMissileTrajectory(missile.trajectory, missile.age)
      const mesh = meshRefs.current[index]
      if (!mesh) return
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
            <meshStandardMaterial color="#d6d1b7" emissive="#ff5b19" emissiveIntensity={0.25} />
          </mesh>
          <pointLight color="#ff5a16" intensity={2.5} distance={6} />
          <mesh position={[0, 0, 0.95]}>
            <sphereGeometry args={[0.25, 6, 6]} />
            <meshBasicMaterial color="#ff6a1f" transparent opacity={0.8} />
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
  start: [number, number, number]
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
  onStrike,
  onBuildingHit,
  onDestroyed,
}: {
  flight: AttackFlightData
  paused: boolean
  lidPositions: React.RefObject<Map<number, THREE.Vector3>>
  buildings: BuildingData[]
  damagedBuildings: BuildingDamage
  onStrike: (flight: AttackFlightData, position: THREE.Vector3) => void
  onBuildingHit: (
    flight: AttackFlightData,
    buildingIndex: number,
    position: THREE.Vector3,
  ) => void
  onDestroyed: (flight: AttackFlightData, position: THREE.Vector3) => void
}) {
  const group = useRef<THREE.Group>(null)
  const age = useRef(0)
  const complete = useRef(false)

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
    const direction = target.clone().sub(group.current.position)
    const distance = direction.length()
    const speed = Math.min(30, 3.05 + age.current * 4.5)
    group.current.position.add(
      direction.normalize().multiplyScalar(Math.min(distance, speed * delta)),
    )
    group.current.lookAt(target)
    group.current.rotation.y += Math.PI

    const buildingHit = findBuildingCollision(
      group.current.position,
      buildings,
      damagedBuildings,
      performance.now() / 1000,
      0.8,
      flight.targetBuildingIndex,
    )
    if (buildingHit !== null) {
      complete.current = true
      onBuildingHit(flight, buildingHit, group.current.position.clone())
      return
    }

    for (const lid of lidPositions.current.values()) {
      if (group.current.position.distanceTo(lid) < 4.6) {
        complete.current = true
        onDestroyed(flight, group.current.position.clone())
        return
      }
    }
    if (distance < 1.2) {
      complete.current = true
      onStrike(flight, group.current.position.clone())
    }
  })

  return (
    <group ref={group} position={flight.start}>
      <Drone offset={[0, 0, 0]} active />
    </group>
  )
}

function ReplacementFlight({
  flight,
  formation,
  paused,
  lidPositions,
  onJoined,
  onDestroyed,
}: {
  flight: ReplacementFlightData
  formation: React.RefObject<THREE.Group | null>
  paused: boolean
  lidPositions: React.RefObject<Map<number, THREE.Vector3>>
  onJoined: (flight: ReplacementFlightData) => void
  onDestroyed: (
    flight: ReplacementFlightData,
    position: THREE.Vector3,
  ) => void
}) {
  const group = useRef<THREE.Group>(null)
  const joined = useRef(false)

  useFrame((_, delta) => {
    if (paused || joined.current || !group.current || !formation.current) return
    const offset = droneOffsets[flight.slot]
    const target = new THREE.Vector3(
      formation.current.position.x + offset[0],
      formation.current.position.y + offset[1],
      formation.current.position.z + offset[2],
    )
    const distance = group.current.position.distanceTo(target)
    group.current.position.lerp(
      target,
      Math.min(1, delta * (2.5 + Math.min(distance / 10, 3.5))),
    )
    group.current.lookAt(target)
    group.current.rotation.y += Math.PI
    for (const lid of lidPositions.current.values()) {
      if (group.current.position.distanceTo(lid) < 4.6) {
        joined.current = true
        onDestroyed(flight, group.current.position.clone())
        return
      }
    }
    if (distance < 0.3) {
      joined.current = true
      onJoined(flight)
    }
  })

  return (
    <group ref={group} position={flight.start}>
      <Drone offset={[0, 0, 0]} active />
    </group>
  )
}

function Simulation({
  onProgress,
  onAltitude,
  onAttackMode,
  onStations,
}: GameWorldProps) {
  const routeId = useGameStore((state) => state.route)!
  const route = ROUTES[routeId]
  const runSeed = useGameStore((state) => state.runSeed)
  const paused = useGameStore((state) => state.paused)
  const survivors = useGameStore((state) => state.survivors)
  const addScore = useGameStore((state) => state.addScore)
  const loseDrone = useGameStore((state) => state.loseDrone)
  const replenishFleet = useGameStore((state) => state.replenishFleet)
  const finishRun = useGameStore((state) => state.finishRun)
  const reducedEffects = useGameStore((state) => state.settings.reducedEffects)
  const cityLayout = useMemo(() => createCityLayout(runSeed), [runSeed])
  const { buildings, tanks, stations, crossRoads } = cityLayout
  const input = useFlightInput()
  const formation = useRef<THREE.Group>(null)
  const elapsed = useRef(0)
  const accumulator = useRef(0)
  const lastHudUpdate = useRef(0)
  const checkpointIndex = useRef(0)
  const nearMissIndex = useRef(1)
  const damageCooldown = useRef(0)
  const finished = useRef(false)
  const nextFlightId = useRef(1)
  const lidPositions = useRef<Map<number, THREE.Vector3>>(new Map())
  const lidHitCooldown = useRef(0)
  const [explodedTanks, setExplodedTanks] = useState<Set<number>>(new Set())
  const [damagedBuildings, setDamagedBuildings] = useState<BuildingDamage>(
    new Map(),
  )
  const [destroyedStations, setDestroyedStations] = useState<Set<number>>(
    new Set(),
  )
  const [attacks, setAttacks] = useState<AttackFlightData[]>([])
  const [replacements, setReplacements] = useState<ReplacementFlightData[]>([])
  const [refillingSlots, setRefillingSlots] = useState<Set<number>>(new Set())
  const [droneExplosions, setDroneExplosions] = useState<
    { id: number; position: [number, number, number] }[]
  >([])
  const explosionId = useRef(0)
  const { camera } = useThree()

  useEffect(() => {
    onAttackMode(attacks.length > 0)
  }, [attacks.length, onAttackMode])

  const addImpactExplosion = (position: { x: number; y: number; z: number }) => {
    setDroneExplosions((current) => [
      ...current.slice(-7),
      {
        id: explosionId.current++,
        position: [position.x, position.y, position.z],
      },
    ])
  }

  const explodeDrone = (position: THREE.Vector3) => {
    addImpactExplosion(position)
    const remaining = loseDrone()
    if (remaining === 0) {
      finished.current = true
      finishRun(false)
    }
    return remaining
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
    )
    const availableSlot = droneOffsets.findIndex(
      (_, slot) => slot < survivors && !refillingSlots.has(slot),
    )
    if (
      paused ||
      (targetKind === 'station'
        ? destroyedStations.has(targetIndex)
        : explodedTanks.has(targetIndex)) ||
      targeted ||
      availableSlot < 0 ||
      !formation.current
    ) {
      return
    }
    const id = nextFlightId.current++
    const offset = droneOffsets[availableSlot]
    const start: [number, number, number] = [
      formation.current.position.x + offset[0],
      formation.current.position.y + offset[1],
      formation.current.position.z + offset[2],
    ]
    setAttacks((current) => [
      ...current,
      {
        id,
        slot: availableSlot,
        targetKind,
        targetIndex,
        targetPosition,
        targetBuildingIndex,
        start,
      },
    ])
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
  }

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
    replenishFleet()
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

  const attackHitsBuilding = (
    flight: AttackFlightData,
    buildingIndex: number,
    position: THREE.Vector3,
  ) => {
    setAttacks((current) => current.filter((item) => item.id !== flight.id))
    damageBuilding(buildingIndex)
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
    position: THREE.Vector3,
  ) => {
    setReplacements((current) => current.filter((item) => item.id !== flight.id))
    setRefillingSlots((current) => {
      const next = new Set(current)
      next.delete(flight.slot)
      return next
    })
    addImpactExplosion(position)
    const remaining = loseDrone()
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
      lidHitCooldown.current = Math.max(0, lidHitCooldown.current - fixedDelta)

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
      formation.current.position.z -= fixedDelta * 3.05
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
        explodeDrone(formation.current.position.clone())
      }

      if (damageCooldown.current === 0) {
        const collision = droneOffsets
          .slice(0, survivors)
          .filter((_, slot) => !refillingSlots.has(slot))
          .map(
            (offset) => {
              const position = new THREE.Vector3(
                formation.current!.position.x + offset[0],
                formation.current!.position.y + offset[1],
                formation.current!.position.z + offset[2],
              )
              return {
                position,
                buildingIndex: findBuildingCollision(
                  position,
                  buildings,
                  damagedBuildings,
                  performance.now() / 1000,
                ),
              }
            },
          )
          .find(({ buildingIndex }) => buildingIndex !== null)
        if (collision && collision.buildingIndex !== null) {
          damageCooldown.current = 3
          damageBuilding(collision.buildingIndex)
          explodeDrone(collision.position)
        }
      }

      if (lidHitCooldown.current === 0) {
        const fleetPositions = droneOffsets
          .slice(0, survivors)
          .filter((_, slot) => !refillingSlots.has(slot))
          .map(
            (offset) =>
              new THREE.Vector3(
                formation.current!.position.x + offset[0],
                formation.current!.position.y + offset[1],
                formation.current!.position.z + offset[2],
              ),
          )
        const hit = fleetPositions.find((dronePosition) =>
          Array.from(lidPositions.current.values()).some(
            (lidPosition) => dronePosition.distanceTo(lidPosition) < 4.6,
          ),
        )
        if (hit) {
          lidHitCooldown.current = 2
          explodeDrone(hit)
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
      formationPosition.x * 0.35,
      formationPosition.y + 5.5,
      formationPosition.z + 15,
    )
    camera.position.lerp(desiredCamera, 0.055)
    camera.lookAt(
      formationPosition.x * 0.45,
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
      />
      <group ref={formation} position={[0, 5, 8]}>
        {droneOffsets.map((offset, index) => (
          <Drone
            key={index}
            offset={offset}
            active={
              index < survivors &&
              !refillingSlots.has(index)
            }
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
          onStrike={completeAttack}
          onBuildingHit={attackHitsBuilding}
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
          onJoined={joinReplacement}
          onDestroyed={destroyReplacement}
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
      {stations.map((station, index) => (
        <AirDefenseStation
          key={index}
          position={station.position}
          buildingIndex={station.buildingIndex}
          buildings={buildings}
          damagedBuildings={damagedBuildings}
          destroyed={destroyedStations.has(index)}
          targeted={attacks.some(
            (attack) =>
              attack.targetKind === 'station' && attack.targetIndex === index,
          )}
          onSelect={() =>
            launchAtTarget('station', index, [
              station.position[0],
              station.position[1] + 1.5,
              station.position[2],
            ], station.buildingIndex)
          }
        />
      ))}
      {tanks.map((tank, index) => (
        <OilTank
          key={index}
          index={index}
          position={tank.position}
          exploded={explodedTanks.has(index)}
          targeted={attacks.some(
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
          onLidPosition={(lidIndex, position) => {
            if (position) {
              lidPositions.current.set(lidIndex, position)
            } else {
              lidPositions.current.delete(lidIndex)
            }
          }}
        />
      ))}
      {Array.from(explodedTanks).map((tankIndex) => (
        <PollutionCloud
          key={tankIndex}
          index={tankIndex}
          position={tanks[tankIndex].position}
          reducedEffects={reducedEffects}
        />
      ))}
      {explodedTanks.size > 0 && (
        <DebrisField count={reducedEffects ? 24 : 100} />
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
