export const REPLACEMENT_JOIN_DISTANCE = 0.45

export function replacementTravelDistance(distance: number, delta: number) {
  const catchUpSpeed = 14 + Math.min(distance * 0.45, 12)
  return Math.min(distance, catchUpSpeed * delta)
}
