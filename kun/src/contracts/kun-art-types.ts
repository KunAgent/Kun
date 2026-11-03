import type { KunAvatarAccessoryMetadata, KunAvatarParts } from './kun-avatar-catalog.js'
export type ArtLabel = { zh: string; en: string }
export type ArtEntry = { id: string; label: ArtLabel }
export type ArtAccessory = ArtEntry & KunAvatarAccessoryMetadata
export type ArtPartsCatalog = {
  color: (ArtEntry & { hex: string })[]
  face: ArtEntry[]
  headwear: ArtAccessory[]
  glasses: ArtAccessory[]
  outfit: ArtAccessory[]
  prop: ArtAccessory[]
}
export type ArtPreset = ArtEntry & { parts: KunAvatarParts; cardScene: string }
export type ArtCatalog = {
  parts: ArtPartsCatalog
  scenes: ArtEntry[]
  presets: ArtPreset[]
  smallHeadwear: string[]
  sleevedOutfits: string[]
}
export type ArtFile = { sha256: string; size: number; width: number; height: number }
export type ArtManifest = {
  schemaVersion: 1
  rendererVersion: 1
  releaseId: string
  minAppVersion: string
  catalogVersion: string
  catalog: ArtCatalog
  canvas: number
  anchors: { faceBox: number[]; compactFaceBox?: number[] }
  assets: Record<string, { webp: Record<string, string> }>
  files: Record<string, ArtFile>
}
