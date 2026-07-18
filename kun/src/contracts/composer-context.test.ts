import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { createThreadRecord } from '../domain/thread.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { StartTurnRequest } from './turns.js'

const composerContextFixture = {
  schemaVersion: 1 as const,
  id: 'video-selection',
  title: 'Interview selection',
  summary: 'Revision 4 with two selected clips',
  reference: {
    projectId: 'project-1',
    sequenceId: 'sequence-main',
    selectedItemIds: ['clip-1', 'clip-2']
  },
  revision: 4,
  generation: 7,
  attachmentId: `extension-context:${'a'.repeat(64)}`,
  provenance: {
    extensionId: 'acme.video-editor',
    extensionVersion: '1.1.0',
    viewContributionId: 'extension:acme.video-editor/editor',
    workspaceId: 'b'.repeat(64)
  }
}

describe('composer context turn contract', () => {
  it('rejects duplicate, excessive, and path-bearing context attachments', () => {
    expect(StartTurnRequest.safeParse({
      prompt: 'Use the selection',
      composerContexts: [composerContextFixture, composerContextFixture]
    }).success).toBe(false)
    expect(StartTurnRequest.safeParse({
      prompt: 'Use the selection',
      composerContexts: Array.from({ length: 9 }, (_, index) => ({
        ...composerContextFixture,
        id: `selection-${index}`,
        attachmentId: `extension-context:${String(index).padStart(64, '0')}`
      }))
    }).success).toBe(false)
    expect(StartTurnRequest.safeParse({
      prompt: 'Use the selection',
      composerContexts: [{
        ...composerContextFixture,
        reference: { filePath: '/private/interview.mp4' }
      }]
    }).success).toBe(false)
  })

  it('persists the exact bounded metadata on both turn and user item', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-14T00:00:00.000Z'
    const service = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_composer_context'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Composer context',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))

    const started = await service.startTurn({
      threadId,
      request: { prompt: 'Use the selected clips', composerContexts: [composerContextFixture] }
    })
    const turn = (await threadStore.get(threadId))?.turns[0]
    const userItem = (await sessionStore.loadItems(threadId)).find(
      (item) => item.id === started.userMessageItemId && item.kind === 'user_message'
    )
    expect(turn?.composerContexts).toEqual([composerContextFixture])
    expect(userItem?.kind === 'user_message' ? userItem.composerContexts : undefined)
      .toEqual([composerContextFixture])
    await service.interruptActiveTurns()
  })
})
