import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useState } from 'react'
import { ROUTES } from '../game/config'
import { useGameStore } from '../store/gameStore'
import { GameWorld } from '../scene/GameWorld'

function FlightAudio() {
  const volume = useGameStore((state) => state.settings.masterVolume)

  useEffect(() => {
    const AudioContextClass = window.AudioContext
    const context = new AudioContextClass()
    const master = context.createGain()
    const lowPass = context.createBiquadFilter()
    const motorA = context.createOscillator()
    const motorB = context.createOscillator()
    master.gain.value = volume * 0.055
    lowPass.type = 'lowpass'
    lowPass.frequency.value = 310
    motorA.type = 'sawtooth'
    motorA.frequency.value = 72
    motorB.type = 'square'
    motorB.frequency.value = 76
    motorA.connect(lowPass)
    motorB.connect(lowPass)
    lowPass.connect(master)
    master.connect(context.destination)
    motorA.start()
    motorB.start()
    void context.resume()
    return () => {
      motorA.stop()
      motorB.stop()
      void context.close()
    }
  }, [volume])

  return null
}

export function FlyoverScreen() {
  const [progress, setProgress] = useState(0)
  const [altitude, setAltitude] = useState(200)
  const [attackMode, setAttackMode] = useState(false)
  const [stations, setStations] = useState({ destroyed: 0, total: 4 })
  const routeId = useGameStore((state) => state.route)!
  const route = ROUTES[routeId]
  const score = useGameStore((state) => state.score)
  const survivors = useGameStore((state) => state.survivors)
  const paused = useGameStore((state) => state.paused)
  const togglePause = useGameStore((state) => state.togglePause)
  const requestAttack = useGameStore((state) => state.requestAttack)
  const setSettingsOpen = useGameStore((state) => state.setSettingsOpen)
  const bindings = useGameStore((state) => state.settings.bindings)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === bindings.pause) togglePause()
      if (event.code === bindings.attack && !event.repeat) {
        setAttackMode(true)
        requestAttack()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bindings.attack, bindings.pause, requestAttack, togglePause])

  return (
    <section className="screen flyover-screen">
      <FlightAudio />
      <Canvas
        shadows
        dpr={[1, 1.65]}
        camera={{ position: [0, 7, 16], fov: 58, near: 0.1, far: 360 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <GameWorld
            onProgress={setProgress}
            onAltitude={setAltitude}
            onAttackMode={setAttackMode}
            onStations={(destroyed, total) => setStations({ destroyed, total })}
          />
        </Suspense>
      </Canvas>
      <div className="flight-vignette" />
      <header className="flight-header">
        <div className="hud-brand"><i />REMOTE FLIGHT / {route.callSign}</div>
        <div className="hud-score"><span>SCORE</span><strong>{score.toLocaleString().padStart(7, '0')}</strong></div>
        <button onClick={togglePause}>II</button>
      </header>
      <div className="altimeter">
        <span>ALT</span><strong>{altitude}m</strong>
        <i />
      </div>
      <div className={`attack-status ${attackMode ? 'active' : ''}`}>
        <span>{attackMode ? 'ATTACK LINK' : 'AIR DEFENSE'}</span>
        <strong>
          {attackMode
            ? 'ONE DRONE MANUAL / FORMATION AUTOPILOT'
            : `${stations.destroyed}/${stations.total} STATIONS DESTROYED`}
        </strong>
      </div>
      <div className="formation-status">
        <p>FORMATION</p>
        <div className="drone-pips">
          {[0, 1, 2, 3].map((drone) => (
            <i key={drone} className={drone < survivors ? 'alive' : 'lost'} />
          ))}
        </div>
        <strong>{survivors}/4 SIGNALS</strong>
      </div>
      <div className="mission-progress">
        <span>ENTRY</span>
        <div><i style={{ width: `${progress * 100}%` }} /></div>
        <span>EXTRACT</span>
      </div>
      <div className="control-strip">
        <span>WASD / LEFT STICK</span>{' '}
        {attackMode ? 'ATTACK DRONE CONTROL' : 'FORMATION CONTROL'} ·{' '}
        <span>SPACE / GAMEPAD A</span> ATTACK RUN
      </div>
      {paused && (
        <div className="pause-overlay">
          <div>
            <p className="eyebrow">UPLINK SUSPENDED</p>
            <h2>Paused</h2>
            <button className="primary-button" onClick={togglePause}>RESUME</button>
            <button className="text-button" onClick={() => setSettingsOpen(true)}>SETTINGS</button>
          </div>
        </div>
      )}
    </section>
  )
}
