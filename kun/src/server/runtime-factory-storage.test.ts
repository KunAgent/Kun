import { describe, expect, it } from 'vitest'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { UsageService } from '../services/usage-service-core.js'
import { seedUsageCarryover } from './runtime-factory-storage.js'

describe('seedUsageCarryover', () => {
  it('seeds the latest durable cumulative usage snapshot', async () => {
    const usageService = new UsageService()
    const sessionStore = { loadLatestUsageSnapshots: async () => [{
      threadId: 'thread-seeded',
      seq: 4,
      usage: {
        promptTokens: 10, completionTokens: 3, totalTokens: 13, cacheHitRate: null, turns: 2
      }
    }] } as unknown as SessionStore
    await seedUsageCarryover({
      threadStore: { list: async () => [] } as unknown as ThreadStore,
      sessionStore,
      usageService
    })

    expect(usageService.forThread('thread-seeded')).toMatchObject({
      promptTokens: 10, completionTokens: 3, totalTokens: 13, turns: 2
    })
    expect(usageService.snapshots()).toHaveLength(0)
  })

  it('bounds event replay fallback concurrency when usage snapshots are unavailable', async () => {
    let active = 0
    let peak = 0
    const sessionStore = {
      loadLatestUsageSnapshots: async () => { throw new Error('index unavailable') },
      iterateEventsSince: async function* () {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        yield* []
      }
    } as unknown as SessionStore
    const threadStore = {
      list: async () => Array.from({ length: 20 }, (_, index) => ({ id: `thread-${index}` }))
    } as unknown as ThreadStore

    await seedUsageCarryover({
      threadStore,
      sessionStore,
      usageService: new UsageService()
    })

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
  })
})
