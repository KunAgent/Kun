import type { ArtManifest } from '../../kun/src/contracts/kun-art-types'
export type { ArtManifest, ArtFile } from '../../kun/src/contracts/kun-art-types'
export type ArtState = {
  phase: 'signed_out' | 'bundled' | 'checking' | 'downloading' | 'ready' | 'error'
  manifest: ArtManifest | null
  completed: number
  total: number
  error?: string
}
export type KunArtApi = {
  getState(): Promise<ArtState>
  onState(callback: (state: ArtState) => void): () => void
}
export const ART_CHANNELS = { get: 'kun-art:get', state: 'kun-art:state' } as const
