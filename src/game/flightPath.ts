export type FlightPoint = {
  x: number
  y: number
  z: number
}

export type FlightObstacle = {
  position: readonly [number, number, number]
  scale: readonly [number, number, number]
}

export function requiredFlightArc(
  start: FlightPoint,
  target: FlightPoint,
  buildings: FlightObstacle[],
  excludedBuildingIndex: number | null,
  clearance = 7,
) {
  const dx = target.x - start.x
  const dz = target.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared === 0) return 0

  return buildings.reduce((arcHeight, building, index) => {
    if (index === excludedBuildingIndex) return arcHeight
    const [x, y, z] = building.position
    const [width, height, depth] = building.scale
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared,
      ),
    )
    if (t <= 0.04 || t >= 0.96) return arcHeight

    const pathX = start.x + dx * t
    const pathZ = start.z + dz * t
    const corridorPadding = 3.5
    if (
      Math.abs(pathX - x) > width / 2 + corridorPadding ||
      Math.abs(pathZ - z) > depth / 2 + corridorPadding
    ) {
      return arcHeight
    }

    const roof = y + height / 2
    const straightY = start.y + (target.y - start.y) * t
    const parabolaAtT = 4 * t * (1 - t)
    const requiredHeight = (roof + clearance - straightY) / parabolaAtT
    return Math.max(arcHeight, requiredHeight)
  }, 0)
}

export function pointOnFlightArc(
  start: FlightPoint,
  target: FlightPoint,
  progress: number,
  arcHeight: number,
) {
  const t = Math.max(0, Math.min(1, progress))
  return {
    x: start.x + (target.x - start.x) * t,
    y:
      start.y +
      (target.y - start.y) * t +
      4 * arcHeight * t * (1 - t),
    z: start.z + (target.z - start.z) * t,
  }
}
