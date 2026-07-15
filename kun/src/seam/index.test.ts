import { describe, it, expect } from 'vitest'
import { registerExtensionRoutes, initializeExtensionServices, emitLoopHook } from './index.js'

describe('seam dispatch functions', () => {
  it('registerExtensionRoutes is callable with empty registry', () => {
    const router = { add: () => {} } as any
    const runtime = {} as any
    expect(() => registerExtensionRoutes(router, runtime)).not.toThrow()
  })

  it('initializeExtensionServices returns empty object with no features', async () => {
    const config = {}
    const runtime = {} as any
    const services = await initializeExtensionServices(config, runtime)
    expect(services).toEqual({})
  })

  it('emitLoopHook completes with no registered hooks', async () => {
    await expect(emitLoopHook('beforeLoop', { threadId: 't1', turnId: 't1' })).resolves.toBeUndefined()
  })
})
