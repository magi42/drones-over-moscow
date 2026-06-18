import { lazy, Suspense, useEffect, useState } from 'react'
import { BootScreen } from './components/BootScreen'
import { OperatorScreen } from './components/OperatorScreen'
import { CountrySelect } from './components/CountrySelect'
import { BriefingScreen } from './components/BriefingScreen'
import { ResultsScreen } from './components/ResultsScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { GameMusic } from './components/GameMusic'
import { useGameStore } from './store/gameStore'

const FlyoverScreen = lazy(() =>
  import('./components/FlyoverScreen').then((module) => ({
    default: module.FlyoverScreen,
  })),
)

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      window.WebGL2RenderingContext && canvas.getContext('webgl2'),
    )
  } catch {
    return false
  }
}

export function App() {
  const phase = useGameStore((state) => state.phase)
  const [webGLAvailable, setWebGLAvailable] = useState(true)

  useEffect(() => setWebGLAvailable(supportsWebGL()), [])

  useEffect(() => {
    if (import.meta.env.DEV) window.__DOM_GAME__ = useGameStore
    return () => {
      delete window.__DOM_GAME__
    }
  }, [])

  if (!webGLAvailable) {
    return (
      <main className="fatal-screen">
        <p className="eyebrow">SYSTEM FAULT</p>
        <h1>WebGL 2 is required</h1>
        <p>
          Enable hardware acceleration or open the game in a current desktop
          browser.
        </p>
      </main>
    )
  }

  return (
    <main className={`app phase-${phase}`}>
      <GameMusic />
      {phase === 'boot' && <BootScreen />}
      {phase === 'operator' && <OperatorScreen />}
      {phase === 'countrySelect' && <CountrySelect />}
      {phase === 'briefing' && <BriefingScreen />}
      {phase === 'flyover' && (
        <Suspense fallback={<div className="scene-loader">LOADING AIRSPACE</div>}>
          <FlyoverScreen />
        </Suspense>
      )}
      {phase === 'results' && <ResultsScreen />}
      <SettingsPanel />
    </main>
  )
}
