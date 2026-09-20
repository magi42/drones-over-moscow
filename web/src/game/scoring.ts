import { ROUTES, SCORE_VALUES, type RouteId } from './config'

export type ScoreEvent =
  | 'checkpoint'
  | 'collateral'
  | 'oilTank'
  | 'airDefense'
  | 'chain'
  | 'nearMiss'

export function scoreEvent(event: ScoreEvent, route: RouteId) {
  return Math.round(SCORE_VALUES[event] * ROUTES[route].scoreMultiplier)
}

export function survivorBonus(survivors: number, route: RouteId) {
  return Math.round(
    Math.max(0, survivors) *
      SCORE_VALUES.survivor *
      ROUTES[route].scoreMultiplier,
  )
}
