export function protectedBuildingIndices(
  stationBuildingIndices: number[],
  buildingsWithPeople: boolean[],
) {
  const protectedIndices = new Set(stationBuildingIndices)
  buildingsWithPeople.forEach((hasPerson, buildingIndex) => {
    if (hasPerson) protectedIndices.add(buildingIndex)
  })
  return protectedIndices
}
