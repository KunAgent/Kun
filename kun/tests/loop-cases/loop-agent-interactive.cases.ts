import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { LocalToolHost, buildDefaultLocalTools } from '../../src/adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'
import { buildBrowserUseToolProviders } from '../../src/adapters/tool/browser-use-tool-provider.js'
import { CREATE_PLAN_TOOL_NAME } from '../../src/adapters/tool/create-plan-tool.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../../src/adapters/tool/goal-tools.js'
import { FileThreadStore, FileSessionStore } from '../../src/adapters/file/index.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import { COMPACTION_SYSTEM_PROMPT } from '../../src/loop/compaction-summary.js'
import { effectiveHistoryAfterLatestCompaction } from '../../src/loop/compaction-history.js'
import { resolveModelContextProfile } from '../../src/loop/model-context-profile.js'
import { isPlanClarifyingQuestion } from '../../src/loop/agent-loop.js'
import { LoopTelemetry } from '../../src/loop/loop-telemetry.js'
import {
  makeApprovalItem,
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeGoalContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '../../src/domain/item.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { createImmutablePrefix, setSystemPrompt } from '../../src/cache/immutable-prefix.js'
import { InflightTracker } from '../../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../../src/loop/steering-queue.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import type { SessionStore } from '../../src/ports/session-store.js'
import { TurnService } from '../../src/services/turn-service.js'
import type { TurnItem } from '../../src/contracts/items.js'
import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'
import type { BrowserController } from '../../src/ports/browser-controller.js'
import {
  bootstrapThread,
  makeFakeModel,
  makeHarness,
  makeSilentModel,
  resolveNextUserInput
} from '../loop-test-harness.js'

describe('AgentLoop', () => {
  it('uses per-turn model from startTurn request', async () => {
    let seenModel = ''
    const h = makeHarness({
      provider: 'selector',
      model: 'fallback',
      async *stream({ model }: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenModel = model
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'thread-model'
      })
    )
    const { turnId } = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello', model: 'deepseek-v4-pro' }
    })
    const status = await h.loop.runTurn(h.threadId, turnId)
    const thread = await h.threadStore.get(h.threadId)
    expect(status).toBe('completed')
    expect(seenModel).toBe('deepseek-v4-pro')
    expect(thread?.turns.find((turn) => turn.id === turnId)?.model).toBe('deepseek-v4-pro')
  })

  it('propagates partial tool updates through item_updated before final completion', async () => {
    const streamingTool = LocalToolHost.defineTool({
      name: 'streamer',
      description: 'stream',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async (_args, _context, onUpdate) => {
        await onUpdate?.({ output: { partial: 'hello' } })
        return { output: { done: true } }
      }
    })
    let calls = 0
    const h = makeHarness({
      provider: 'streaming-tool',
      model: 'streaming-tool',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_streamer',
            toolName: 'streamer',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [streamingTool] })
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const partialUpdate = events.find(
      (event) =>
        (event.kind === 'item_created' || event.kind === 'item_updated') &&
        event.item.kind === 'tool_result' &&
        event.item.status === 'running' &&
        (event.item.output as { partial?: string }).partial === 'hello'
    )
    expect(partialUpdate).toBeDefined()
    const thread = await h.threadStore.get(h.threadId)
    const finalResult = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_result' && item.callId === 'call_streamer')
    expect(finalResult).toMatchObject({
      kind: 'tool_result',
      status: 'completed',
      output: { done: true }
    })
  })

  it('waits for GUI user input tool responses and resumes the turn', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'input-model',
      model: 'input-model',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_input',
            toolName: 'request_user_input',
            arguments: {
              prompt: 'Pick one',
              questions: [
                {
                  header: 'Decision',
                  id: 'choice',
                  question: 'Pick one',
                  options: [
                    { label: 'Yes', description: 'Continue' },
                    { label: 'No', description: 'Stop' }
                  ]
                }
              ]
            }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const resolver = resolveNextUserInput(h, [
      { id: 'choice', label: 'Yes', value: 'yes' }
    ])

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    await resolver

    expect(status).toBe('completed')
    const thread = await h.threadStore.get(h.threadId)
    const inputItem = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'user_input')
    expect(inputItem).toMatchObject({
      kind: 'user_input',
      status: 'submitted',
      questions: [
        {
          header: 'Decision',
          id: 'choice',
          question: 'Pick one',
          options: [
            { label: 'Yes', description: 'Continue' },
            { label: 'No', description: 'Stop' }
          ]
        }
      ]
    })
    const result = (await h.sessionStore.loadItems(h.threadId)).find((item) => item.kind === 'tool_result')
    expect(result).toMatchObject({
      kind: 'tool_result',
      toolName: 'request_user_input',
      isError: false
    })
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'user_input_requested')).toBe(true)
    expect(events.filter((event) => event.kind === 'user_input_resolved')).toHaveLength(1)
  })

  it('arms the user-input gate before publishing the request event', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'immediate-input',
      model: 'immediate-input',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_input',
            toolName: 'request_user_input',
            arguments: { prompt: 'Continue?' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    let immediatelyResolved = false
    const unsubscribe = h.bus.subscribe(h.threadId, (event) => {
      if (event.kind !== 'user_input_requested') return
      immediatelyResolved = h.userInputGate.resolve(event.inputId, {
        status: 'submitted',
        answers: []
      }) === 'settled'
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    unsubscribe()

    expect(status).toBe('completed')
    expect(immediatelyResolved).toBe(true)
  })

  it('arms the approval gate before publishing the request event', async () => {
    const executed: string[] = []
    const tool = LocalToolHost.defineTool({
      name: 'requires_approval',
      description: 'Requires approval',
      inputSchema: { type: 'object', properties: {} },
      policy: 'on-request',
      execute: async () => {
        executed.push('requires_approval')
        return { output: { ok: true } }
      }
    })
    let calls = 0
    const h = makeHarness({
      provider: 'immediate-approval',
      model: 'immediate-approval',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_approval',
            toolName: 'requires_approval',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [tool] })
    await h.threadStore.upsert(createThreadRecord({
      id: h.threadId,
      title: 'demo',
      workspace: '/tmp',
      model: 'fake',
      approvalPolicy: 'always'
    }))
    const started = await h.turns.startTurn({ threadId: h.threadId, request: { prompt: 'hello' } })
    h.turnId = started.turnId
    let immediatelyAllowed = false
    const unsubscribe = h.bus.subscribe(h.threadId, (event) => {
      if (event.kind !== 'approval_requested') return
      immediatelyAllowed = h.approvalGate.decide(event.approvalId, 'allow')
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    unsubscribe()

    expect(status).toBe('completed')
    expect(immediatelyAllowed).toBe(true)
    expect(executed).toEqual(['requires_approval'])
  })

  it('uses the thread approval policy when executing auto tools', async () => {
    const approvalDecisions: string[] = []
    const tool = LocalToolHost.defineTool({
      name: 'dangerous_auto',
      description: 'Auto tool that should still prompt in untrusted mode.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async (args) => ({ output: { echoed: args.text ?? '' } })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'approval-check',
        model: 'approval-check',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_danger',
              toolName: 'dangerous_auto',
              arguments: { text: 'hi' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [tool] }
    )
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'fake',
        approvalPolicy: 'untrusted'
      })
    )
    const response = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello' }
    })
    h.turnId = response.turnId
    h.approvalGate.request = async (approval) => {
      approvalDecisions.push(approval.toolName)
      return 'allow'
    }

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(approvalDecisions).toEqual(['dangerous_auto'])
  })

  it('expires a pending approval and releases tool inflight work when interrupted', async () => {
    const guardedTool = LocalToolHost.defineTool({
      name: 'guarded_action',
      description: 'Waits for explicit approval.',
      inputSchema: { type: 'object' },
      policy: 'on-request',
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(makeFakeModel([
      {
        kind: 'tool_call_complete',
        callId: 'call_guarded',
        toolName: 'guarded_action',
        arguments: {}
      },
      { kind: 'completed', stopReason: 'tool_calls' }
    ]), { tools: [guardedTool] })
    await bootstrapThread(h)
    const thread = await h.threadStore.get(h.threadId)
    if (!thread) throw new Error('expected thread')
    await h.threadStore.upsert({ ...thread, approvalPolicy: 'on-request' })

    const running = h.loop.runTurn(h.threadId, h.turnId)
    let pendingApprovalId = ''
    for (let attempt = 0; attempt < 50; attempt += 1) {
      pendingApprovalId = h.approvalGate.pending(h.threadId)[0]?.id ?? ''
      if (pendingApprovalId) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(pendingApprovalId).toMatch(/^appr_[a-f0-9]{32}$/)

    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId })
    await expect(running).resolves.toBe('aborted')

    expect(h.approvalGate.get(pendingApprovalId)).toMatchObject({ status: 'expired' })
    expect(h.approvalGate.pending(h.threadId)).toEqual([])
    expect(h.inflight.size()).toBe(0)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'approval_resolved',
        approvalId: pendingApprovalId,
        status: 'expired',
        reason: 'turn aborted while awaiting approval'
      })
    ]))
  })

  it('interrupts immediately while approval request persistence is blocked', async () => {
    const guardedTool = LocalToolHost.defineTool({
      name: 'guarded_action',
      description: 'Waits for explicit approval.',
      inputSchema: { type: 'object' },
      policy: 'on-request',
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(makeFakeModel([
      {
        kind: 'tool_call_complete',
        callId: 'call_blocked_event',
        toolName: 'guarded_action',
        arguments: {}
      },
      { kind: 'completed', stopReason: 'tool_calls' }
    ]), { tools: [guardedTool] })
    await bootstrapThread(h)
    const thread = await h.threadStore.get(h.threadId)
    if (!thread) throw new Error('expected thread')
    await h.threadStore.upsert({ ...thread, approvalPolicy: 'on-request' })
    const originalAppend = h.sessionStore.appendEvent.bind(h.sessionStore)
    let releaseRequest!: () => void
    const requestBlocked = new Promise<void>((resolve) => { releaseRequest = resolve })
    let requestWriteStarted = false
    vi.spyOn(h.sessionStore, 'appendEvent').mockImplementation(async (threadId, event) => {
      if (event.kind === 'approval_requested') {
        requestWriteStarted = true
        await requestBlocked
      }
      await originalAppend(threadId, event)
    })

    const running = h.loop.runTurn(h.threadId, h.turnId)
    await vi.waitFor(() => expect(requestWriteStarted).toBe(true))
    const interrupting = h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId })
    const status = await Promise.race([
      running,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500))
    ])
    releaseRequest()

    expect(status).toBe('aborted')
    await expect(interrupting).resolves.toEqual({ status: 'aborted' })
    await expect(running).resolves.toBe('aborted')
    await vi.waitFor(async () => {
      const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'approval_resolved', status: 'expired' })
      ]))
    })
  })

  it('persists a denied approval as a failed tool call with model-visible feedback', async () => {
    const guardedTool = LocalToolHost.defineTool({
      name: 'guarded_action',
      description: 'Waits for explicit approval.',
      inputSchema: { type: 'object' },
      policy: 'on-request',
      execute: async () => ({ output: { ok: true } })
    })
    let modelStep = 0
    const modelRequests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'approval-denied',
      model: 'approval-denied',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        modelRequests.push(request)
        modelStep += 1
        if (modelStep === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_denied',
            toolName: 'guarded_action',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [guardedTool] })
    await bootstrapThread(h)
    const thread = await h.threadStore.get(h.threadId)
    if (!thread) throw new Error('expected thread')
    await h.threadStore.upsert({ ...thread, approvalPolicy: 'on-request' })

    const running = h.loop.runTurn(h.threadId, h.turnId)
    let approvalId = ''
    for (let attempt = 0; attempt < 50; attempt += 1) {
      approvalId = h.approvalGate.pending(h.threadId)[0]?.id ?? ''
      if (approvalId) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(h.approvalGate.decide(approvalId, 'deny', 'not approved for this task')).toBe(true)
    await expect(running).resolves.toBe('completed')

    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.find((item) => item.kind === 'tool_call' && item.callId === 'call_denied'))
      .toMatchObject({ status: 'failed' })
    expect(items.find((item) => item.kind === 'tool_result' && item.callId === 'call_denied'))
      .toMatchObject({
        isError: true,
        output: {
          code: 'approval_denied',
          approvalId,
          reason: 'not approved for this task'
        }
      })
    expect(modelRequests).toHaveLength(2)
    expect(JSON.stringify(modelRequests[1]?.history)).toContain('not approved for this task')
  })

  it('registers an approval before publishing it to live event subscribers', async () => {
    const guardedTool = LocalToolHost.defineTool({
      name: 'guarded_action',
      description: 'Waits for explicit approval.',
      inputSchema: { type: 'object' },
      policy: 'on-request',
      execute: async () => ({ output: { ok: true } })
    })
    let modelStep = 0
    const h = makeHarness({
      provider: 'approval-immediate',
      model: 'approval-immediate',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelStep += 1
        if (modelStep === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_immediate',
            toolName: 'guarded_action',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [guardedTool] })
    await bootstrapThread(h)
    const thread = await h.threadStore.get(h.threadId)
    if (!thread) throw new Error('expected thread')
    await h.threadStore.upsert({ ...thread, approvalPolicy: 'on-request' })
    let registeredBeforePublish = false
    const unsubscribe = h.bus.subscribe(h.threadId, (event) => {
      if (event.kind !== 'approval_requested') return
      registeredBeforePublish = h.approvalGate.get(event.approvalId)?.status === 'pending'
      h.approvalGate.decide(event.approvalId, 'deny', 'decided immediately')
    })

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    unsubscribe()
    expect(registeredBeforePublish).toBe(true)
  })

  it('persists toolKind from the advertised tool metadata', async () => {
    const tool = LocalToolHost.defineTool({
      name: 'write_file',
      description: 'Write a file.',
      toolKind: 'file_change',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      policy: 'auto',
      execute: async () => ({ output: { path: '/tmp/demo.ts' } })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'file-tool',
        model: 'file-tool',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_file',
              toolName: 'write_file',
              arguments: { path: '/tmp/demo.ts' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'done' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [tool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const toolCall = items.find((item) => item.kind === 'tool_call')
    const toolResult = items.find((item) => item.kind === 'tool_result')

    expect(status).toBe('completed')
    expect(toolCall).toMatchObject({ kind: 'tool_call', toolKind: 'file_change' })
    expect(toolResult).toMatchObject({ kind: 'tool_result', toolKind: 'file_change' })
  })
})
