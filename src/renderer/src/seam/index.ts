import type { ReactElement } from 'react'
import { createElement } from 'react'
import { ENABLED_RENDERER_FEATURES } from './features/index.js'

// EXT-SEAM: Extension panel and route registry
export function renderExtensionPanels(): ReactElement[] {
  return ENABLED_RENDERER_FEATURES.flatMap((feature) =>
    feature.panels.map((panel) =>
      createElement(panel.component, { key: `${feature.id}-${panel.id}` })
    )
  )
}

// EXT-SEAM: Extension routes
export function extensionRoutes(): Array<{ path: string; element: ReactElement }> {
  return ENABLED_RENDERER_FEATURES.flatMap((feature) =>
    feature.routes.map((route) => ({
      path: route.path,
      element: createElement(route.element)
    }))
  )
}
