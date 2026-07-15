import type { ReactElement } from 'react'

// EXT-SEAM: Extension panel and route registry
export function renderExtensionPanels(): ReactElement[] {
  // Stage 0: empty (Stage 1+ will render experts plaza, etc.)
  return []
}

// EXT-SEAM: Extension routes
export function extensionRoutes(): Array<{ path: string; element: ReactElement }> {
  // Stage 0: empty
  return []
}
