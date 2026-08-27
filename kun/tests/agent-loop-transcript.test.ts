import { describe, expect, it } from 'vitest'
import { LocalToolHost, requestUserInputTool } from '../src/adapters/tool/local-tool-host.js'
import { emptyUsageSnapshot } from '../src/contracts/usage.js'
import { makeUserItem } from '../src/domain/item.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { projectCompatMessages } from '../src/adapters/model/compat-message-projector.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { TOKEN_ECONOMY_INSTRUCTION } from '../src/loop/token-economy.js'
import { modelRequestContextText } from '../src/loop/model-request-context.js'
import { decideApproval } from '../src/server/routes/approvals.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import {
  CapturingToolHost,
  ScriptedCapturingModel,
  captureTranscript,
  normalizeTranscriptValue,
  runTranscript
} from './loop-transcript-harness.js'

describe('AgentLoop transcript characterization', () => {
  it('replays a text, reasoning, and usage turn through stable public boundaries', async () => {
    const model = new ScriptedCapturingModel([[
      { kind: 'assistant_reasoning_delta', text: 'First inspect the request.' },
      { kind: 'assistant_text_delta', text: 'The request is healthy.' },
      {
        kind: 'usage',
        usage: {
          ...emptyUsageSnapshot(),
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
          turns: 1
        }
      },
      { kind: 'completed', stopReason: 'stop' }
    ]])
    const harness = makeHarness(model, { tools: [] })
    await bootstrapThread(harness, {
      request: {
        prompt: 'Assess the request.',
        model: 'transcript-model',
        reasoningEffort: 'high'
      }
    })

    const transcript = await runTranscript({ harness, model })

    expect(transcript.status).toBe('completed')
    expect(transcript.modelRequests).toHaveLength(1)
    expect(transcript.modelRequests[0]).toMatchObject({
      threadId: 'thr_1',
      turnId: 'turn_1',
      model: 'transcript-model',
      reasoningEffort: 'high',
      tools: [],
      history: expect.arrayContaining([
        expect.objectContaining({
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: 'Assess the request.'
        })
      ])
    })
    expect(transcript.sessionItems).toEqual([
      expect.objectContaining({ kind: 'user_message', text: 'Assess the request.' }),
      expect.objectContaining({ kind: 'model_context' }),
      expect.objectContaining({ kind: 'assistant_reasoning', text: 'First inspect the request.' }),
      expect.objectContaining({ kind: 'assistant_text', text: 'The request is healthy.' })
    ])
    expect(transcript.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'turn_started',
      'assistant_reasoning_delta',
      'assistant_text_delta',
      'usage',
      'turn_completed'
    ]))
    expect(terminalEvents(transcript.events)).toEqual([
      expect.objectContaining({ kind: 'turn_completed' })
    ])
    expect(transcript.usage).toMatchObject({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
      turns: 1
    })
    expect(transcript.eventProjection).toMatchObject({
      lastSeq: transcript.events.at(-1)?.seq,
      usage: expect.objectContaining({ totalTokens: 18 }),
      turns: [expect.objectContaining({ status: 'completed' })]
    })
    expect(transcript.thread).toMatchObject({ id: 'thr_1', status: 'idle' })
    expect(JSON.stringify(transcript.thread)).not.toContain('model_context')
    expect(transcript.turn).toMatchObject({ id: 'turn_1', status: 'completed' })
    expect(transcript.toolExecutionOrder).toEqual([])
  })

  it('injects host control only on its owning native turn', async () => {
    const hostControl = 'Private PPT host control for turn one.'
    const model = new ScriptedCapturingModel([
      [{ kind: 'assistant_text_delta', text: 'first' }, { kind: 'completed', stopReason: 'stop' }],
      [{ kind: 'assistant_text_delta', text: 'second' }, { kind: 'completed', stopReason: 'stop' }]
    ])
    const harness = makeHarness(model, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 100_000, hardThreshold: 120_000 })
    })
    await harness.threadStore.upsert(createThreadRecord({
      id: harness.threadId, title: 'native host control', workspace: '/tmp', model: 'fake'
    }))
    const first = await harness.turns.startTurn({
      threadId: harness.threadId,
      request: { prompt: 'first request' }
    }, { runtimeContext: { kind: 'host-control', content: hostControl } })
    await expect(harness.loop.runTurn(harness.threadId, first.turnId)).resolves.toBe('completed')
    const second = await harness.turns.startTurn({
      threadId: harness.threadId,
      request: { prompt: 'second request' }
    })
    await expect(harness.loop.runTurn(harness.threadId, second.turnId)).resolves.toBe('completed')

    expect(model.requests[0]?.contextInstructions?.join('\n')).toContain(hostControl)
    expect(model.requests[0]?.redactedRequestValues).toEqual([hostControl])
    expect(JSON.stringify(model.requests[0]?.history)).not.toContain(hostControl)
    expect(model.requests[1]?.contextInstructions?.join('\n') ?? '').not.toContain(hostControl)
    expect(model.requests[1]?.redactedRequestValues ?? []).toEqual([])
    expect(JSON.stringify(model.requests[1]?.history)).not.toContain(hostControl)
    expect(JSON.stringify(await harness.sessionStore.loadItems(harness.threadId)))
      .toContain(hostControl)
    expect((await harness.sessionStore.loadItems(harness.threadId))
      .filter((item) => item.kind === 'model_context')
      .some((item) => item.text.includes(hostControl))).toBe(false)
  })

  it('keeps consecutive token-economy wire messages append-only', async () => {
    const model = new ScriptedCapturingModel([
      [{ kind: 'assistant_text_delta', text: 'first' }, { kind: 'completed', stopReason: 'stop' }],
      [{ kind: 'assistant_text_delta', text: 'second' }, { kind: 'completed', stopReason: 'stop' }]
    ])
    const harness = makeHarness(model, {
      tools: [],
      tokenEconomy: { enabled: true },
      compactor: new ContextCompactor({ softThreshold: 100_000, hardThreshold: 120_000 })
    })
    await harness.threadStore.upsert(createThreadRecord({
      id: harness.threadId, title: 'cache continuity', workspace: '/tmp', model: 'fake'
    }))
    const first = await harness.turns.startTurn({
      threadId: harness.threadId,
      request: { prompt: 'hi' }
    })
    await expect(harness.loop.runTurn(harness.threadId, first.turnId)).resolves.toBe('completed')
    const second = await harness.turns.startTurn({
      threadId: harness.threadId,
      request: { prompt: 'hi' }
    })
    await expect(harness.loop.runTurn(harness.threadId, second.turnId)).resolves.toBe('completed')

    const firstRequest = model.requests[0]
    const secondRequest = model.requests[1]
    expect(firstRequest).toBeDefined()
    expect(secondRequest).toBeDefined()
    if (!firstRequest || !secondRequest) return
    const projectionOptions = { thinkingMode: false, supportsImages: false }
    const firstMessages = projectCompatMessages(firstRequest, projectionOptions)
    const secondMessages = projectCompatMessages(secondRequest, projectionOptions)

    expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)
    expect(firstRequest.contextInstructions ?? []).toEqual([])
    expect(secondRequest.contextInstructions ?? []).toEqual([])
    const firstContexts = firstRequest.history.filter((item) => item.kind === 'model_context')
    const secondContexts = secondRequest.history.filter((item) => item.kind === 'model_context')
    expect(firstContexts).toHaveLength(1)
    expect(firstContexts[0]?.kind === 'model_context' ? firstContexts[0].text : '')
      .toContain(TOKEN_ECONOMY_INSTRUCTION)
    expect(secondContexts).toHaveLength(2)
    expect(secondContexts[1]?.kind === 'model_context' ? secondContexts[1].text : '')
      .not.toContain(TOKEN_ECONOMY_INSTRUCTION)
  })

  it('keeps the cache prefix stable when a GUI thread switches from Code to Design', async () => {
    const model = new ScriptedCapturingModel([
      [{ kind: 'assistant_text_delta', text: 'code done' }, { kind: 'completed', stopReason: 'stop' }],
      [{ kind: 'assistant_text_delta', text: 'design done' }, { kind: 'completed', stopReason: 'stop' }]
    ])
    const codeTool = LocalToolHost.defineTool({
      name: 'code_only',
      description: 'Code-only workbench tool.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      shouldAdvertise: (context) => context.agentSurface === 'code',
      execute: async () => ({ output: { ok: true } })
    })
    const designTool = LocalToolHost.defineTool({
      name: 'design_only',
      description: 'Design-only workbench tool.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      shouldAdvertise: (context) =>
        context.agentSurface === 'design' && context.guiDesignMode === true,
      execute: async () => ({ output: { ok: true } })
    })
    const harness = makeHarness(model, {
      tools: [designTool, codeTool],
      compactor: new ContextCompactor({ softThreshold: 100_000, hardThreshold: 120_000 })
    })
    await harness.threadStore.upsert(createThreadRecord({
      id: harness.threadId, title: 'mode switch cache', workspace: '/tmp', model: 'fake'
    }))
    const codeTurn = await harness.turns.startTurn({
      threadId: harness.threadId,
      request: { prompt: 'implement it', clientSurface: 'gui', agentSurface: 'code' }
    })
    await expect(harness.loop.runTurn(harness.threadId, codeTurn.turnId)).resolves.toBe('completed')
    const designDocumentTarget = {
      documentId: 'doc_mode_switch',
      boardArtifactId: 'board_mode_switch'
    }
    const designTurn = await harness.turns.startTurn({
      threadId: harness.threadId,
      request: {
        prompt: 'now design it',
        clientSurface: 'gui',
        agentSurface: 'design',
        guiDesignCanvas: true,
        guiDesignMode: true,
        designProfile: {
          version: 1,
          documentTarget: designDocumentTarget,
          outputMedium: 'html',
          target: 'web',
          preset: 'none',
          context: { tone: [] }
        },
        designDocumentTarget
      }
    })
    await expect(harness.loop.runTurn(harness.threadId, designTurn.turnId)).resolves.toBe('completed')

    const [codeRequest, designRequest] = model.requests
    expect(codeRequest).toBeDefined()
    expect(designRequest).toBeDefined()
    if (!codeRequest || !designRequest) return
    expect(codeRequest.tools.map((tool) => tool.name)).toEqual(['code_only', 'design_only'])
    expect(designRequest.tools).toEqual(codeRequest.tools)
    expect(designRequest.systemPrompt).toBe(codeRequest.systemPrompt)
    expect(designRequest.prefix).toEqual(codeRequest.prefix)
    expect(designRequest.promptCachePartition).toBe(codeRequest.promptCachePartition)
    expect(designRequest.modeInstruction).toBeUndefined()
    expect(modelRequestContextText(designRequest)).toContain('Kun Design mode')

    const projectionOptions = { thinkingMode: false, supportsImages: false }
    const codeMessages = projectCompatMessages(codeRequest, projectionOptions)
    const designMessages = projectCompatMessages(designRequest, projectionOptions)
    expect(designMessages.slice(0, codeMessages.length)).toEqual(codeMessages)
  })

  it('replays a tool round-trip with request history and execution order intact', async () => {
    const model = new ScriptedCapturingModel([
      [
        {
          kind: 'tool_call_complete',
          callId: 'call_echo',
          toolName: 'echo',
          arguments: { text: 'ping' }
        },
        { kind: 'completed', stopReason: 'tool_calls' }
      ],
      [
        { kind: 'assistant_text_delta', text: 'Echoed ping.' },
        { kind: 'completed', stopReason: 'stop' }
      ]
    ])
    const echo = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo input text.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async (args) => ({ output: { echoed: args.text } })
    })
    const toolHost = new CapturingToolHost({ tools: [echo] })
    // Keep this characterization focused on request-history ordering. The
    // harness default compaction threshold is intentionally tiny for unrelated
    // tests and the complete-request preflight now correctly includes the tool
    // schema in that threshold.
    const harness = makeHarness(model, {
      toolHost,
      compactor: new ContextCompactor({
        softThreshold: 100_000,
        hardThreshold: 120_000
      })
    })
    await bootstrapThread(harness, {
      request: { prompt: 'Please echo ping.', model: 'transcript-model' }
    })

    const transcript = await runTranscript({ harness, model, toolHost })

    expect(transcript.status).toBe('completed')
    expect(transcript.modelRequests).toHaveLength(2)
    expect(transcript.modelRequests[0]?.tools).toEqual([
      expect.objectContaining({ name: 'echo', toolKind: 'tool_call' })
    ])
    expect(transcript.modelRequests[1]?.history.map((item) => item.kind)).toEqual([
      'user_message',
      'model_context',
      'tool_call',
      'tool_result',
      'model_context'
    ])
    expect(transcript.toolExecutionOrder).toEqual([
      {
        callId: 'call_echo',
        toolName: 'echo',
        providerId: 'builtin',
        toolKind: 'tool_call',
        arguments: { text: 'ping' }
      }
    ])
    expect(transcript.sessionItems.map((item) => item.kind)).toEqual([
      'user_message',
      'model_context',
      'tool_call',
      'tool_result',
      'model_context',
      'assistant_text'
    ])
    expect(transcript.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'tool_call_ready',
      'tool_result_upload_wait',
      'turn_completed'
    ]))
    expect(transcript.turn).toMatchObject({ status: 'completed' })
  })

  it('shares one owned model run when a caller submits the same turn twice', async () => {
    let markStarted: (() => void) | undefined
    let release: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const continueRun = new Promise<void>((resolve) => { release = resolve })
    const model = new ScriptedCapturingModel([
      async function *(): AsyncIterable<ModelStreamChunk> {
        markStarted?.()
        await continueRun
        yield { kind: 'assistant_text_delta', text: 'Only one runner.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    ])
    const harness = makeHarness(model, { tools: [] })
    await bootstrapThread(harness, { request: { prompt: 'Run once.', model: 'transcript-model' } })

    const first = harness.loop.runTurn(harness.threadId, harness.turnId)
    const second = harness.loop.runTurn(harness.threadId, harness.turnId)
    expect(second).toBe(first)
    await started
    release?.()
    const status = await first
    await expect(second).resolves.toBe('completed')
    const transcript = await captureTranscript({ harness, model, status })

    expect(transcript.modelRequests).toHaveLength(1)
    expect(transcript.toolExecutionOrder).toEqual([])
    expect(terminalEvents(transcript.events)).toEqual([
      expect.objectContaining({ kind: 'turn_completed' })
    ])
  })

  it('replays an interrupt without timers and preserves the abort lifecycle contract', async () => {
    let markModelWaiting: (() => void) | undefined
    const modelWaiting = new Promise<void>((resolve) => {
      markModelWaiting = resolve
    })
    const model = new ScriptedCapturingModel([
      async function *({ request }): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'assistant_text_delta', text: 'Partial response.' }
        markModelWaiting?.()
        await waitForAbort(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    ])
    const harness = makeHarness(model, { tools: [] })
    await bootstrapThread(harness, {
      request: { prompt: 'Start then stop.', model: 'transcript-model' }
    })

    const running = harness.loop.runTurn(harness.threadId, harness.turnId)
    await modelWaiting
    await harness.turns.interruptTurn({ threadId: harness.threadId, turnId: harness.turnId })
    const status = await running
    const transcript = await captureTranscript({ harness, model, status })

    expect(transcript.status).toBe('aborted')
    expect(transcript.modelRequests).toHaveLength(1)
    expect(transcript.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'assistant_text_delta',
      'turn_aborted'
    ]))
    expect(transcript.events.some((event) => event.kind === 'turn_completed')).toBe(false)
    expect(terminalEvents(transcript.events)).toEqual([
      expect.objectContaining({ kind: 'turn_aborted' })
    ])
    expect(transcript.sessionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant_text', text: 'Partial response.' })
    ]))
    expect(transcript.thread).toMatchObject({ status: 'idle' })
    expect(transcript.turn).toMatchObject({ status: 'aborted' })
    expect(harness.inflight.size()).toBe(0)
  })

  it('replays an approval round with the requested and resolved event contract intact', async () => {
    const model = new ScriptedCapturingModel([
      [
        {
          kind: 'tool_call_complete',
          callId: 'call_approved',
          toolName: 'approved_tool',
          arguments: {}
        },
        { kind: 'completed', stopReason: 'tool_calls' }
      ],
      [{ kind: 'completed', stopReason: 'stop' }]
    ])
    const tool = LocalToolHost.defineTool({
      name: 'approved_tool',
      description: 'Requires an explicit approval.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'on-request',
      execute: async () => ({ output: { approved: true } })
    })
    const toolHost = new CapturingToolHost({ tools: [tool] })
    const harness = makeHarness(model, { toolHost })
    await bootstrapThread(harness, { request: { prompt: 'Run the approved tool.' } })
    const thread = await harness.threadStore.get(harness.threadId)
    await harness.threadStore.upsert({ ...thread!, approvalPolicy: 'always' })
    let approvalResponse: ReturnType<typeof decideApproval> | undefined
    const unsubscribe = harness.bus.subscribe(harness.threadId, (event) => {
      if (event.kind === 'approval_requested') {
        approvalResponse = decideApproval({
          approvalId: event.approvalId,
          request: new Request(`http://127.0.0.1/v1/approvals/${event.approvalId}`, {
            method: 'POST',
            body: JSON.stringify({ decision: 'allow' })
          }),
          gate: harness.approvalGate,
          events: harness.events
        })
      }
    })

    const status = await harness.loop.runTurn(harness.threadId, harness.turnId)
    if (!approvalResponse) throw new Error('expected approval request event')
    const response = await approvalResponse
    const transcript = await captureTranscript({ harness, model, toolHost, status })
    unsubscribe()

    const kinds = transcript.events.map((event) => event.kind)
    expect(transcript.status).toBe('completed')
    expect(response.status).toBe(200)
    expect(kinds.indexOf('approval_requested')).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf('approval_resolved')).toBeGreaterThan(kinds.indexOf('approval_requested'))
    expect(transcript.toolExecutionOrder).toEqual([
      expect.objectContaining({ callId: 'call_approved', toolName: 'approved_tool' })
    ])
  })

  it('replays a random-id user-input round through stable normalized artifacts', async () => {
    const model = new ScriptedCapturingModel([
      [
        {
          kind: 'tool_call_complete',
          callId: 'call_input',
          toolName: 'request_user_input',
          arguments: { prompt: 'Continue?' }
        },
        { kind: 'completed', stopReason: 'tool_calls' }
      ],
      [{ kind: 'assistant_text_delta', text: 'Continuing now.' }, { kind: 'completed', stopReason: 'stop' }]
    ])
    const toolHost = new CapturingToolHost({ tools: [requestUserInputTool] })
    const harness = makeHarness(model, { toolHost })
    await bootstrapThread(harness, { request: { prompt: 'Ask me first.' } })
    let immediatelyResolved = false
    const unsubscribe = harness.bus.subscribe(harness.threadId, (event) => {
      if (event.kind === 'user_input_requested') {
        immediatelyResolved = harness.userInputGate.resolve(event.inputId, {
          status: 'submitted',
          answers: []
        }) === 'settled'
      }
    })

    const transcript = await runTranscript({ harness, model, toolHost })
    unsubscribe()

    expect(transcript.status).toBe('completed')
    expect(immediatelyResolved).toBe(true)
    expect(transcript.events.find((event) => event.kind === 'user_input_requested')).toMatchObject({
      inputId: '<input_1>'
    })
    expect(transcript.sessionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_input',
        id: '<item_input_1>',
        inputId: '<input_1>',
        status: 'submitted'
      })
    ]))
    expect(JSON.stringify(transcript)).not.toMatch(/in_[a-z0-9]{8}(?![a-z0-9])/i)
    expect(transcript.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'user_input_requested',
      'user_input_resolved',
      'turn_completed'
    ]))
  })

  it('replays automatic compaction before the next model request', async () => {
    const model = new ScriptedCapturingModel([[
      { kind: 'completed', stopReason: 'stop' }
    ]])
    const harness = makeHarness(model, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 8, hardThreshold: 16 })
    })
    await bootstrapThread(harness, { request: { prompt: 'Compact this history.' } })
    for (let index = 0; index < 10; index += 1) {
      await harness.sessionStore.appendItem(
        harness.threadId,
        makeUserItem({
          id: `history_${index}`,
          threadId: harness.threadId,
          turnId: harness.turnId,
          text: `Historical detail ${index}: ${'x'.repeat(24)}`
        })
      )
    }

    const transcript = await runTranscript({ harness, model })

    expect(transcript.status).toBe('completed')
    expect(transcript.modelRequests).toHaveLength(1)
    expect(transcript.modelRequests[0]?.history.some((item) => item.kind === 'compaction')).toBe(true)
    expect(transcript.sessionItems.some((item) => item.kind === 'compaction')).toBe(true)
    expect(transcript.events.map((event) => event.kind)).toContain('compaction_completed')
  })

  it('replays a model failure as an error event and failed terminal turn', async () => {
    const model = new ScriptedCapturingModel([[
      { kind: 'error', message: 'upstream unavailable', code: 'upstream_unavailable' }
    ]])
    const harness = makeHarness(model, { tools: [] })
    await bootstrapThread(harness, { request: { prompt: 'Trigger a failure.' } })

    const transcript = await runTranscript({ harness, model })

    expect(transcript.status).toBe('failed')
    expect(transcript.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'upstream_unavailable', message: 'upstream unavailable' }),
      expect.objectContaining({ kind: 'turn_failed' })
    ]))
    expect(terminalEvents(transcript.events)).toEqual([
      expect.objectContaining({ kind: 'turn_failed' })
    ])
    expect(transcript.turn).toMatchObject({ status: 'failed' })
    expect(transcript.toolExecutionOrder).toEqual([])
  })

  it('replays deletion after cancellation without post-delete tool execution', async () => {
    let markModelWaiting: (() => void) | undefined
    const modelWaiting = new Promise<void>((resolve) => { markModelWaiting = resolve })
    const model = new ScriptedCapturingModel([
      async function *({ request }): AsyncIterable<ModelStreamChunk> {
        markModelWaiting?.()
        await waitForAbort(request)
        // A provider can still yield buffered data after cancellation. The
        // loop must not persist or execute it after the thread is deleted.
        yield {
          kind: 'tool_call_complete',
          callId: 'call_after_delete',
          toolName: 'echo',
          arguments: { text: 'must not run' }
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    ])
    const echo = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo input.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      policy: 'auto',
      execute: async (args) => ({ output: args })
    })
    const toolHost = new CapturingToolHost({ tools: [echo] })
    const harness = makeHarness(model, { toolHost })
    await bootstrapThread(harness, { request: { prompt: 'Delete this turn.' } })

    const running = harness.loop.runTurn(harness.threadId, harness.turnId)
    await modelWaiting
    harness.turns.abortTurnExecution(harness.turnId)
    expect(await harness.threads.delete(harness.threadId)).toBe(true)
    const status = await running
    const transcript = await captureTranscript({ harness, model, toolHost, status })

    expect(transcript.status).toBe('aborted')
    expect(transcript.thread).toBeNull()
    expect(transcript.modelRequests).toHaveLength(1)
    expect(transcript.toolExecutionOrder).toEqual([])
    expect(transcript.events).toEqual([])
    expect(transcript.sessionItems).toEqual([])
  })

  it('normalizes generated input identifiers without rewriting ordinary text', () => {
    expect(normalizeTranscriptValue({
      inputId: 'in_abc12345',
      itemId: 'item_in_abc12345',
      questions: [{ id: 'in_abc12345_1' }],
      text: 'Keep the literal in_abc12345 in this message.'
    })).toEqual({
      inputId: '<input_1>',
      itemId: '<item_input_1>',
      questions: [{ id: '<input_1>_1' }],
      text: 'Keep the literal in_abc12345 in this message.'
    })
  })
})

function terminalEvents(events: Array<{ kind: string }>): Array<{ kind: string }> {
  return events.filter((event) =>
    event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_aborted'
  )
}

function waitForAbort(request: ModelRequest): Promise<void> {
  return new Promise((resolve) => {
    if (request.abortSignal.aborted) {
      resolve()
      return
    }
    request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
  })
}
