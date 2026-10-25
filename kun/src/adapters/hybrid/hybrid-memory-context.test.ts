import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import { relationBinding } from '../../memory/memory-relations.js'
import { resolveMemoryTurnContext } from '../../memory/memory-turn-context.js'
import { HybridMemoryStore } from './hybrid-memory-store.js'
import { withMemoryMutation } from '../../memory/memory-mutation-queue.js'

describe('Hybrid relation context parity and preview diagnostics', () => {
  it.each([false, true])('keeps selected records and live diagnostics stable (degraded=%s)', async (degraded) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-context-'))
    let config = MemoryCapabilityConfig.parse({ enabled: true })
    const store = new HybridMemoryStore({
      dataDir: root, config: () => config,
      ...(degraded ? { databaseFactory: () => { throw new Error('Synthetic SQLite unavailability') } } : {})
    })
    try {
      const source = await store.createWithId('mem_a', { content: 'Project database version 17.', scope: 'user' })
      const target = await store.createWithId('mem_b', { content: 'Project database version 16.', scope: 'user' })
      await store.waitForBackfill()
      let release!: () => void
      const hold = withMemoryMutation(join(root, 'memory'), () => new Promise<void>((resolve) => { release = resolve }))
      const controller = new AbortController()
      const cancelled = store.relations({ action: 'propose', access: {}, proposals: [{
        source: relationBinding(source), target: relationBinding(target), kind: 'contradicts',
        sourceEvidence: { start: 0, end: 28 }, targetEvidence: { start: 0, end: 28 }
      }] }, controller.signal)
      await Promise.resolve()
      controller.abort()
      release()
      await hold
      await expect(cancelled).rejects.toThrow()
      expect((await store.relations({ action: 'list', memoryId: source.id, access: {} })).relations).toEqual([])
      const id = (await store.relations({ action: 'propose', access: {}, proposals: [{
        source: relationBinding(source), target: relationBinding(target), kind: 'contradicts',
        sourceEvidence: { start: 0, end: 28 }, targetEvidence: { start: 0, end: 28 }
      }] })).relations[0].suggestion.id
      await store.relations({ action: 'review', id, decision: 'accepted', access: {} })
      const input = { query: 'project database version', workspace: root }
      const off = await resolveMemoryTurnContext(store, input)
      expect(off.relationContext?.annotations).toEqual([])
      const before = await store.diagnostics()
      expect(before.lastRetrieval?.mode).toBe(degraded ? 'filesystem-fallback' : 'sqlite-fts5')
      const preview = await resolveMemoryTurnContext(store, { ...input, preview: true })
      expect(preview.relationContext?.annotations).toHaveLength(1)
      expect(await store.diagnostics()).toEqual(before)
      config = MemoryCapabilityConfig.parse({ enabled: true, relationContextEnabled: true })
      const on = await resolveMemoryTurnContext(store, input)
      expect(on.memories).toEqual(off.memories)
      expect(on.referenceBlocks).toEqual(preview.referenceBlocks)
      await store.relations({ action: 'withdraw', id, access: {} })
      expect((await resolveMemoryTurnContext(store, input)).relationContext?.annotations).toEqual([])
    } finally {
      await store.shutdown()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }, 30_000)
})
