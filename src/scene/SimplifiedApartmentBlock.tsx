import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import wallTexture10Url from '../assets/assets/models/textures/texture-house-wall-10-storeys-white.jpg'
import wallTexture11Url from '../assets/assets/models/textures/texture-house-wall-11-storeys-white.jpg'
import wallTexture15Url from '../assets/assets/models/textures/texture-house-wall-15-storeys-white.jpg'
import {
  isPersonJumpWindow,
  rooftopPersonEdgePlacement,
} from '../game/rooftopPerson'

type SimplifiedApartmentBlockProps = {
  position: [number, number, number]
  scale: [number, number, number]
  storeyCount: 10 | 11 | 15
  rotation: number
  hitAt: number | undefined
  collapseSeconds: number
  person: RooftopPersonConfig | null
  paused: boolean
  buildingRow: number
  fleetRow: number
}

export type RooftopPersonConfig = {
  edge: 'player' | 'center'
  jumpAheadRows: 2 | 3 | 4
  jumpDelayWithinRow: number
  upperColor: string
  lowerColor: string
  edgeOffset: number
}

const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1)
const antennaGeometry = new THREE.CylinderGeometry(0.11, 0.14, 1, 6)
const limbGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.7, 6)
const headGeometry = new THREE.SphereGeometry(0.18, 8, 6)
const blackColor = new THREE.Color('#080908')
const blackEmissive = new THREE.Color('#020202')
const roofBlockPositions: [number, number][] = [
  [-0.28, -0.24],
  [0.3, -0.22],
  [-0.3, 0.24],
  [0.27, 0.25],
]

const antennaPositions: [number, number][] = [
  [-0.23, 0.03],
  [0.02, -0.12],
  [0.26, 0.1],
]

function RooftopPerson({
  buildingPosition,
  buildingHeight,
  buildingWidth,
  buildingDepth,
  buildingRow,
  fleetRow,
  hitAt,
  collapseSeconds,
  config,
  paused,
}: {
  buildingPosition: [number, number, number]
  buildingHeight: number
  buildingWidth: number
  buildingDepth: number
  buildingRow: number
  fleetRow: number
  hitAt: number | undefined
  collapseSeconds: number
  config: RooftopPersonConfig
  paused: boolean
}) {
  const person = useRef<THREE.Group>(null)
  const jumpWindowElapsed = useRef(0)
  const phase = useRef<'standing' | 'jumping' | 'collapse' | 'lying'>(
    'standing',
  )
  const velocityY = useRef(0)
  const roofHeight = buildingPosition[1] + buildingHeight / 2
  const groundY = -2.78
  const edgePlacement = useMemo(
    () =>
      rooftopPersonEdgePlacement(
        config.edge,
        buildingPosition[0],
        buildingWidth,
        buildingDepth,
        config.edgeOffset,
      ),
    [
      buildingDepth,
      buildingPosition,
      buildingWidth,
      config.edge,
      config.edgeOffset,
    ],
  )
  const upperMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: config.upperColor,
        roughness: 0.8,
      }),
    [config.upperColor],
  )
  const lowerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: config.lowerColor,
        roughness: 0.84,
      }),
    [config.lowerColor],
  )
  const skinMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#d7a078',
        roughness: 0.82,
      }),
    [],
  )

  useEffect(
    () => () => {
      upperMaterial.dispose()
      lowerMaterial.dispose()
      skinMaterial.dispose()
    },
    [lowerMaterial, skinMaterial, upperMaterial],
  )

  useFrame((_, delta) => {
    if (paused || !person.current || phase.current === 'lying') return
    const inJumpWindow = isPersonJumpWindow(
      buildingRow,
      fleetRow,
      config.jumpAheadRows,
    )
    if (phase.current === 'standing' && inJumpWindow) {
      jumpWindowElapsed.current += delta
    }

    if (phase.current === 'standing' && hitAt !== undefined) {
      phase.current = 'collapse'
    } else if (
      phase.current === 'standing' &&
      inJumpWindow &&
      jumpWindowElapsed.current >= config.jumpDelayWithinRow
    ) {
      phase.current = 'jumping'
      velocityY.current = 1.7
    }

    if (phase.current === 'standing') {
      person.current.position.set(
        buildingPosition[0] + edgePlacement.offset[0],
        roofHeight + 1.05,
        buildingPosition[2] + edgePlacement.offset[1],
      )
      return
    }

    if (phase.current === 'collapse') {
      const progress =
        hitAt === undefined
          ? 0
          : THREE.MathUtils.clamp(
              (performance.now() / 1000 - hitAt) / collapseSeconds,
              0,
              1,
            )
      person.current.position.set(
        buildingPosition[0] + edgePlacement.offset[0],
        THREE.MathUtils.lerp(roofHeight + 1.05, groundY, progress),
        buildingPosition[2] + edgePlacement.offset[1],
      )
      person.current.rotation.x = progress * 0.9
      if (progress >= 1) {
        phase.current = 'lying'
        person.current.position.y = groundY
        person.current.rotation.z = Math.PI / 2
      }
      return
    }

    velocityY.current -= 8.5 * delta
    person.current.position.x += edgePlacement.direction[0] * delta
    person.current.position.z += edgePlacement.direction[1] * delta
    person.current.position.y += velocityY.current * delta
    person.current.rotation.x += delta * 1.8
    if (person.current.position.y <= groundY) {
      phase.current = 'lying'
      person.current.position.y = groundY
      person.current.rotation.z = Math.PI / 2
    }
  })

  return (
    <group
      ref={person}
      position={[
        buildingPosition[0] + edgePlacement.offset[0],
        roofHeight + 1.05,
        buildingPosition[2] + edgePlacement.offset[1],
      ]}
      rotation={[
        0,
        Math.atan2(
          edgePlacement.direction[0],
          edgePlacement.direction[1],
        ),
        0,
      ]}
      scale={0.82}
    >
      <mesh geometry={headGeometry} material={skinMaterial} position={[0, 0.95, 0]} castShadow />
      <mesh geometry={unitBoxGeometry} material={upperMaterial} position={[0, 0.48, 0]} scale={[0.32, 0.55, 0.2]} castShadow />
      <mesh geometry={limbGeometry} material={upperMaterial} position={[-0.25, 0.48, 0]} rotation={[0, 0, -0.35]} castShadow />
      <mesh geometry={limbGeometry} material={upperMaterial} position={[0.25, 0.48, 0]} rotation={[0, 0, 0.35]} castShadow />
      <mesh geometry={unitBoxGeometry} material={lowerMaterial} position={[0, 0.12, 0]} scale={[0.3, 0.22, 0.2]} castShadow />
      <mesh geometry={limbGeometry} material={lowerMaterial} position={[-0.1, -0.28, 0]} castShadow />
      <mesh geometry={limbGeometry} material={lowerMaterial} position={[0.1, -0.28, 0]} castShadow />
    </group>
  )
}

export function SimplifiedApartmentBlock({
  position,
  scale,
  storeyCount,
  rotation,
  hitAt,
  collapseSeconds,
  person,
  paused,
  buildingRow,
  fleetRow,
}: SimplifiedApartmentBlockProps) {
  const group = useRef<THREE.Group>(null)
  const { gl } = useThree()
  const [wallTexture10, wallTexture11, wallTexture15] = useTexture([
    wallTexture10Url,
    wallTexture11Url,
    wallTexture15Url,
  ])
  const [width, height, depth] = scale
  const roofHeight = position[1] + height / 2
  const wallTexture =
    storeyCount === 10
      ? wallTexture10
      : storeyCount === 11
        ? wallTexture11
        : wallTexture15
  useEffect(() => {
    for (const texture of [wallTexture10, wallTexture11, wallTexture15]) {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
      texture.needsUpdate = true
    }
  }, [gl, wallTexture10, wallTexture11, wallTexture15])
  const materials = useMemo(
    () => [
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: wallTexture,
        emissive: '#454b47',
        emissiveIntensity: 0.12,
        roughness: 0.88,
      }),
      new THREE.MeshStandardMaterial({
        color: '#e1e4df',
        emissive: '#626b66',
        emissiveIntensity: 0.25,
        roughness: 0.8,
      }),
      new THREE.MeshStandardMaterial({
        color: '#9ba39e',
        emissive: '#3f4742',
        emissiveIntensity: 0.18,
        roughness: 0.76,
      }),
      new THREE.MeshStandardMaterial({
        color: '#737c77',
        emissive: '#303632',
        emissiveIntensity: 0.15,
        roughness: 0.58,
        metalness: 0.42,
      }),
      new THREE.MeshStandardMaterial({
        color: '#777d79',
        roughness: 0.95,
      }),
    ],
    [wallTexture],
  )
  const bodyMaterials = useMemo(
    () => [
      materials[0],
      materials[0],
      materials[4],
      materials[4],
      materials[0],
      materials[0],
    ],
    [materials],
  )
  const baseMaterialValues = useMemo(
    () =>
      materials.map((material) => ({
        color: material.color.clone(),
        emissive: material.emissive.clone(),
        emissiveIntensity: material.emissiveIntensity,
      })),
    [materials],
  )

  useEffect(
    () => () => {
      materials.forEach((material) => material.dispose())
    },
    [materials],
  )

  useFrame(() => {
    const progress =
      hitAt === undefined
        ? 0
        : THREE.MathUtils.clamp(
            (performance.now() / 1000 - hitAt) / collapseSeconds,
            0,
            1,
          )
    if (group.current) {
      // Lowering the complete model below ground removes height from the bottom.
      group.current.position.y = roofHeight - height * (2 / 3) * progress
    }
    materials.forEach((material, index) => {
      const base = baseMaterialValues[index]
      material.color.copy(base.color).lerp(blackColor, progress * 0.88)
      material.emissive.copy(base.emissive).lerp(blackEmissive, progress)
      material.emissiveIntensity = THREE.MathUtils.lerp(
        base.emissiveIntensity,
        0.04,
        progress,
      )
    })
  })

  return (
    <>
      <group
        ref={group}
        position={[position[0], roofHeight, position[2]]}
        rotation={[0, rotation, 0]}
      >
      <mesh
        geometry={unitBoxGeometry}
        material={bodyMaterials}
        position={[0, -height / 2, 0]}
        scale={[width, height, depth]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={unitBoxGeometry}
        material={materials[1]}
        position={[0, 0.18, 0]}
        scale={[width + 0.4, 0.36, depth + 0.4]}
        castShadow
        receiveShadow
      />
      {roofBlockPositions.map(([x, z], index) => (
        <mesh
          key={index}
          geometry={unitBoxGeometry}
          material={materials[2]}
          position={[x * width, 0.78, z * depth]}
          scale={[1.6, 1.2 + (index % 2) * 0.35, 1.35]}
          castShadow
          receiveShadow
        />
      ))}
      {antennaPositions.map(([x, z], index) => {
        const antennaHeight = 3.2 + index * 0.75
        return (
          <mesh
            key={index}
            geometry={antennaGeometry}
            material={materials[3]}
            position={[x * width, 0.36 + antennaHeight / 2, z * depth]}
            scale={[1, antennaHeight, 1]}
            castShadow
          />
        )
      })}
      </group>
      {person && (
        <RooftopPerson
          buildingPosition={position}
          buildingHeight={height}
          buildingWidth={width}
          buildingDepth={depth}
          buildingRow={buildingRow}
          fleetRow={fleetRow}
          hitAt={hitAt}
          collapseSeconds={collapseSeconds}
          config={person}
          paused={paused}
        />
      )}
    </>
  )
}
