export const CITY_FIRST_ROW_Z = 8
export const CITY_ROW_SPACING = 15
export const BUILDING_RENDER_ROW_COUNT = 10
export const FLEET_FORWARD_SPEED = 3.05

export function buildingWindowStartRow(fleetZ: number) {
  return Math.max(
    0,
    Math.floor((CITY_FIRST_ROW_Z - fleetZ) / CITY_ROW_SPACING),
  )
}

export function isBuildingRowVisible(row: number, startRow: number) {
  return row >= startRow && row < startRow + BUILDING_RENDER_ROW_COUNT
}

export function availableJumpAheadRows(buildingRow: number) {
  return ([2, 3, 4] as const).filter(
    (rowsAhead) => rowsAhead <= buildingRow,
  )
}

export function cityRowForZ(z: number) {
  return Math.max(
    0,
    Math.round((CITY_FIRST_ROW_Z - z) / CITY_ROW_SPACING),
  )
}

export function stationIndicesByRowBand(
  buildingRows: number[],
  stationsPerBand = 4,
  rowsPerBand = 10,
) {
  const bands = new Map<number, number[]>()
  buildingRows.forEach((row, buildingIndex) => {
    const band = Math.floor(row / rowsPerBand)
    const entries = bands.get(band) ?? []
    entries.push(buildingIndex)
    bands.set(band, entries)
  })
  return Array.from(bands.entries())
    .sort(([a], [b]) => a - b)
    .flatMap(([, buildingIndices]) =>
      buildingIndices.slice(0, stationsPerBand),
    )
}
