import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LifecycleFencedSessionStore, ThreadLifecycleFence } from '../../services/thread-lifecycle-fence.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { ThreadService } from '../../services/thread-service.js'
import type { ContextSnapshotEvent } from '../../contracts/context-snapshot.js'
import { getThread, getThreadTimeline } from './threads.js'
import { ManagerSharedDataStore } from '../../manager/shared-data-store.js'

const event: ContextSnapshotEvent = { kind: 'context_snapshot', seq: 1, threadId: 'thread',
  timestamp: '2026-10-11T00:00:00Z', model: 'codex', stepIndex: 0, contextWindowTokens: 100_000,
  softThresholdTokens: 95_000, hardThresholdTokens: 99_000, estimatedInputTokens: 19_000,
  breakdown: { tools: 0, system: 0, skills: 0, messages: 19_000, other: 0 }, toolCount: 0,
  activeSkillIds: [], contextManagement: 'sdk-managed', occupancySource: 'agent' }
function setup() {
  const thread = createThreadRecord({ id: 'thread', title: 'test', workspace: '/tmp', model: 'codex' })
  const service = { get: async () => thread } as unknown as ThreadService
  const store = new LifecycleFencedSessionStore(new InMemorySessionStore(), new ThreadLifecycleFence())
  return { service, store }
}
describe('context snapshot hydration', () => {
  it('includes context in current timeline and full detail, with explicit null when absent', async () => {
    const { service, store } = setup()
    const read = () => getThreadTimeline(service, 'thread', new Request('http://kun.local/timeline'), store)
    expect(JSON.parse((await read()).body).contextSnapshot).toBeNull()
    await store.appendEvent('thread', event)
    expect(JSON.parse((await read()).body).contextSnapshot).toEqual(event)
    expect(JSON.parse((await getThread(service, 'thread', store)).body).contextSnapshot).toEqual(event)
  })
  it('does not attach current telemetry to older history pages', async () => {
    const { service, store } = setup()
    await store.appendEvent('thread', event)
    const response = await getThreadTimeline(service, 'thread', new Request('http://kun.local/timeline?before=old'), store)
    expect(JSON.parse(response.body).contextSnapshot).toBeUndefined()
  })
  it('fences a newer event to SSE replay rather than attributing it to an older snapshot', async () => {
    const { service, store } = setup()
    await store.appendEvent('thread', event)
    vi.spyOn(store, 'highestSeq').mockImplementation(async () => {
      await store.appendEvent('thread', { ...event, seq: 2, estimatedInputTokens: 20_000 })
      return 1
    })
    const result = JSON.parse((await getThreadTimeline(service, 'thread', new Request('http://kun.local/timeline'), store)).body)
    expect(result.latestSeq).toBe(1)
    expect(result.contextSnapshot.seq).toBe(1)
  })
  it('keeps history available when an older owner cannot provide context telemetry', async () => {
    const { service, store } = setup()
    vi.spyOn(store, 'loadLatestContextSnapshot').mockRejectedValue(new Error('unsupported session method'))
    const response = await getThreadTimeline(service, 'thread', new Request('http://kun.local/timeline'), store)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).contextSnapshot).toBeUndefined()
  })
  it('crosses the manager owner boundary through the hybrid store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-context-owner-'))
    const owner = await ManagerSharedDataStore.create(root)
    try {
      await owner.executeSession('appendEvent', { threadId: 'thread', event })
      expect(await owner.executeSession('loadLatestContextSnapshot', { threadId: 'thread', maxSeq: 1 })).toEqual(event)
      expect(await owner.executeSession('loadLatestContextSnapshot', { threadId: 'thread', maxSeq: 0 })).toBeNull()
      expect(await owner.executeSession('loadLatestContextSnapshot', { threadId: '../thread', maxSeq: 1 })).toBeNull()
      await expect(owner.executeSession('loadLatestContextSnapshot', { threadId: 'thread', maxSeq: -1 })).rejects.toThrow()
    } finally { await owner.close(); await rm(root, { recursive: true, force: true }) }
  })
})
