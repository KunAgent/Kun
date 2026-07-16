import { describe, it, expect } from 'vitest'
import { ExtensionRegistry } from './registry.js'
import type { KunExtension, LoopHookContext } from './types.js'

describe('ExtensionRegistry', () => {
  it('collects extension model catalog contributions', () => {
    const registry = new ExtensionRegistry()
    registry.register({
      id: 'models',
      contributeModels: () => [{
        providerId: 'moa',
        modelId: 'moa:balanced',
        label: 'Balanced',
        capabilities: { input: ['text'], contextWindowTokens: 32_000 },
        source: 'extension'
      }]
    })

    expect(registry.getModelCatalogEntries()).toEqual([
      expect.objectContaining({ modelId: 'moa:balanced', providerId: 'moa' })
    ])
  })

  it('registers extensions and exposes route registrars', () => {
    const registry = new ExtensionRegistry()
    const mockExt: KunExtension = {
      id: 'test-ext',
      registerRoutes: () => {}
    }
    registry.register(mockExt)
    const registrars = registry.getRouteRegistrars()
    expect(registrars).toHaveLength(1)
    expect(registrars[0]).toBe(mockExt.registerRoutes)
  })

  it('collects loop hooks and emits through hook bus', async () => {
    const registry = new ExtensionRegistry()
    const calls: string[] = []
    const mockExt: KunExtension = {
      id: 'hook-ext',
      registerLoopHooks: (bus) => {
        bus.on('beforeLoop', async () => { calls.push('before') })
      }
    }
    registry.register(mockExt)
    // Hooks are registered via registerAllLoopHooks(), not during register()
    registry.registerAllLoopHooks()
    const bus = registry.getLoopHookBus()
    await bus.emit('beforeLoop', { threadId: 't1', turnId: 't1' })
    expect(calls).toEqual(['before'])
  })

  it('calls initializeServices for all extensions with that capability', async () => {
    const registry = new ExtensionRegistry()
    const mockExt: KunExtension = {
      id: 'service-ext',
      initializeServices: async () => ({ myService: 'initialized' })
    }
    registry.register(mockExt)
    const config = {} as any
    const runtime = {} as any
    const result = await registry.initServices(config, runtime)
    expect(result['service-ext']).toEqual({ myService: 'initialized' })
  })
})
