import type { Router } from '../router.js'
import type { ServerRuntime } from '../routes/server-runtime.js'

/**
 * Extension routes seam - wires in extension-provided HTTP routes.
 * This is the first upstream integration point for the extension platform.
 *
 * EXT-SEAM: routes
 */
export function registerExtensionRoutes(router: Router, runtime: ServerRuntime): void {
  // Extension routes will be registered here by the extension platform
  // when extensionPlatform is available in the runtime.
  if (!runtime.extensionPlatform) {
    return
  }

  // TODO: Wire extension routes into the router
  // This is a placeholder for the extension routing integration.
}
