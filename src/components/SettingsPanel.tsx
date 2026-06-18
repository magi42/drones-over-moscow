import { useState } from 'react'
import { readableKey, type InputAction } from '../game/input'
import { useGameStore } from '../store/gameStore'

const actions: InputAction[] = ['left', 'right', 'up', 'down', 'attack', 'pause']

export function SettingsPanel() {
  const open = useGameStore((state) => state.settingsOpen)
  const settings = useGameStore((state) => state.settings)
  const setOpen = useGameStore((state) => state.setSettingsOpen)
  const updateSettings = useGameStore((state) => state.updateSettings)
  const updateBinding = useGameStore((state) => state.updateBinding)
  const [listening, setListening] = useState<InputAction | null>(null)

  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <section className="settings-panel">
        <header><div><p className="eyebrow">SYSTEM</p><h2>Settings</h2></div><button onClick={() => setOpen(false)}>×</button></header>
        <label>
          <span>Master volume <b>{Math.round(settings.masterVolume * 100)}%</b></span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.masterVolume}
            onChange={(event) => updateSettings({ masterVolume: Number(event.target.value) })}
          />
        </label>
        <label className="toggle-row">
          <span>Reduced effects<small>Fewer particles and dynamic debris</small></span>
          <input
            type="checkbox"
            checked={settings.reducedEffects}
            onChange={(event) => updateSettings({ reducedEffects: event.target.checked })}
          />
        </label>
        <div className="bindings">
          <span>INPUT BINDINGS</span>
          {actions.map((action) => (
            <button
              key={action}
              onClick={() => setListening(action)}
              onKeyDown={(event) => {
                if (!listening) return
                event.preventDefault()
                updateBinding(listening, event.code)
                setListening(null)
              }}
              autoFocus={listening === action}
            >
              <span>{action}</span>
              <b>{listening === action ? 'PRESS KEY' : readableKey(settings.bindings[action])}</b>
            </button>
          ))}
        </div>
        <button className="primary-button" onClick={() => setOpen(false)}>APPLY</button>
      </section>
    </div>
  )
}
