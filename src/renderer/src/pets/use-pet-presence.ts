import { useEffect, useState } from 'react'
import type { PetOverlayBootstrap, PetOverlayBridge } from '@shared/pets'
import { emptyPetPresence, type PetPresenceSnapshot } from '@shared/pets-interactions'
import { currentPetReaction } from './pet-reactions'

export function usePetPresence(bridge: Pick<PetOverlayBridge, 'onPresenceChanged'>, bootstrap: PetOverlayBootstrap | null) {
  const [presence, setPresence] = useState<PetPresenceSnapshot>(emptyPetPresence)
  const [now, setNow] = useState(Date.now)
  useEffect(() => bridge.onPresenceChanged?.((next) => {
    setPresence((current) => next.revision >= current.revision ? next : current)
    setNow(Date.now())
  }), [bridge])
  useEffect(() => {
    const next = bootstrap?.presence
    if (next) {
      setPresence((current) => next.revision >= current.revision ? next : current)
      setNow(Date.now())
    }
  }, [bootstrap?.presence])
  useEffect(() => {
    const expiry = [presence.input?.expiresAt ?? 0].filter((time) => time > Date.now())
    if (!expiry.length) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(...expiry) - Date.now() + 1))
    return () => clearTimeout(timer)
  }, [presence, now])
  const enabled = bootstrap?.reactionsEnabled !== false
  const input = enabled ? currentPetReaction(presence, now) : null
  return { presence, input, active: Boolean(input) }
}
