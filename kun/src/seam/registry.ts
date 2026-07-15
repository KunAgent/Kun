import type {
  KunExtension,
  LoopHookName,
  LoopHookFn,
  LoopHookBus,
  LoopHookContext,
  RouteRegistrar,
  ExtensionRuntimeServices
} from './types.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

export class ExtensionRegistry {
  private extensions: KunExtension[] = []
  private hookHandlers: Map<LoopHookName, LoopHookFn[]> = new Map()

  register(extension: KunExtension): void {
    this.extensions.push(extension)
    if (extension.registerLoopHooks) {
      extension.registerLoopHooks(this.getLoopHookBus())
    }
  }

  getRouteRegistrars(): RouteRegistrar[] {
    return this.extensions
      .map(ext => ext.registerRoutes)
      .filter((r): r is RouteRegistrar => r !== undefined)
  }

  async initServices(config: Record<string, unknown>, runtime: ServerRuntime): Promise<ExtensionRuntimeServices> {
    const services: ExtensionRuntimeServices = {}
    for (const ext of this.extensions) {
      if (ext.initializeServices) {
        const featureConfig = config[ext.id]
        services[ext.id] = await ext.initializeServices(featureConfig, runtime)
      }
    }
    return services
  }

  getLoopHookBus(): LoopHookBus {
    return {
      on: (name: LoopHookName, fn: LoopHookFn) => {
        if (!this.hookHandlers.has(name)) {
          this.hookHandlers.set(name, [])
        }
        this.hookHandlers.get(name)!.push(fn)
      },
      emit: async (name: LoopHookName, ctx: LoopHookContext) => {
        const handlers = this.hookHandlers.get(name) || []
        for (const handler of handlers) {
          await handler(ctx)
        }
      }
    }
  }
}
