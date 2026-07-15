import { ExtensionRegistry } from './registry.js'
import { ENABLED_FEATURES } from './features/index.js'
import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { LoopHookName, LoopHookContext, ExtensionRuntimeServices } from './types.js'

// Singleton registry
const registry = new ExtensionRegistry()

// Register all enabled features at module load time
for (const feature of ENABLED_FEATURES) {
  registry.register(feature)
}

/**
 * Seam #1: Routes
 * Called by buildRouter() in kun/src/server/routes/index.ts
 */
export function registerExtensionRoutes(router: Router, runtime: ServerRuntime): void {
  const registrars = registry.getRouteRegistrars()
  for (const registrar of registrars) {
    registrar(router, runtime)
  }
}

/**
 * Seam #2: Runtime services initialization
 * Called by createKunServeRuntime() in kun/src/server/runtime-factory.ts
 */
export async function initializeExtensionServices(
  config: Record<string, unknown>,
  runtime: ServerRuntime
): Promise<ExtensionRuntimeServices> {
  return await registry.initServices(config, runtime)
}

/**
 * Seam #3: Agent loop hooks
 * Called at hook points in kun/src/loop/agent-loop.ts
 */
export async function emitLoopHook(name: LoopHookName, ctx: LoopHookContext): Promise<void> {
  const bus = registry.getLoopHookBus()
  await bus.emit(name, ctx)
}

/**
 * Seam #5: Model client registration
 * Called by multi-provider-model-client setup
 */
export function registerExtensionModelClients(clientRegistry: unknown): void {
  // Stage 0: no-op (MoA not implemented yet)
  // Stage 3+: registry will expose model clients
}

// Re-export types for convenience
export type { KunExtension, LoopHookName, LoopHookContext } from './types.js'
