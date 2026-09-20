import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'

export function BootScreen() {
  const advance = useGameStore((state) => state.advance)

  useEffect(() => {
    const timeout = window.setTimeout(advance, 2100)
    return () => window.clearTimeout(timeout)
  }, [advance])

  return (
    <section className="screen boot-screen" aria-label="Loading game">
      <div className="boot-grid" />
      <div className="boot-lock">
        <span className="target-ring" />
        <div className="boot-title">
          <p>REMOTE AVIATION TERMINAL / 04</p>
          <h1>DRONES <span>over</span><br />MOSCOW</h1>
          <div className="boot-loader"><i /></div>
          <small>ESTABLISHING ENCRYPTED UPLINK</small>
        </div>
      </div>
    </section>
  )
}
