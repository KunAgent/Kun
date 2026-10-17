import { useSyncExternalStore } from 'react'
import type { MobileLinkStatus } from '@shared/mobile-link'

export type MobilePairing = MobileLinkStatus['pairings'][number]

const EMPTY: MobilePairing[] = []
let pairings: MobilePairing[] = EMPTY
const listeners = new Set<() => void>()

/** Latest pending iOS pairing requests, shared by the dialog and the rail badge. */
export function publishMobilePairings(next: MobilePairing[]): void {
  const same =
    next.length === pairings.length && next.every((pairing, index) => pairing.id === pairings[index]?.id)
  if (same) return
  pairings = next.length ? next : EMPTY
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMobilePairings(): MobilePairing[] {
  return useSyncExternalStore(subscribe, () => pairings, () => EMPTY)
}
