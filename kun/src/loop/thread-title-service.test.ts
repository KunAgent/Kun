import { describe, expect, it } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { ThreadTitleService } from './thread-title-service.js'

function makeUserItem(threadId: string, turnId: string, text: string): TurnItem {
  return {
    id: `item_${turnId}_user`,
    turnId,
    threadId,
    role: 'user',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'user_message',
    text
  }
}

function makeAssistantItem(threadId: string, turnId: string, text: string): TurnItem {
  return {
    id: `item_${turnId}_assistant`,
    turnId,
    threadId,
    role: 'assistant',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'assistant_text',
    text
  }
}

function makeTitleModel(onRequest?: (request: ModelRequest) => void): ModelClient {
  return {
    provider: 'test',
    model: 'main-model',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      onRequest?.(request)
      yield { kind: 'assistant_text_delta', text: 'LLM title' }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
}

describe('ThreadTitleService', () => {
  it('generates a title from user text while the first turn is still running', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const threadId = 'thr_title_early'
    const turnId = 'turn_1'
    let captured: ModelRequest | undefined
    const recorded: Array<{ kind: string; title?: string }> = []

    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: '帮我做发版前最后review',
      titleAuto: true,
      workspace: '/tmp',
      model: 'main-model'
    }))
    const thread = await threadStore.get(threadId)
    await threadStore.upsert({
      ...thread!,
      status: 'running',
      turns: [{
        id: turnId,
        threadId,
        orchestration: 'direct',
        status: 'running',
        prompt: '帮我做发版前最后review',
        createdAt: new Date().toISOString(),
        model: 'main-model',
        steering: [],
        items: [],
        attachmentIds: [],
        activeSkillIds: [],
        injectedMemoryIds: [],
        injectedMemorySummaries: [],
        injectedDirectiveIds: [],
        injectedDirectiveSummaries: [],
        injectedInstructionSources: []
      }]
    })
    await sessionStore.appendItem(threadId, makeUserItem(threadId, turnId, '帮我做发版前最后review'))
    await sessionStore.appendItem(threadId, makeAssistantItem(threadId, turnId, 'I will start reviewing.'))

    const service = new ThreadTitleService({
      threadStore,
      sessionStore,
      model: makeTitleModel((request) => {
        captured = request
      }),
      events: {
        async record(event) {
          recorded.push({ kind: event.kind, title: 'title' in event ? event.title : undefined })
          return {
            ...event,
            seq: recorded.length,
            timestamp: new Date().toISOString()
          }
        }
      },
      nowIso: () => new Date().toISOString(),
      getRoles: () => undefined
    })

    await service.generateAfterTurn(threadId, turnId)

    const updated = await threadStore.get(threadId)
    expect(updated).toMatchObject({ title: 'LLM title', titleAuto: true })
    expect(recorded).toContainEqual({ kind: 'thread_updated', title: 'LLM title' })
    expect(JSON.stringify(captured?.history)).toContain('帮我做发版前最后review')
    expect(JSON.stringify(captured?.history)).not.toContain('I will start reviewing.')
    expect(JSON.stringify(captured?.history)).not.toContain('Assistant reply')
  })

  it('skips once any turn has already completed', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const threadId = 'thr_title_skip'
    const turnId = 'turn_2'
    let called = 0

    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Provisional',
      titleAuto: true,
      workspace: '/tmp',
      model: 'main-model'
    }))
    const thread = await threadStore.get(threadId)
    await threadStore.upsert({
      ...thread!,
      status: 'running',
      turns: [
        {
          id: 'turn_1',
          threadId,
          orchestration: 'direct',
          status: 'completed',
          prompt: 'first message',
          createdAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          model: 'main-model',
          steering: [],
          items: [],
          attachmentIds: [],
          activeSkillIds: [],
          injectedMemoryIds: [],
          injectedMemorySummaries: [],
          injectedDirectiveIds: [],
          injectedDirectiveSummaries: [],
          injectedInstructionSources: []
        },
        {
          id: turnId,
          threadId,
          orchestration: 'direct',
          status: 'running',
          prompt: 'second message',
          createdAt: new Date().toISOString(),
          model: 'main-model',
          steering: [],
          items: [],
          attachmentIds: [],
          activeSkillIds: [],
          injectedMemoryIds: [],
          injectedMemorySummaries: [],
          injectedDirectiveIds: [],
          injectedDirectiveSummaries: [],
          injectedInstructionSources: []
        }
      ]
    })
    await sessionStore.appendItem(threadId, makeUserItem(threadId, turnId, 'second message'))

    const service = new ThreadTitleService({
      threadStore,
      sessionStore,
      model: makeTitleModel(() => {
        called += 1
      }),
      events: {
        async record(event) {
          return {
            ...event,
            seq: 1,
            timestamp: new Date().toISOString()
          }
        }
      },
      nowIso: () => new Date().toISOString(),
      getRoles: () => undefined
    })

    await service.generateAfterTurn(threadId, turnId)

    expect(called).toBe(0)
    const updated = await threadStore.get(threadId)
    expect(updated?.title).toBe('Provisional')
  })
})
