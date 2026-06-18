import { useEffect, useRef } from 'react'
import musicUrl from '../assets/audio/music/moscow-midnight-circuit.mp3'
import { useGameStore } from '../store/gameStore'

export function GameMusic() {
  const phase = useGameStore((state) => state.phase)
  const paused = useGameStore((state) => state.paused)
  const volume = useGameStore((state) => state.settings.masterVolume)
  const music = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const track = new Audio(musicUrl)
    track.loop = true
    track.preload = 'auto'
    music.current = track

    const tryPlay = () => {
      if (useGameStore.getState().phase !== 'boot') {
        void track.play().catch(() => undefined)
      }
    }
    window.addEventListener('pointerdown', tryPlay)
    window.addEventListener('keydown', tryPlay)

    return () => {
      window.removeEventListener('pointerdown', tryPlay)
      window.removeEventListener('keydown', tryPlay)
      track.pause()
      track.src = ''
      music.current = null
    }
  }, [])

  useEffect(() => {
    if (!music.current) return
    music.current.volume = volume * 0.72
    if (phase === 'boot' || paused) {
      music.current.pause()
    } else {
      void music.current.play().catch(() => undefined)
    }
  }, [paused, phase, volume])

  return null
}
