import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.resetModules())

describe('native admission module entry order', () => {
  it.each([
    { name: 'queue receiver', load: () => import('./queue-admission.js') },
    { name: 'native receipt receiver', load: () => import('./native-followup-admission.js') },
    { name: 'public turn service', load: () => import('./turn-service.js') }
  ])('installs every operation when $name loads first', async ({ load }) => {
    vi.resetModules()
    await load()
    const { TurnService, TurnConflictError } = await import('./turn-service.js')
    const leaf = await import('./turn-conflict-error.js')
    expect(TurnConflictError).toBe(leaf.TurnConflictError)
    for (const key of ['enqueueTurn', 'startTurn', 'startNextQueuedTurn', 'lookupNativeFollowUpRequest'] as const) {
      expect(typeof TurnService.prototype[key]).toBe('function')
    }
  })
})
