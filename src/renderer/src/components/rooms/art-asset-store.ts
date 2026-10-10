import { useSyncExternalStore } from 'react'
import type { ArtManifest, ArtState } from '@shared/kun-art'
import { installArtCatalog } from '../../../../../kun/src/contracts/kun-art-catalog'
let state: ArtState = { phase: 'bundled', manifest: null, completed: 0, total: 0 }
const listeners = new Set<() => void>()
let started = false
export function activeArtManifest(): ArtManifest | null { return state.manifest }
export function artRevision(): string { return state.manifest?.releaseId ?? 'bundled' }
export function subscribeArt(callback: () => void): () => void { listeners.add(callback); return () => listeners.delete(callback) }
export function receiveArtState(next: ArtState): void {
  if (next.manifest?.releaseId !== state.manifest?.releaseId) installArtCatalog(next.manifest?.catalog ?? null)
  state = next
  for (const callback of listeners) callback()
}
export function startArtUpdates(): void {
  const api = window.kunGui?.kunArt
  if (started || !api) return
  started = true
  let received = false
  api.onState(next => { received = true; receiveArtState(next) })
  void api.getState().then(next => { if (!received) receiveArtState(next) }).catch(() => undefined)
}
export function useArtRevision(): string { return useSyncExternalStore(subscribeArt, artRevision, () => 'bundled') }
export function useArtState(): ArtState { return useSyncExternalStore(subscribeArt, () => state, () => state) }
