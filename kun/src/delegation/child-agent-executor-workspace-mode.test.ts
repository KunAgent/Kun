import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { createChildAgentExecutor } from './child-agent-executor.js'

class CompletionModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'workspace-mode-child-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'child conclusion' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('createChildAgentExecutor workspaceMode inheritance', () => {
  it('inherits the parent thread workspaceMode onto new child threads', async () => {
    const model = new CompletionModel()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-14T00:00:00.000Z'
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const parent = await threads.create({
      title: 'ade parent',
      workspace: '/tmp/workspace',
      model: 'm',
      mode: 'agent',
      workspaceMode: 'ade'
    })
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: model.model,
      sessionStore,
      threadStore
    })

    await executor({
      childId: 'child_ade',
      parentThreadId: parent.id,
      parentTurnId: 'turn_ade',
      workspace: '/tmp/workspace',
      toolPolicy: 'readOnly',
      prompt: 'do the delegated thing',
      source: {
        prompt: 'do the delegated thing',
        attachmentIds: [],
        composerContexts: [],
        fileReferences: [],
        agentSurface: 'code'
      },
      agentSurface: 'code',
      security: {
        sandboxRoot: '/tmp/workspace',
        instructionsEnabled: false,
        memoryEnabled: false
      },
      signal: new AbortController().signal
    })

    expect((await threadStore.get('child_ade'))?.workspaceMode).toBe('ade')
  })

  it('leaves child threads without a mode when the parent is a Code thread', async () => {
    const model = new CompletionModel()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-14T00:00:00.000Z'
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const parent = await threads.create({
      title: 'code parent',
      workspace: '/tmp/workspace',
      model: 'm',
      mode: 'agent'
    })
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: model.model,
      sessionStore,
      threadStore
    })

    await executor({
      childId: 'child_code',
      parentThreadId: parent.id,
      parentTurnId: 'turn_code',
      workspace: '/tmp/workspace',
      toolPolicy: 'readOnly',
      prompt: 'do the delegated thing',
      source: {
        prompt: 'do the delegated thing',
        attachmentIds: [],
        composerContexts: [],
        fileReferences: [],
        agentSurface: 'code'
      },
      agentSurface: 'code',
      security: {
        sandboxRoot: '/tmp/workspace',
        instructionsEnabled: false,
        memoryEnabled: false
      },
      signal: new AbortController().signal
    })

    expect((await threadStore.get('child_code'))?.workspaceMode).toBeUndefined()
  })
})
