import type { ArtManifest } from '../../kun/src/contracts/kun-art-types'
export type { ArtManifest, ArtFile } from '../../kun/src/contracts/kun-art-types'
export type ArtState = {
  phase: 'bundled' | 'checking' | 'downloading' | 'ready' | 'error'
  manifest: ArtManifest | null
  completed: number
  total: number
  error?: string
  rollbackAvailable: boolean
  held: boolean
}
export type KunArtApi = {
  getState(): Promise<ArtState>
  check(): Promise<ArtState>
  rollback(): Promise<ArtState>
  onState(callback: (state: ArtState) => void): () => void
}
export const ART_CHANNELS = { get: 'kun-art:get', check: 'kun-art:check', rollback: 'kun-art:rollback', state: 'kun-art:state' } as const
