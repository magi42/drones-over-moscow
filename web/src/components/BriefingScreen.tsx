import { ROUTES } from '../game/config'
import { useGameStore } from '../store/gameStore'

export function BriefingScreen() {
  const routeId = useGameStore((state) => state.route)
  const startRun = useGameStore((state) => state.startRun)
  const advance = useGameStore((state) => state.advance)
  const route = routeId ? ROUTES[routeId] : null

  if (!route) {
    return (
      <section className="screen briefing-screen">
        <button className="primary-button" onClick={advance}>SELECT ROUTE</button>
      </section>
    )
  }

  return (
    <section className="screen briefing-screen">
      <div className="briefing-scanlines" />
      <div className="briefing-card">
        <div className="briefing-top">
          <span>MISSION DOSSIER / {route.callSign}</span>
          <span>CLASSIFIED // FICTIONAL</span>
        </div>
        <div className="drone-blueprint">
          <div className="drone-wire">
            <i className="wing wing-a" /><i className="wing wing-b" />
            <i className="body" />
            {[0, 1, 2, 3].map((n) => <b key={n} className={`rotor rotor-${n}`} />)}
          </div>
          <span className="measure measure-a">4 FIRE POINT FP-1 DRONES</span>
          <span className="measure measure-b">12 FP-1 RESERVES</span>
        </div>
        <div className="briefing-copy">
          <p className="eyebrow">LAUNCH ORIGIN</p>
          <h1>{route.name}</h1>
          <p>Fire Point FP-1 formation. {route.briefing}</p>
          <dl>
            <div><dt>Weather</dt><dd>{route.weather}</dd></div>
            <div><dt>Formation</dt><dd>{route.formation}</dd></div>
            <div><dt>Defense load</dt><dd>{Math.round(route.defenseIntensity * 100)}%</dd></div>
            <div><dt>Score factor</dt><dd>×{route.scoreMultiplier.toFixed(2)}</dd></div>
          </dl>
          <div className="control-hint">
            <span>WASD</span> GUIDE FLEET <span>CLICK</span> ATTACK TARGET <span>ESC</span> PAUSE
          </div>
          <button className="primary-button launch-button" onClick={startRun}>
            LAUNCH FP-1 FORMATION <span>↗</span>
          </button>
        </div>
      </div>
    </section>
  )
}
