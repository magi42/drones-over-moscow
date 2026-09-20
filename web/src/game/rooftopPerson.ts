export function isPersonJumpWindow(
  buildingRow: number,
  fleetRow: number,
  jumpAheadRows: 2 | 3 | 4,
) {
  const rowsAhead = buildingRow - fleetRow
  return (
    rowsAhead >= 2 &&
    rowsAhead <= 4 &&
    rowsAhead === jumpAheadRows
  )
}

export function rooftopPersonEdgePlacement(
  edge: 'player' | 'center',
  buildingX: number,
  width: number,
  depth: number,
  edgeOffset: number,
) {
  if (edge === 'player') {
    return {
      offset: [edgeOffset * width, depth / 2 - 0.3] as const,
      direction: [0, 2.2] as const,
    }
  }
  const centerDirection = buildingX > 0 ? -1 : 1
  return {
    offset: [
      centerDirection * (width / 2 - 0.3),
      edgeOffset * depth,
    ] as const,
    direction: [centerDirection * 2.2, 0] as const,
  }
}
