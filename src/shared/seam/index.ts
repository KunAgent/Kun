import type { AppSettings } from '../app-settings.js'

// EXT-SEAM: Extension settings merger
export function mergeExtensionSettings(base: AppSettings): AppSettings {
  // Stage 0: no-op (Stage 1+ will merge experts/design settings)
  return base
}

// EXT-SEAM: Extension endpoints
export const extensionEndpoints = {
  // Stage 0: empty (Stage 1+ will add /v1/experts, /v1/design, etc.)
}
