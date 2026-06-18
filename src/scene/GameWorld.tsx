import { Sky } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  attack: boolean
}

const droneOffsets: [number, number, number][] = [
  [0, 0, 0],
  [-4.4, -0.35, 2.4],
  [4.4, -0.35, 2.4],
  [0, -0.55, 5],
]

const buildingData = Array.from({ length: 52 }, (_, index) => {
  const side = index % 2 === 0 ? -1 : 1
  const row = Math.floor(index / 2)
  const rand = mulberry32(4100 + index)
  return {
    position: [side * (9 + rand() * 17), rand() * 1.2 - 2, -row * 11 + rand() * 5] as [
      number,
      number,
      number,
    ],
    scale: [4 + rand() * 7, 5 + rand() * 18, 4 + rand() * 8] as [
      number,
      number,
      number,
    ],
    color: rand() > 0.55 ? '#4f554f' : '#373e3c',
  }
})

const tankData = Array.from({ length: 12 }, (_, index) => ({
  position: [
    (index % 2 ? 1 : -1) * (12 + (index % 3) * 5),
    1.5,
    -35 - index * 15,
  ] as [number, number, number],
}))

const stationData = [7, 17, 29, 39].map((buildingIndex) => {
  const building = buildingData[buildingIndex]
  return {
    buildingIndex,
    position: [
      building.position[0],
      building.position[1] + building.scale[1] / 2 + 0.42,
      building.position[2],
    ] as [number, number, number],
  }
})

export function collidesWithBuilding(position: THREE.Vector3, radius = 1.1) {
  return buildingData.some((building) => {
    const [x, y, z] = building.position
    const [width, height, depth] = building.scale
    return (
      Math.abs(position.x - x) <= width / 2 + radius &&
      Math.abs(position.y - y) <= height / 2 + radius &&
      Math.abs(position.z - z) <= depth / 2 + radius
    )
  })
}

function useFlightInput() {
  const bindings = useGameStore((state) => state.settings.bindings)
  const input = useRef<InputState>({
    left: false,
    right: false,
    up: false,
    down: false,
    attack: false,
  })

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      const action = actionForCode(event.code, bindings)
      if (!action || action === 'pause') return
      if (action === 'attack') return
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

function City() {
  const buildings = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    if (!buildings.current) return
    const transform = new THREE.Object3D()
    buildingData.forEach((building, index) => {
      transform.position.set(...building.position)
      transform.scale.set(...building.scale)
      transform.updateMatrix()
      buildings.current!.setMatrixAt(index, transform.matrix)
      buildings.current!.setColorAt(index, new THREE.Color(building.color))
    })
    buildings.current.instanceMatrix.needsUpdate = true
    if (buildings.current.instanceColor) {
      buildings.current.instanceColor.needsUpdate = true
    }
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, -85]} receiveShadow>
        <planeGeometry args={[150, 260]} />
        <meshStandardMaterial color="#202622" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.94, -85]}>
        <planeGeometry args={[12, 260]} />
        <meshStandardMaterial color="#171a19" roughness={0.9} />
      </mesh>
      <instancedMesh
        ref={buildings}
        args={[undefined, undefined, buildingData.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.88} />
      </instancedMesh>
      {Array.from({ length: 26 }, (_, index) => (
        <mesh key={index} position={[0, -2.75, 10 - index * 10]}>
          <boxGeometry args={[0.15, 0.05, 4]} />
          <meshBasicMaterial color="#d9b566" />
        </mesh>
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
  position,
  exploded,
}: {
  position: [number, number, number]
  exploded: boolean
}) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[4.3, 4.3, 3.4, 20]} />
        <meshStandardMaterial color={exploded ? '#342f28' : '#8c9287'} metalness={0.7} roughness={0.48} />
      </mesh>
      {!exploded && (
        <group position={[0, 1.86, 0]}>
          <mesh castShadow scale={[1, 0.19, 1]}>
            <sphereGeometry args={[4.45, 24, 12]} />
            <meshStandardMaterial color="#aeb6aa" metalness={0.76} roughness={0.36} />
          </mesh>
          <mesh position={[0, -0.34, 0]} castShadow>
            <cylinderGeometry args={[4.42, 4.42, 0.34, 24]} />
            <meshStandardMaterial color="#979f95" metalness={0.72} roughness={0.4} />
          </mesh>
        </group>
      )}
      {exploded && (
        <RigidBody
          type="dynamic"
          position={[0, 1.86, 0]}
          colliders="hull"
          mass={2}
          restitution={0.42}
          linearVelocity={[position[0] > 0 ? -7 : 7, 24, 3]}
          angularVelocity={[8, 4, 12]}
        >
          <group>
            <mesh castShadow scale={[1, 0.19, 1]}>
              <sphereGeometry args={[4.45, 24, 12]} />
              <meshStandardMaterial color="#aeb6aa" metalness={0.76} roughness={0.36} />
            </mesh>
            <mesh position={[0, -0.34, 0]} castShadow>
              <cylinderGeometry args={[4.42, 4.42, 0.34, 24]} />
              <meshStandardMaterial color="#979f95" metalness={0.72} roughness={0.4} />
            </mesh>
          </group>
        </RigidBody>
      )}
      {exploded && <Explosion />}
    </group>
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

function AirDefenseStation({
  position,
  destroyed,
}: {
  position: [number, number, number]
  destroyed: boolean
}) {
  return (
    <group position={position}>
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
}: {
  target: React.RefObject<THREE.Group | null>
  active: boolean
  intensity: number
  destroyedStations: Set<number>
  destroyedTanks: Set<number>
  onImpact: (impact: MissileImpact) => void
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
            y: building.position[1] + building.scale[1] / 2,
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
        y: station.position[1] + 3.6,
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

function Simulation({
  onProgress,
  onAltitude,
  onAttackMode,
  onStations,
}: GameWorldProps) {
  const routeId = useGameStore((state) => state.route)!
  const route = ROUTES[routeId]
  const paused = useGameStore((state) => state.paused)
  const survivors = useGameStore((state) => state.survivors)
  const attackRequest = useGameStore((state) => state.attackRequest)
  const addScore = useGameStore((state) => state.addScore)
  const loseDrone = useGameStore((state) => state.loseDrone)
  const replenishFleet = useGameStore((state) => state.replenishFleet)
  const finishRun = useGameStore((state) => state.finishRun)
  const reducedEffects = useGameStore((state) => state.settings.reducedEffects)
  const input = useFlightInput()
  const formation = useRef<THREE.Group>(null)
  const attackDrone = useRef<THREE.Group>(null)
  const elapsed = useRef(0)
  const accumulator = useRef(0)
  const lastHudUpdate = useRef(0)
  const checkpointIndex = useRef(0)
  const nearMissIndex = useRef(1)
  const damageCooldown = useRef(0)
  const attackPressed = useRef(false)
  const consumedAttackRequest = useRef(0)
  const attackModeRef = useRef(false)
  const finished = useRef(false)
  const [explodedTanks, setExplodedTanks] = useState<Set<number>>(new Set())
  const [destroyedStations, setDestroyedStations] = useState<Set<number>>(
    new Set(),
  )
  const [attackMode, setAttackMode] = useState(false)
  const [attackStart, setAttackStart] = useState<[number, number, number]>([
    0, 8, 8,
  ])
  const [droneExplosions, setDroneExplosions] = useState<
    { id: number; position: [number, number, number] }[]
  >([])
  const explosionId = useRef(0)
  const { camera } = useThree()

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
      const gamepadAttack = Boolean(gamepad?.buttons[0]?.pressed)
      const keyboardAttack = attackRequest > consumedAttackRequest.current
      const attackRequested = keyboardAttack || gamepadAttack

      if (
        attackRequested &&
        (keyboardAttack || !attackPressed.current) &&
        !attackModeRef.current &&
        survivors > 0
      ) {
        attackModeRef.current = true
        setAttackMode(true)
        setAttackStart([
          formation.current.position.x,
          formation.current.position.y,
          formation.current.position.z,
        ])
        onAttackMode(true)
      }
      if (keyboardAttack) consumedAttackRequest.current = attackRequest
      attackPressed.current = gamepadAttack

      if (attackModeRef.current) {
        formation.current.position.x = THREE.MathUtils.lerp(
          formation.current.position.x,
          0,
          fixedDelta * 0.45,
        )
        formation.current.position.y = THREE.MathUtils.lerp(
          formation.current.position.y,
          15,
          fixedDelta * 0.35,
        )
        if (attackDrone.current) {
          attackDrone.current.position.x = THREE.MathUtils.clamp(
            attackDrone.current.position.x + horizontal * fixedDelta * 13,
            -28,
            28,
          )
          attackDrone.current.position.y = THREE.MathUtils.clamp(
            attackDrone.current.position.y + vertical * fixedDelta * 11,
            -1.2,
            28,
          )
          attackDrone.current.position.z -= fixedDelta * 5.6
          attackDrone.current.rotation.z = THREE.MathUtils.lerp(
            attackDrone.current.rotation.z,
            -horizontal * 0.3,
            0.1,
          )
          attackDrone.current.rotation.x = THREE.MathUtils.lerp(
            attackDrone.current.rotation.x,
            vertical * 0.16,
            0.1,
          )
        }
      } else {
        formation.current.position.x = THREE.MathUtils.clamp(
          formation.current.position.x + horizontal * fixedDelta * 10,
          -18,
          18,
        )
        formation.current.position.y = THREE.MathUtils.clamp(
          formation.current.position.y + vertical * fixedDelta * 10,
          0.5,
          28,
        )
      }
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

      if (damageCooldown.current === 0 && !attackModeRef.current) {
        const collision = droneOffsets
          .slice(0, survivors)
          .map(
            (offset) =>
              new THREE.Vector3(
                formation.current!.position.x + offset[0],
                formation.current!.position.y + offset[1],
                formation.current!.position.z + offset[2],
              ),
          )
          .find((position) => collidesWithBuilding(position))
        if (collision) {
          damageCooldown.current = 3
          explodeDrone(collision)
        }
      }

      if (attackModeRef.current && attackDrone.current) {
        const attackPosition = attackDrone.current.position
        const stationHit = stationData.findIndex(
          (station, index) =>
            !destroyedStations.has(index) &&
            attackPosition.distanceTo(
              new THREE.Vector3(
                station.position[0],
                station.position[1] + 1.5,
                station.position[2],
              ),
            ) < 4.2,
        )
        if (
          stationHit >= 0 ||
          collidesWithBuilding(attackPosition, 0.8) ||
          attackPosition.y < -0.8
        ) {
          if (stationHit >= 0) {
            const nextDestroyed = new Set(destroyedStations).add(stationHit)
            setDestroyedStations(nextDestroyed)
            onStations(nextDestroyed.size, stationData.length)
            addScore('airDefense')
            addImpactExplosion(attackPosition)
            replenishFleet()
          } else {
            explodeDrone(attackPosition.clone())
          }
          attackModeRef.current = false
          setAttackMode(false)
          onAttackMode(false)
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
            (attackMode && attackDrone.current
              ? attackDrone.current.position.y
              : formation.current.position.y) *
              24,
        ),
      )
    }
    const cameraTarget =
      attackMode && attackDrone.current ? attackDrone.current : formation.current
    const desiredCamera = new THREE.Vector3(
      cameraTarget.position.x * 0.35,
      cameraTarget.position.y + 5.5,
      cameraTarget.position.z + 15,
    )
    camera.position.lerp(desiredCamera, 0.055)
    camera.lookAt(
      cameraTarget.position.x * 0.45,
      cameraTarget.position.y,
      cameraTarget.position.z - 14,
    )
  })

  return (
    <>
      <City />
      <group ref={formation} position={[0, 5, 8]}>
        {droneOffsets.map((offset, index) => (
          <Drone
            key={index}
            offset={offset}
            active={
              index < survivors &&
              !(attackMode && index === Math.max(0, survivors - 1))
            }
          />
        ))}
      </group>
      {attackMode && (
        <group ref={attackDrone} position={attackStart}>
          <Drone offset={[0, 0, 0]} active />
        </group>
      )}
      <Missiles
        target={attackMode ? attackDrone : formation}
        active={!paused}
        intensity={route.defenseIntensity}
        destroyedStations={destroyedStations}
        destroyedTanks={explodedTanks}
        onImpact={(impact) => {
          addImpactExplosion(impact.position)
          if (impact.kind === 'tank') {
            setExplodedTanks((current) => {
              if (current.has(impact.index)) return current
              addScore('oilTank')
              return new Set(current).add(impact.index)
            })
          } else {
            addScore('collateral')
          }
        }}
      />
      {stationData.map((station, index) => (
        <AirDefenseStation
          key={index}
          position={station.position}
          destroyed={destroyedStations.has(index)}
        />
      ))}
      {tankData.map((tank, index) => (
        <OilTank
          key={index}
          position={tank.position}
          exploded={explodedTanks.has(index)}
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
      <ambientLight intensity={0.85} />
      <directionalLight
        castShadow
        position={[-25, 38, 18]}
        intensity={2.4}
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
