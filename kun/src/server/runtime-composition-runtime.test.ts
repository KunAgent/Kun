import { describe, expect, it, vi } from 'vitest'
import type { MemoryFeedbackRuntime } from '../memory/memory-feedback-runtime.js'
import { createServerRuntimeComposition } from './runtime-composition-runtime.js'

describe('server runtime composition', () => {
  it('exposes the composed memory feedback runtime to HTTP routes', () => {
    const memoryFeedback = {} as MemoryFeedbackRuntime
    const addObserver = vi.fn()
    const registerHandler = vi.fn()
    const services = looseObject({ memoryFeedback, agentDispatchService: { registerHandler },
      model: looseObject({ core: looseObject({ events: { addObserver } }) }) })
    const extensions = looseObject({
      agent: looseObject({ registryComposition: looseObject({ services }) })
    })
    const config = looseObject({
      activeOptions: looseObject({ dataDir: '/tmp/kun-runtime-composition-test' }),
      startedAt: '2026-09-16T00:00:00.000Z',
      rebuildCapabilities: () => ({}),
      applyConfig: async () => ({ ok: true })
    })

    const runtime = createServerRuntimeComposition(extensions as never, config as never)

    expect(runtime.memoryFeedback).toBe(memoryFeedback)
    expect(addObserver).toHaveBeenCalledTimes(2)
    expect(addObserver.mock.calls[0][0].constructor.name).toBe('RoomNotificationObserver')
  })
})

function looseObject(overrides: Record<string, unknown> = {}): object {
  let proxy: object
  proxy = new Proxy(overrides, {
    get(target, property) {
      if (typeof property === 'symbol') return undefined
      return property in target ? target[property] : proxy
    }
  })
  return proxy
}
