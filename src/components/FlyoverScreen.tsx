import { Canvas } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useState } from 'react'
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
  const [fleetSlots, setFleetSlots] = useState<
    Array<'ready' | 'refilling' | 'lost'>
  >(['ready', 'ready', 'ready', 'ready'])
  const [queuedAttacks, setQueuedAttacks] = useState(0)
  const routeId = useGameStore((state) => state.route)!
  const route = ROUTES[routeId]
  const runSeed = useGameStore((state) => state.runSeed)
  const score = useGameStore((state) => state.score)
  const survivors = useGameStore((state) => state.survivors)
  const launchesRemaining = useGameStore((state) => state.launchesRemaining)
  const paused = useGameStore((state) => state.paused)
  const togglePause = useGameStore((state) => state.togglePause)
  const setSettingsOpen = useGameStore((state) => state.setSettingsOpen)
  const restartRun = useGameStore((state) => state.restartRun)
  const returnToMain = useGameStore((state) => state.returnToMain)
  const bindings = useGameStore((state) => state.settings.bindings)
  const updateFleetSlots = useCallback(
    (
      slots: Array<'ready' | 'refilling' | 'lost'>,
      queued: number,
    ) => {
      setFleetSlots(slots)
      setQueuedAttacks(queued)
    },
    [],
  )
  const updateStations = useCallback(
    (destroyed: number, total: number) => {
      setStations({ destroyed, total })
    },
    [],
  )

  useEffect(() => {
    setProgress(0)
    setAltitude(200)
    setAttackMode(false)
    setStations({ destroyed: 0, total: 4 })
    setFleetSlots(['ready', 'ready', 'ready', 'ready'])
    setQueuedAttacks(0)
  }, [runSeed])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === bindings.pause) togglePause()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bindings.pause, togglePause])

  return (
    <section className={`screen flyover-screen ${attackMode ? 'attack-active' : ''}`}>
      <FlightAudio />
      <Canvas
        key={runSeed}
        shadows
        dpr={[1, 1.65]}
        camera={{ position: [0, 7, 16], fov: 58, near: 0.1, far: 520 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <GameWorld
            onProgress={setProgress}
            onAltitude={setAltitude}
            onAttackMode={setAttackMode}
            onStations={updateStations}
            onFleetSlots={updateFleetSlots}
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
            ? 'DRONE INTERCEPT IN PROGRESS'
            : `${stations.destroyed}/${stations.total} DEFENSES DESTROYED · CLICK A TARGET`}
        </strong>
      </div>
      <div className="formation-status">
        <p>FIRE POINT FP-1 FLEET</p>
        <div className="drone-pips">
          {fleetSlots.map((slot, index) => (
            <i key={index} className={slot} title={slot} />
          ))}
        </div>
        <strong>{survivors}/4 FP-1 DRONES</strong>
        <small>{launchesRemaining} FP-1 LAUNCHES AVAILABLE</small>
        {queuedAttacks > 0 && <small>{queuedAttacks} ATTACKS QUEUED</small>}
      </div>
      <div className="mission-progress">
        <span>ENTRY</span>
        <div><i style={{ width: `${progress * 100}%` }} /></div>
        <span>EXTRACT</span>
      </div>
      <div className="control-strip">
        <span>WASD / LEFT STICK</span> FORMATION CONTROL ·{' '}
        <span>MOUSE CLICK</span> ATTACK STATION OR OIL TANK
      </div>
      {paused && (
        <div className="pause-overlay">
          <div>
            <p className="eyebrow">UPLINK SUSPENDED</p>
            <h2>Paused</h2>
            <button className="primary-button" onClick={togglePause}>RESUME</button>
            <button className="text-button" onClick={() => setSettingsOpen(true)}>SETTINGS</button>
            <button className="text-button" onClick={restartRun}>RESTART GAME</button>
            <button className="text-button" onClick={returnToMain}>MAIN SCREEN</button>
          </div>
        </div>
      )}
    </section>
  )
}
