import { describe, it, expect } from 'vitest'
import { registerExtensionRoutes, initializeExtensionServices, emitLoopHook } from './index.js'

describe('seam dispatch functions', () => {
  it('registerExtensionRoutes is callable with empty registry', () => {
    const router = { add: () => {} } as any
    const runtime = {} as any
    expect(() => registerExtensionRoutes(router, runtime)).not.toThrow()
  })

  it('initializeExtensionServices returns services from enabled features', async () => {
    const config = {}
    const runtime = {} as any
    const services = await initializeExtensionServices(config, runtime)

    // With experts and MoA extensions enabled, services should have both
    expect(services).toHaveProperty('experts')
    expect(services).toHaveProperty('moa')
  })

  it('emitLoopHook completes with no registered hooks', async () => {
    await expect(emitLoopHook('beforeLoop', { threadId: 't1', turnId: 't1' })).resolves.toBeUndefined()
  })
})
