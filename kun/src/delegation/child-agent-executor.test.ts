import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost, echoTool } from '../adapters/tool/local-tool-host.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { isPublicTurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeToolCallItem, makeToolResultItem } from '../domain/item.js'
import { InstructionRuntime } from '../instructions/instruction-runtime.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { createChildAgentExecutor } from './child-agent-executor.js'
import { validPptDirectionBundle } from './child-ppt-test-fixtures.js'
import { DelegationRuntime, FileDelegationStore, type ChildRunExecutor } from './delegation-runtime.js'

class AbortAwareModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'abort-aware-child-model'
  readonly requests: ModelRequest[] = []
  abortObserved = false
  private readonly streamStartedListeners: Array<() => void> = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    yield* [] as ModelStreamChunk[]
    this.requests.push(request)
    for (const listener of this.streamStartedListeners.splice(0)) listener()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    this.abortObserved = request.abortSignal.aborted
  }

  waitForStreamStart(): Promise<void> {
    if (this.requests.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.streamStartedListeners.push(resolve))
  }
}

class ApprovalToolModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'approval-child-model'
  requests = 0

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests === 1) {
      yield {
        kind: 'tool_call_complete',
        callId: 'call_echo',
        toolName: 'echo',
        arguments: { text: 'approved child work' }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'child completed after approval' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class PptExportModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'ppt-export-child-model'
  requests = 0

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests === 1) {
      yield {
        kind: 'tool_call_complete',
        callId: 'call_export',
        toolName: 'ppt_export',
        arguments: { input: 'deck.pptd', output: 'deck.pptx' }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'validated deck ready' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class HistoryModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'history-child-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield {
      kind: 'assistant_text_delta',
      text: this.requests.length === 1 ? 'initial child conclusion' : 'continued child conclusion'
    }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function makeAttachmentStore(): AttachmentStore {
  const now = '2026-07-08T00:00:00.000Z'
  const metadata = {
    id: 'att_111111111111111111111111',
    name: 'brief.md',
    kind: 'document' as const,
    mimeType: 'text/markdown',
    byteSize: 12,
    hash: 'a'.repeat(64),
    documentText: 'launch brief',
    documentFormat: 'text' as const,
    threadIds: [] as string[],
    workspaces: [] as string[],
    createdAt: now,
    updatedAt: now
  }
  return {
    create: async () => metadata,
    get: async (id) => id === metadata.id ? metadata : null,
    bindScope: async () => metadata,
    bindScopes: async (ids) => ids.map(() => metadata),
    resolveContent: async () => ({ ...metadata, data: Buffer.from('launch brief') }),
    textFallbackPolicy: () => ({
      textFallbackMaxBase64Bytes: 1_000_000,
      textFallbackMaxImageDimension: 4_096,
      textFallbackPreferredMimeType: 'image/webp'
    }),
    diagnostics: async () => ({ enabled: true, rootDir: '/tmp', count: 1, totalBytes: 12 })
  }
}

describe('createChildAgentExecutor', () => {
  it('appends a resumed turn to the same child thread with its prior history', async () => {
    const model = new HistoryModel()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    let instructionCalls = 0
    const instructionRuntime = new InstructionRuntime(undefined)
    instructionRuntime.resolveTurn = async () => {
      instructionCalls += 1
      return {
        instruction: 'AGENTS SHOULD NEVER ENTER THIS PPT CHILD',
        sources: [],
        injectedBytes: 42
      }
    }
    let memoryCalls = 0
    const memoryStore = {
      retrieve: async () => {
        memoryCalls += 1
        return []
      },
      setLastInjected: () => undefined
    } as unknown as MemoryStore
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: model.model,
      instructionRuntime,
      memoryStore,
      attachmentStore: () => makeAttachmentStore(),
      sessionStore,
      threadStore
    })
    const common = {
      childId: 'child_history',
      parentThreadId: 'parent',
      workspace: '/tmp/workspace',
      toolPolicy: 'readOnly' as const,
      signal: new AbortController().signal
    }

    const initialPrompt = 'inspect the original task'
    const initial = await executor({
      ...common,
      parentTurnId: 'turn_initial',
      prompt: initialPrompt,
      source: {
        prompt: initialPrompt,
        displayText: initialPrompt,
        attachmentIds: ['att_111111111111111111111111'],
        composerContexts: [{
          schemaVersion: 1,
          id: 'preview-ppt-review-111111111111111111111111',
          title: 'PPT review',
          summary: 'Selected opening slide',
          reference: {
            kind: 'ppt-review',
            schemaVersion: 1,
            workflowId: 'ppt_workflow',
            childId: 'child_history',
            slides: [{ slideId: 'slide-1', revision: 1 }]
          },
          revision: 1,
          generation: 1,
          attachmentId: `dev-preview-context:${'1'.repeat(64)}`,
          provenance: { source: 'dev-preview', workspaceId: 'a'.repeat(64) }
        }],
        fileReferences: [{
          path: '/tmp/workspace/brief.md',
          relativePath: 'brief.md',
          name: 'brief.md',
          kind: 'file'
        }],
        agentSurface: 'write'
      },
      controlPrompt: 'HOST PPT CONTROL: plan automatically',
      agentSurface: 'write',
      security: {
        sandboxRoot: '/tmp/workspace',
        instructionsEnabled: false,
        memoryEnabled: false
      }
    })
    const continuedPrompt = 'continue without repeating completed work'
    const continued = await executor({
      ...common,
      parentTurnId: 'turn_resume',
      prompt: continuedPrompt,
      source: {
        prompt: continuedPrompt,
        attachmentIds: [],
        composerContexts: [],
        fileReferences: [],
        agentSurface: 'write'
      },
      controlPrompt: 'HOST PPT CONTROL: revise previews',
      agentSurface: 'write',
      security: {
        sandboxRoot: '/tmp/workspace',
        instructionsEnabled: false,
        memoryEnabled: false
      },
      resumeChild: true
    })

    const childThread = await threadStore.get('child_history')
    expect(childThread?.turns).toHaveLength(2)
    expect(childThread?.turns.map((turn) => turn.agentSurface)).toEqual(['write', 'write'])
    const userMessages = childThread?.turns.flatMap((turn) =>
      turn.items.filter((item) => item.kind === 'user_message')) ?? []
    expect(userMessages.map((item) => item.text)).toEqual([initialPrompt, continuedPrompt])
    expect(userMessages[0]).toMatchObject({
      attachmentIds: ['att_111111111111111111111111'],
      composerContexts: [{ reference: { kind: 'ppt-review', workflowId: 'ppt_workflow' } }],
      fileReferences: [{ relativePath: 'brief.md', name: 'brief.md' }]
    })
    expect(model.requests).toHaveLength(2)
    expect(model.requests[1]?.threadId).toBe('child_history')
    expect(JSON.stringify(model.requests[0]?.history)).toContain(initialPrompt)
    // Host control is turn-local private input: it is sent with this request,
    // but must not become replayable history or part of the stable prefix.
    expect(JSON.stringify(model.requests[0]?.history)).not.toContain('HOST PPT CONTROL: plan automatically')
    expect(JSON.stringify(model.requests[0]?.contextInstructions)).toContain('HOST PPT CONTROL: plan automatically')
    expect(model.requests[0]?.redactedRequestValues).toContain('HOST PPT CONTROL: plan automatically')
    expect(JSON.stringify([model.requests[0]?.prefix, model.requests[1]?.prefix])).not.toContain('HOST PPT CONTROL')
    expect(model.requests[0]?.systemPrompt).toBe('test system prompt')
    expect(model.requests[1]?.systemPrompt).toBe('test system prompt')
    expect(model.requests[0]?.promptCachePartition).toBe(model.requests[1]?.promptCachePartition)
    const firstKinds = model.requests[0]?.history.map((item) => item.kind) ?? []
    const firstUserIndex = firstKinds.indexOf('user_message')
    const firstContextIndex = firstKinds.indexOf('model_context')
    expect(firstUserIndex).toBeGreaterThanOrEqual(0)
    expect(firstContextIndex).toBeGreaterThan(firstUserIndex)
    const firstContext = model.requests[0]?.history.find((item) => item.kind === 'model_context')
    expect(firstContext).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ kind: 'client-surface', state: 'active' }),
        expect.objectContaining({ kind: 'runtime-context', state: 'active' })
      ])
    })
    expect(firstContext?.blocks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'host-control' })
    ]))
    const canonicalItems = await sessionStore.loadItems('child_history')
    const privateSources = canonicalItems.filter((item) => item.kind === 'runtime_context_source')
    expect(privateSources).toHaveLength(2)
    expect(privateSources.every((item) => !isPublicTurnItem(item))).toBe(true)
    expect(Object.values(model.requests[0]?.messageAttachments ?? {})[0]?.documents).toEqual([
      expect.objectContaining({ id: 'att_111111111111111111111111', text: 'launch brief' })
    ])
    expect(JSON.stringify(model.requests[1]?.history)).toContain(initialPrompt)
    expect(JSON.stringify(model.requests[1]?.history)).toContain('initial child conclusion')
    expect(JSON.stringify(model.requests[1]?.history)).toContain(continuedPrompt)
    expect(JSON.stringify(model.requests[1]?.history)).not.toContain('HOST PPT CONTROL: plan automatically')
    expect(JSON.stringify(model.requests[1]?.history)).not.toContain('HOST PPT CONTROL: revise previews')
    expect(JSON.stringify(model.requests[1]?.contextInstructions)).not.toContain('HOST PPT CONTROL: plan automatically')
    expect(JSON.stringify(model.requests[1]?.contextInstructions)).toContain('HOST PPT CONTROL: revise previews')
    expect(model.requests[1]?.redactedRequestValues).toEqual(['HOST PPT CONTROL: revise previews'])
    expect(initial.inheritedHistoryItems).toBe(0)
    expect(continued.inheritedHistoryItems).toBe(0)
    expect(initial.prefixReused).toBe(true)
    expect(continued.prefixReused).toBe(true)
    expect(instructionCalls).toBe(0)
    expect(memoryCalls).toBe(0)
  })

  it('aborts the child model stream when the parent delegation signal is aborted', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-08T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new AbortAwareModel()
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: model.model,
      approvalPolicy: 'auto',
      sessionStore,
      threadStore,
      events,
      nowIso
    })
    const parent = new AbortController()
    const run = executor({
      childId: 'child_abort',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'keep streaming until interrupted',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek',
      toolPolicy: 'readOnly',
      signal: parent.signal
    })

    await model.waitForStreamStart()
    parent.abort()
    const result = await Promise.race([
      run.then(
        () => 'resolved' as const,
        () => 'rejected' as const
      ),
      new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), 500))
    ])

    expect(result).toBe('rejected')
    expect(model.abortObserved).toBe(true)
    expect(model.requests[0]).toMatchObject({
      model: 'deepseek-v4-pro',
      providerId: 'deepseek'
    })
    expect((await threadStore.get('child_abort'))?.status).toBe('idle')
    expect((await threadStore.get('child_abort'))?.turns[0]?.status).toBe('aborted')
  })

  it('registers child approvals on the runtime-owned gate and continues after a decision', async () => {
    const approvalGate = new InMemoryApprovalGate()
    const model = new ApprovalToolModel()
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [echoTool] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: model.model,
      approvalPolicy: 'always',
      approvalGate
    })
    const run = executor({
      childId: 'child_approval',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'use echo',
      workspace: '/tmp/workspace',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })

    await waitFor(() => expect(approvalGate.pending('child_approval')).toHaveLength(1))
    const pending = approvalGate.pending('child_approval')[0]
    expect(pending).toMatchObject({
      threadId: 'child_approval',
      toolName: 'echo',
      status: 'pending'
    })
    expect(approvalGate.decide(pending.id, 'allow')).toBe(true)

    await expect(run).resolves.toMatchObject({
      summary: 'child completed after approval',
      toolInvocations: 1
    })
    expect(approvalGate.get(pending.id)?.status).toBe('allowed')
  })

  it('returns the validated ppt_export result as a structured deck artifact', async () => {
    const pptExport = LocalToolHost.defineTool({
      name: 'ppt_export',
      description: 'test exporter',
      toolKind: 'file_change',
      policy: 'auto',
      sideEffect: 'unknown',
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      execute: async () => ({
        output: {
          output: 'deck.pptx',
          absolutePath: '/tmp/workspace/deck.pptx',
          slides: 1,
          editableSlides: 1,
          validated: true
        }
      })
    })
    const executor = createChildAgentExecutor({
      model: new PptExportModel(),
      toolHost: new LocalToolHost({ tools: [pptExport] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: 'ppt-export-child-model',
      approvalPolicy: 'auto'
    })

    await expect(executor({
      childId: 'child_ppt_export',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'export the deck',
      workspace: '/tmp/workspace',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })).resolves.toMatchObject({
      summary: 'validated deck ready',
      deckArtifact: {
        output: 'deck.pptx',
        slides: 1,
        editableSlides: 1,
        validated: true
      }
    })
  })

  it('extracts a successful direction tool result before surfacing a later fatal runtime error', async () => {
    const childId = 'child_direction_then_fatal'
    const directionBundle = validPptDirectionBundle(childId)
    const executor = createChildAgentExecutor({
      model: {
        provider: 'fallback', model: 'fallback-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          yield await Promise.reject(new Error('fallback model must not run'))
        }
      },
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: 'fallback-model',
      createDelegatedRuntime: (boundary) => ({
        handlesProvider: (providerId) => providerId === 'native-test',
        capabilities: () => ({
          nativeResume: true, structuredStreaming: true, kunTools: true,
          externalApproval: true, liveSteering: true, nativeContextTelemetry: true, fork: true
        }),
        runTurn: async (threadId, turnId) => {
          await boundary.turns.applyItem(threadId, makeToolCallItem({
            id: 'item_direction_call', threadId, turnId, callId: 'call_direction',
            toolName: 'ppt_create_direction_bundle', arguments: {}, status: 'completed'
          }))
          await boundary.turns.applyItem(threadId, makeToolResultItem({
            id: 'item_direction_result', threadId, turnId, callId: 'call_direction',
            toolName: 'ppt_create_direction_bundle', output: { directionBundle }
          }))
          await boundary.events.record({
            kind: 'error', threadId, turnId, message: 'fatal after direction creation',
            code: 'late_fatal', severity: 'error'
          })
          await boundary.turns.finishTurn({ threadId, turnId, status: 'failed' })
          return 'failed'
        }
      })
    })

    const run = executor({
      childId, parentThreadId: 'thr_parent', parentTurnId: 'turn_parent',
      prompt: 'create directions', workspace: '/tmp/workspace', model: 'native-model',
      providerId: 'native-test', toolPolicy: 'inherit', signal: new AbortController().signal
    })
    await expect(run).rejects.toMatchObject({
      name: 'ChildResultExecutionError', message: 'fatal after direction creation',
      result: { directionBundle }
    })
  })

  it('expires a shared child approval when the parent aborts', async () => {
    const approvalGate = new InMemoryApprovalGate()
    const executor = createChildAgentExecutor({
      model: new ApprovalToolModel(),
      toolHost: new LocalToolHost({ tools: [echoTool] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: 'approval-child-model',
      approvalPolicy: 'always',
      approvalGate
    })
    const parent = new AbortController()
    const run = executor({
      childId: 'child_approval_abort',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'use echo',
      workspace: '/tmp/workspace',
      toolPolicy: 'inherit',
      signal: parent.signal
    })

    await waitFor(() => expect(approvalGate.pending('child_approval_abort')).toHaveLength(1))
    const pending = approvalGate.pending('child_approval_abort')[0]
    parent.abort()

    await expect(run).rejects.toThrow(/aborted/)
    expect(approvalGate.get(pending.id)).toMatchObject({
      status: 'expired',
      reason: 'turn aborted while awaiting approval'
    })
  })

  it('dispatches provider-native children through the host runtime factory with the narrowed boundary', async () => {
    let nativeModelCalled = false
    let capturedBoundary:
      | Parameters<NonNullable<
          Parameters<typeof createChildAgentExecutor>[0]['createDelegatedRuntime']
        >>[0]
      | undefined
    const executor = createChildAgentExecutor({
      model: {
        provider: 'http',
        model: 'http-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          nativeModelCalled = true
          if (nativeModelCalled) {
            throw new Error('HTTP model must not own a subscription child')
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: 'http-model',
      createDelegatedRuntime: (boundary) => {
        capturedBoundary = boundary
        return {
          handlesProvider: (providerId) => providerId === 'claude-subscription',
          capabilities: (providerId) => providerId === 'claude-subscription'
            ? {
                nativeResume: true,
                structuredStreaming: true,
                kunTools: true,
                externalApproval: true,
                liveSteering: true,
                nativeContextTelemetry: true,
                fork: true
              }
            : undefined,
          runTurn: async (threadId, turnId) => {
            await boundary.turns.applyItem(
              threadId,
              makeAssistantTextItem({
                id: 'item_subscription',
                threadId,
                turnId,
                text: 'subscription child completed',
                status: 'completed'
              })
            )
            await boundary.turns.finishTurn({ threadId, turnId, status: 'completed' })
            return 'completed'
          }
        }
      }
    })

    await expect(executor({
      childId: 'child_subscription',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'inspect safely',
      workspace: '/tmp/workspace',
      model: 'claude-sonnet-4-5',
      providerId: 'claude-subscription',
      toolPolicy: 'readOnly',
      allowedTools: ['read', 'bash'],
      blockedTools: ['grep'],
      blockedMcpServers: ['private'],
      blockedSkills: ['unsafe-skill'],
      skillsEnabled: false,
      security: {
        sandboxRoot: '/tmp/workspace',
        allowedToolNames: ['read', 'web_search', 'fast_context'],
        allowedProviderIds: ['builtin', 'fast-context'],
        allowedSkillIds: ['safe-skill'],
        blockedToolNames: ['write'],
        blockedProviderIds: ['mcp:blocked'],
        blockedSkillIds: ['parent-blocked'],
        memoryEnabled: false
      },
      signal: new AbortController().signal
    })).resolves.toMatchObject({ summary: 'subscription child completed' })

    expect(nativeModelCalled).toBe(false)
    expect(capturedBoundary).toMatchObject({
      toolPolicy: 'readOnly',
      allowedToolNames: ['read', 'fast_context'],
      allowedProviderIds: ['builtin', 'fast-context'],
      allowedSkillIds: ['safe-skill'],
      blockedToolNames: ['write', 'grep'],
      blockedProviderIds: ['mcp:blocked', 'mcp:private'],
      blockedSkillIds: ['parent-blocked', 'unsafe-skill'],
      skillsEnabled: false,
      memoryEnabled: false
    })
  })
})

describe('DelegationRuntime detached children', () => {
  it('keeps a background child running when the parent signal is aborted', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
    try {
      let childSignal: AbortSignal | undefined
      let resolveStarted: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve
      })
      const executor: ChildRunExecutor = async (input) => {
        childSignal = input.signal
        resolveStarted()
        if (!input.signal.aborted) {
          await new Promise<void>((abortResolve) => {
            input.signal.addEventListener('abort', () => abortResolve(), { once: true })
          })
        }
        throw new Error('child aborted')
      }
      const runtime = new DelegationRuntime({
        config: {
          enabled: true,
          useExistingAgents: true,
          maxParallel: 1,
          proactiveRetry: { enabled: true, maxAttempts: 3 },
          defaultToolPolicy: 'readOnly',
          profiles: {}
        },
        store: new FileDelegationStore(tempDir),
        idGenerator: () => 'child_detached',
        nowIso: () => '2026-07-08T00:00:00.000Z',
        executor
      })
      const parent = new AbortController()

      const queued = await runtime.runChild({
        parentThreadId: 'thr_parent',
        parentTurnId: 'turn_parent',
        prompt: 'background work',
        detach: true,
        signal: parent.signal
      })
      expect(queued.status).toBe('queued')
      await started

      parent.abort()
      await delay(20)
      expect(childSignal?.aborted).toBe(false)
      expect((await runtime.diagnostics('thr_parent')).childRuns[0]?.status).toBe('running')

      expect(runtime.abortChild('child_detached')).toBe(true)
      await waitFor(async () => {
        const status = (await runtime.diagnostics('thr_parent')).childRuns[0]?.status
        expect(status).toBe('aborted')
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + 500
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await delay(10)
    }
  }
  if (lastError) throw lastError
}
