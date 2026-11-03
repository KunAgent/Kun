import { describe, expect, it, vi } from 'vitest'
import type { MemoryFeedbackRuntime } from '../memory/memory-feedback-runtime.js'
import { createServerRuntimeComposition } from './runtime-composition-runtime.js'

// The rooms composition opens real SQLite stores; this suite is about what the runtime composition exposes, not about them.
vi.mock('./runtime-composition-rooms.js', () => ({ createRuntimeRoomComposition: () => looseObject() }))

describe('server runtime composition', () => {
  it('exposes the composed memory feedback runtime to HTTP routes', () => {
    const memoryFeedback = {} as MemoryFeedbackRuntime
    const addObserver = vi.fn()
    // The composition calls these on the Agent source, so they must be callable rather than loose objects.
    const extensionAgents = { setLoader: vi.fn(), refresh: vi.fn(async () => undefined) }
    const services = looseObject({ memoryFeedback, harnesses: looseObject({ extensionAgents }),
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
    expect(extensionAgents.setLoader).toHaveBeenCalledOnce()
    expect(addObserver.mock.calls.map(([observer]) => observer.constructor.name)).toContain('RoomNotificationObserver')
  })
})

/** Every member the composition reaches for that a test did not name is another loose object, callable too. */
function looseObject(overrides: Record<string, unknown> = {}): object {
  const proxy: object = new Proxy(function loose() { return proxy }, {
    get(_target, property) {
      // Symbols and `then` stay undefined so a loose object is never taken for an iterable or a promise.
      if (typeof property === 'symbol' || property === 'then') return undefined
      return property in overrides ? overrides[property] : proxy
    },
    apply: () => proxy
  })
  return proxy
}
