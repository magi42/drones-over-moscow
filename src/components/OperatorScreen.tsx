import { useGameStore } from '../store/gameStore'

export function OperatorScreen() {
  const advance = useGameStore((state) => state.advance)
  const setSettingsOpen = useGameStore((state) => state.setSettingsOpen)

  return (
    <section className="screen operator-screen">
      <div className="operator-room">
        <div className="ceiling-light" />
        <h1 className="main-game-title">
          DRONES <b>over</b> MOSCOW
        </h1>
        <div className="monitor monitor-left">
          <span>UPLINK / STABLE</span>
          <div className="radar-sweep"><i /></div>
        </div>
        <div className="monitor monitor-center">
          <div className="monitor-header">
            <span>OPERATOR STATION 04</span>
            <span>03:17:42 Z</span>
          </div>
          <div className="operator-feed">
            <div className="operator-silhouette">
              <i className="head" /><i className="body" />
            </div>
            <div>
              <p className="eyebrow">IDENTITY CONFIRMED</p>
              <h1>Fire Point FP-1 operator.</h1>
              <p>
                Four Ukrainian Fire Point FP-1 drones await your guidance, with
                twenty more in reserve. Keep the FP-1 formation intact.
              </p>
              <button className="primary-button" onClick={advance}>
                ACCEPT MISSION <span>→</span>
              </button>
            </div>
          </div>
        </div>
        <div className="monitor monitor-right">
          <span>WEATHER / NOMINAL</span>
          <div className="signal-bars">{[1, 2, 3, 4, 5].map((n) => <i key={n} />)}</div>
        </div>
        <div className="console-desk">
          <div className="keyboard" />
          <div className="joystick"><i /></div>
          <button
            className="settings-key"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            SETTINGS
          </button>
        </div>
      </div>
    </section>
  )
}
