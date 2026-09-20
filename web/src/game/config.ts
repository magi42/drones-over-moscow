export type RouteId = 'finland' | 'estonia' | 'latvia' | 'ukraine'

export type RouteConfig = {
  id: RouteId
  name: string
  callSign: string
  weather: string
  formation: string
  defenseIntensity: number
  scoreMultiplier: number
  color: string
  mapPosition: { x: number; y: number }
  briefing: string
}

export const ROUTES: Record<RouteId, RouteConfig> = {
  finland: {
    id: 'finland',
    name: 'Finland',
    callSign: 'NORTH WIND',
    weather: 'Aurora haze',
    formation: 'Wide diamond',
    defenseIntensity: 0.8,
    scoreMultiplier: 0.9,
    color: '#70d9e7',
    mapPosition: { x: 27, y: 24 },
    briefing: 'Cold air, long shadows, and a forgiving radar corridor.',
  },
  estonia: {
    id: 'estonia',
    name: 'Estonia',
    callSign: 'PINE NEEDLE',
    weather: 'Low cloud',
    formation: 'Tight diamond',
    defenseIntensity: 1,
    scoreMultiplier: 1,
    color: '#6fa8ff',
    mapPosition: { x: 20, y: 43 },
    briefing: 'Balanced conditions and a compact Baltic approach.',
  },
  latvia: {
    id: 'latvia',
    name: 'Latvia',
    callSign: 'AMBER ROAD',
    weather: 'Crosswind',
    formation: 'Staggered line',
    defenseIntensity: 1.15,
    scoreMultiplier: 1.15,
    color: '#e58c70',
    mapPosition: { x: 18, y: 55 },
    briefing: 'Turbulent air and dense defenses reward precise flying.',
  },
  ukraine: {
    id: 'ukraine',
    name: 'Ukraine',
    callSign: 'SUNFLOWER',
    weather: 'Summer storm',
    formation: 'Arrowhead',
    defenseIntensity: 1.3,
    scoreMultiplier: 1.3,
    color: '#f0c84d',
    mapPosition: { x: 28, y: 81 },
    briefing: 'The hardest route: lightning, aggressive tracking, high reward.',
  },
}

export const ROUTE_LIST = Object.values(ROUTES)

export const SCORE_VALUES = {
  checkpoint: 500,
  survivor: 1200,
  collateral: 150,
  oilTank: 750,
  airDefense: 1100,
  chain: 400,
  nearMiss: 100,
}

export const RUN_DURATION_SECONDS = 72
export const CHECKPOINTS = [0.2, 0.42, 0.66, 0.86]
export const TOTAL_DRONE_INVENTORY = 24
