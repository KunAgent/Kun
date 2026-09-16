import { describe, expect, it } from 'vitest'
import type { MemoryFeedbackRuntime } from '../memory/memory-feedback-runtime.js'
import { createServerRuntimeComposition } from './runtime-composition-runtime.js'

describe('server runtime composition', () => {
  it('exposes the composed memory feedback runtime to HTTP routes', () => {
    const memoryFeedback = {} as MemoryFeedbackRuntime
    const services = looseObject({ memoryFeedback })
    const extensions = looseObject({
      agent: looseObject({ registryComposition: looseObject({ services }) })
    })
    const config = looseObject({
      activeOptions: looseObject({}),
      startedAt: '2026-09-16T00:00:00.000Z',
      rebuildCapabilities: () => ({}),
      applyConfig: async () => ({ ok: true })
    })

    const runtime = createServerRuntimeComposition(extensions as never, config as never)

    expect(runtime.memoryFeedback).toBe(memoryFeedback)
  })
})

function looseObject(overrides: Record<string, unknown> = {}): object {
  let proxy: object
  proxy = new Proxy(overrides, {
    get(target, property) {
      return property in target ? target[property] : proxy
    }
  })
  return proxy
}
