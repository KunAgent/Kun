import { useEffect } from 'react'
import { createPetPresenceSource } from './pet-presence-client'

export function usePetVoicePresence(status: string, getLevel: () => number): void {
  useEffect(() => {
    if (status !== 'recording' && status !== 'transcribing') return
    const source = createPetPresenceSource('voice')
    let lastVoiceAt = -Infinity
    const report = (): void => {
      if (status === 'transcribing') { source.report('transcribing'); return }
      const level = getLevel()
      if (level > .06) lastVoiceAt = Date.now()
      // Hold across short syllable gaps, but return to listening during silence.
      source.report('listening', Date.now() - lastVoiceAt < 280 ? Math.max(.12, level) : level)
    }
    report()
    const timer = setInterval(report, status === 'recording' ? 125 : 500)
    return () => { clearInterval(timer); source.dispose() }
  }, [status, getLevel])
}
