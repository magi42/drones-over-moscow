import { ROUTE_LIST } from '../game/config'
import { useGameStore } from '../store/gameStore'

export function CountrySelect() {
  const selectRoute = useGameStore((state) => state.selectRoute)

  return (
    <section className="screen map-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">PHASE 01 / ORIGIN VECTOR</p>
          <h1>Select launch corridor</h1>
        </div>
        <p className="fiction-label">FICTIONAL ROUTES · STYLIZED GEOGRAPHY</p>
      </header>
      <div className="route-layout">
        <div className="route-map" aria-label="Stylized route map">
          <div className="map-grid" />
          <div className="russia-shape">
            <span>RUSSIAN FEDERATION</span>
          </div>
          <div className="moscow-marker"><i />MOSCOW</div>
          {ROUTE_LIST.map((route) => (
            <button
              key={route.id}
              className={`country-node ${route.id !== 'ukraine' ? 'disabled' : ''}`}
              disabled={route.id !== 'ukraine'}
              style={{
                left: `${route.mapPosition.x}%`,
                top: `${route.mapPosition.y}%`,
                '--route-color': route.color,
              } as React.CSSProperties}
              onClick={() => route.id === 'ukraine' && selectRoute(route.id)}
            >
              <i />
              <span>{route.name}</span>
            </button>
          ))}
          <svg className="route-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            {ROUTE_LIST.map((route) => (
              <line
                key={route.id}
                x1={route.mapPosition.x}
                y1={route.mapPosition.y}
                x2="67"
                y2="51"
                style={{ stroke: route.color }}
              />
            ))}
          </svg>
        </div>
        <aside className="route-list">
          <p className="eyebrow">AVAILABLE CORRIDORS</p>
          {ROUTE_LIST.map((route, index) => (
            <button
              key={route.id}
              disabled={route.id !== 'ukraine'}
              onClick={() => route.id === 'ukraine' && selectRoute(route.id)}
            >
              <span>0{index + 1}</span>
              <div><strong>{route.name}</strong><small>{route.callSign}</small></div>
              <b>
                {route.id === 'ukraine'
                  ? `×${route.scoreMultiplier.toFixed(2)}`
                  : 'LOCKED'}
              </b>
            </button>
          ))}
        </aside>
      </div>
    </section>
  )
}
