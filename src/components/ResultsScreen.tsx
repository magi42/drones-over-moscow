import { ROUTES } from '../game/config'
import { useGameStore } from '../store/gameStore'

export function ResultsScreen() {
  const { runWon, score, bestScore, survivors, route, restart } = useGameStore()
  const routeName = route ? ROUTES[route].name : 'Unknown'

  return (
    <section className="screen results-screen">
      <div className="result-glow" />
      <div className="results-card">
        <p className="eyebrow">{runWon ? 'SIGNAL RECOVERED' : 'SIGNAL LOST'}</p>
        <h1>{runWon ? 'Formation extracted' : 'Mission interrupted'}</h1>
        <p className="result-route">{routeName} corridor / Moscow flyover</p>
        <div className="score-display">
          <small>FINAL SCORE</small>
          <strong>{score.toLocaleString()}</strong>
        </div>
        <div className="result-stats">
          <div><strong>{survivors}/4</strong><span>Drones recovered</span></div>
          <div><strong>{bestScore.toLocaleString()}</strong><span>Personal best</span></div>
        </div>
        <button className="primary-button" onClick={restart}>RETURN TO CONSOLE</button>
      </div>
    </section>
  )
}
