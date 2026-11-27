import { useEffect, useRef, useState } from 'react'
import type { PetCursorSample, PetOverlayBootstrap, PetOverlayBridge } from '@shared/pets'
import { emptyPetPresence, PET_PRESENCE_TTL_MS, type PetPresenceSnapshot } from '@shared/pets-interactions'
import { emptyPetTyping, type PetTypingState } from '@shared/pets-typing'
import { currentPetReaction } from './pet-reactions'

export const DESK_TYPING_HOLD_MS = 30_000
export const DESK_MOUSE_HOLD_MS = 12_000
const INTERACT_COOLDOWN_MS = 550

type TypingLatch = {
  petId: string | null
  typing: PetTypingState
  until: number
}

type MouseLatch = {
  petId: string | null
  until: number
}

export function usePetPresence(
  bridge: Pick<PetOverlayBridge, 'onPresenceChanged' | 'onCursorChanged'>,
  bootstrap: PetOverlayBootstrap | null,
  suppressMouseDesk = false,
  patting = false
) {
  const [presence, setPresence] = useState<PetPresenceSnapshot>(emptyPetPresence)
  const [cursor, setCursor] = useState<PetCursorSample | null>(null)
  const [now, setNow] = useState(Date.now)
  const ignoreDeskUntil = useRef(0)
  const typingLatch = useRef<TypingLatch | null>(null)
  const mouseLatch = useRef<MouseLatch | null>(null)

  if (suppressMouseDesk) {
    ignoreDeskUntil.current = Math.max(ignoreDeskUntil.current, Date.now() + INTERACT_COOLDOWN_MS)
  }

  useEffect(() => bridge.onPresenceChanged?.((next) => {
    setPresence((current) => next.revision >= current.revision ? next : current)
    setNow(Date.now())
  }), [bridge])

  useEffect(() => bridge.onCursorChanged?.((sample) => {
    setCursor(sample)
    setNow(Date.now())
  }), [bridge])

  useEffect(() => {
    const next = bootstrap?.presence
    if (next) {
      setPresence((current) => next.revision >= current.revision ? next : current)
      setNow(Date.now())
    }
  }, [bootstrap?.presence])

  const petId = bootstrap?.petId ?? null
  const enabled = bootstrap?.reactionsEnabled !== false
  const hasJoint = Boolean(bootstrap?.interactions?.joint)
  const rawDirect = enabled ? currentPetReaction(presence, now) : null
  const heldMask = presence.input?.typing?.held ?? 0

  if (!enabled || !hasJoint || (rawDirect && rawDirect.kind !== 'typing') || (patting && heldMask === 0) ||
    (typingLatch.current && typingLatch.current.petId !== petId)) {
    typingLatch.current = null
  } else if (rawDirect?.kind === 'typing' && presence.input) {
    const until = presence.input.expiresAt + Math.max(0, DESK_TYPING_HOLD_MS - PET_PRESENCE_TTL_MS)
    typingLatch.current = { petId, typing: presence.input.typing ?? emptyPetTyping(), until }
  } else if (typingLatch.current && typingLatch.current.until <= now) {
    typingLatch.current = null
  }

  const latchedTyping = typingLatch.current && typingLatch.current.until > now ? typingLatch.current : null
  const validDeskAt = cursor && cursor.deskActiveAt > ignoreDeskUntil.current ? cursor.deskActiveAt : 0
  const validButtons = Boolean(cursor && cursor.buttons !== 0 && !suppressMouseDesk && now > ignoreDeskUntil.current)
  const candidateMouseUntil = !suppressMouseDesk && cursor
    ? (validButtons ? now + DESK_MOUSE_HOLD_MS : validDeskAt > 0 ? validDeskAt + DESK_MOUSE_HOLD_MS : 0)
    : 0

  if (!enabled || !hasJoint || patting || (rawDirect && rawDirect.kind !== 'typing') ||
    (mouseLatch.current && mouseLatch.current.petId !== petId)) {
    mouseLatch.current = null
  } else if (candidateMouseUntil > now) {
    const prevUntil = mouseLatch.current?.petId === petId ? mouseLatch.current.until : 0
    mouseLatch.current = { petId, until: Math.max(prevUntil, candidateMouseUntil) }
  } else if (mouseLatch.current && mouseLatch.current.until <= now) {
    mouseLatch.current = null
  }

  const mouseDeskUntil = mouseLatch.current && mouseLatch.current.until > now ? mouseLatch.current.until : 0

  const yieldPostTyping = patting && rawDirect?.kind === 'typing' && heldMask === 0
  const directInput = yieldPostTyping ? null : rawDirect
  const mouseDeskActive = enabled && hasJoint && mouseDeskUntil > now && !patting
  const deskLatchActive = Boolean(enabled && hasJoint && latchedTyping && !patting)
  const input = directInput ?? (deskLatchActive ? { kind: 'typing' as const, level: 0.5 }
    : mouseDeskActive ? { kind: 'typing' as const, level: 0.4 } : null)
  const deskExpiresAt = Math.max(
    directInput?.kind === 'typing' ? (presence.input?.expiresAt ?? 0) : 0,
    deskLatchActive && latchedTyping ? latchedTyping.until : 0,
    mouseDeskActive ? mouseDeskUntil : 0
  )
  const typing: PetTypingState | undefined = directInput?.kind === 'typing'
    ? presence.input?.typing
    : deskLatchActive && latchedTyping
      ? { ...latchedTyping.typing, held: 0 }
      : undefined

  useEffect(() => {
    const currentNow = Date.now()
    const expiries = [
      presence.input?.expiresAt ?? 0,
      latchedTyping?.until ?? 0,
      mouseDeskUntil
    ].filter((time) => time > currentNow)
    if (!expiries.length) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(...expiries) - currentNow + 1))
    return () => clearTimeout(timer)
  }, [presence, latchedTyping?.until, mouseDeskUntil, now])

  return {
    presence,
    typing,
    cursor: enabled ? cursor : null,
    input,
    typingActive: directInput?.kind === 'typing' || deskLatchActive,
    deskExpiresAt,
    active: Boolean(input)
  }
}
