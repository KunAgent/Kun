import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ComposerContextAttachmentJson } from '../contracts/composer-context.js'
import { userMessageTextWithComposerContexts } from '../domain/composer-context.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import type { ReviewContextResolver } from './review-composer-context.js'

const context: ComposerContextAttachmentJson = {
  schemaVersion: 1, id: 'review', title: 'Review', summary: '10 comments',
  reference: { kind: 'review-request', workspaceId: 'tws_complete01', requestId: 'rvq_complete01' },
  attachmentId: `review-request-context:${'a'.repeat(64)}`,
  provenance: { source: 'review-request', workspaceId: 'b'.repeat(64) },
  revision: 1, generation: 0
}
const resolved = [{
  workspaceId: 'tws_complete01', requestId: 'rvq_complete01', title: 'Complete review',
  body: 'comment content '.repeat(3_000) + 'FINAL_COMMENT'
}]
async function harness(resolveReviewRequests?: ReviewContextResolver) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => new Date().toISOString()
  const turns = new TurnService({
    threadStore, sessionStore,
    events: new RuntimeEventRecorder({
      eventBus, sessionStore, nowIso, allocateSeq: (id) => eventBus.allocateSeq(id)
    }),
    inflight: new InflightTracker(), steering: new SteeringQueue(),
    compactor: new ContextCompactor(), ids: new SequentialIdGenerator(), nowIso,
    ...(resolveReviewRequests ? { resolveReviewRequests } : {})
  })
  await threadStore.upsert(createThreadRecord({
    id: 'owner', title: 'Owner', workspace: '/project', model: 'test'
  }))
  return { turns, threadStore, sessionStore }
}

describe('review context admission', () => {
  it('freezes complete review bodies for both immediate and queued turns', async () => {
    const resolver = vi.fn(async () => resolved)
    const { turns, sessionStore } = await harness(resolver)
    await turns.startTurn({ threadId: 'owner', request: {
      prompt: 'Fix review', composerContexts: [context], clientRequestId: 'first'
    } })
    await turns.startTurn({ threadId: 'owner', request: {
      prompt: 'Fix next review', composerContexts: [context], clientRequestId: 'second', enqueueIfBusy: true
    } })
    expect(resolver).toHaveBeenCalledTimes(2)
    const items = (await sessionStore.loadItems('owner')).filter((item) => item.kind === 'user_message')
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.reviewRequests).toEqual(resolved)
      expect(userMessageTextWithComposerContexts(item)).toContain('FINAL_COMMENT')
    }
    // Idempotent replay cannot re-resolve against later, changed data.
    await turns.startTurn({ threadId: 'owner', request: {
      prompt: 'Fix review', composerContexts: [context], clientRequestId: 'first'
    } })
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('rejects unresolved review references before creating a durable turn or item', async () => {
    const { turns, threadStore, sessionStore } = await harness()
    await expect(turns.startTurn({ threadId: 'owner', request: {
      prompt: 'Fix review', composerContexts: [context]
    } })).rejects.toThrow(/lookup is unavailable/)
    expect((await threadStore.get('owner'))?.turns).toHaveLength(0)
    expect(await sessionStore.loadItems('owner')).toHaveLength(0)
  })
})
