import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Jimp } from 'jimp'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createReadLocalTool } from '../adapters/tool/builtin-read-tool.js'
import { makeToolResultItem } from '../domain/item.js'
import type { TurnItem } from '../contracts/items.js'
import type { ToolHost, ToolHostContext, ToolHostResult } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'
import type { TurnService } from '../services/turn-service.js'
import { InflightTracker } from './inflight-tracker.js'
import { ToolCancellationRegistry } from './tool-cancellation-registry.js'
import { TOOL_ABORT_OUTCOME_UNKNOWN_CODE, ToolExecutionService } from './tool-execution-service.js'
import { InMemoryArtifactStore, type ArtifactStore } from '../artifacts/artifact-store.js'
import { extractToolResultImages, rehydrateTransientBrowserUseOutputsForForward, clearTransientBrowserUseOutputsForTest } from './tool-result-image.js'
import { DEFAULT_IMAGE_MAX_BASE64_BYTES } from '../adapters/tool/builtin-tool-types.js'
import { projectCompatMessages } from '../adapters/model/compat-message-projector.js'

const call = {
  callId: 'call_1',
  toolName: 'read',
  arguments: {}
}

const context = {
  threadId: 'thread_1',
  turnId: 'turn_1',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  sandboxMode: 'workspace-write',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow' as const
} as ToolHostContext

function makeService(input: {
  execute?: ToolHost['execute']
  onPlanWritten?: () => Promise<void>
  awaitWorkspaceCheckpoint?: (requestId: string, signal: AbortSignal) => Promise<string | null>
  toolCancellation?: ToolCancellationRegistry
  receipts?: CanvasReceiptRegistry
  artifactStore?: ArtifactStore
  abortGraceMs?: number
} = {}) {
  const lifecycle: string[] = []
  const events: Array<Record<string, unknown>> = []
  const turns = {
    updateItem: vi.fn(async () => { lifecycle.push('update'); return null }),
    updateTurnMetadata: vi.fn(async () => { lifecycle.push('turn-metadata') }),
    applyItem: vi.fn(async () => { lifecycle.push('apply') }),
    publishTransientItem: vi.fn(async () => { lifecycle.push('transient') }),
    compactItemHistory: vi.fn(async () => { lifecycle.push('compact') })
  } as unknown as TurnService
  const service = new ToolExecutionService({
    toolHost: {
      id: 'test-host',
      listTools: async () => [],
      execute: input.execute ?? (async () => ({
        item: makeToolResultItem({
          id: 'item_call_1', threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1', toolName: 'read', output: {}
        }),
        approved: true
      }))
    } as ToolHost,
    inflight: new InflightTracker(),
    turns,
    events: {
      record: async (event: Record<string, unknown>) => { events.push(event) }
    } as unknown as RuntimeEventRecorder,
    nowIso: () => '2026-07-10T00:00:00.000Z',
    ...(input.awaitWorkspaceCheckpoint
      ? { awaitWorkspaceCheckpoint: input.awaitWorkspaceCheckpoint }
      : {}),
    ...(input.onPlanWritten ? { onPlanWritten: input.onPlanWritten } : {}),
    ...(input.toolCancellation ? { toolCancellation: input.toolCancellation } : {}),
    ...(input.receipts ? { receipts: input.receipts } : {}),
    ...(input.artifactStore ? { artifactStore: input.artifactStore } : {}),
    ...(input.abortGraceMs !== undefined ? { abortGraceMs: input.abortGraceMs } : {})
  })
  return { service, lifecycle, events, turns }
}

describe('ToolExecutionService', () => {
  it('forwards a genuine >1 MiB PNG through read, host, persistence and durable replay', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-persist-image-'))
    try {
      const image = new Jimp({ width: 600, height: 600 })
      let seed = 42
      for (let i = 0; i < image.bitmap.data.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          image.bitmap.data[i + channel] = seed >>> 24
        }
        image.bitmap.data[i + 3] = 255
      }
      const bytes = await image.getBuffer('image/png')
      expect((await Jimp.read(bytes)).width).toBe(600)
      const data = bytes.toString('base64')
      expect(Buffer.byteLength(data)).toBeGreaterThan(1024 * 1024)
      expect(Buffer.byteLength(data)).toBeLessThan(DEFAULT_IMAGE_MAX_BASE64_BYTES)
      await writeFile(join(workspace, 'noise.png'), bytes)
      const artifacts = new InMemoryArtifactStore()
      const put = vi.spyOn(artifacts, 'put')
      const readCall = { ...call, arguments: { path: 'noise.png' } }
      const host = new LocalToolHost({ tools: [createReadLocalTool()] })
      const result = await host.execute(readCall, { ...context, workspace, artifactStore: artifacts })
      expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
      const { service, turns } = makeService({ artifactStore: artifacts })
      await service.persistResult('thread_1', 'turn_1', readCall, result)
      const persisted = vi.mocked(turns.applyItem).mock.calls[0]?.[1]
      if (persisted?.kind !== 'tool_result') throw new Error('expected tool result')
      const replayed: TurnItem = JSON.parse(JSON.stringify(persisted))
      const toolCall: TurnItem = { ...persisted, kind: 'tool_call', role: 'assistant', arguments: readCall.arguments }
      expect(extractToolResultImages(persisted.output)).toEqual([
        { mimeType: 'image/png', dataBase64: data, width: 600, height: 600 }
      ])
      expect(put).not.toHaveBeenCalled()
      const projected = projectCompatMessages({
        threadId: 'thread_1', turnId: 'turn_1', model: 'vision', systemPrompt: '',
        prefix: [], history: [toolCall, replayed], tools: [], abortSignal: new AbortController().signal
      }, { thinkingMode: false, supportsImages: true })
      expect(JSON.stringify(projected)).toContain(`data:image/png;base64,${data}`)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it.each(['image', 'computer_screenshot'])('preserves >1 MiB %s vision bytes through persistence and replay projection', async (kind) => {
    const artifacts = new InMemoryArtifactStore()
    const put = vi.spyOn(artifacts, 'put')
    const { service, turns } = makeService({ artifactStore: artifacts })
    const data = 'A'.repeat(2 * 1024 * 1024)
    const item = makeToolResultItem({
      id: 'large_image', threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1', toolName: 'read',
      output: { kind, mime_type: 'image/png', data_base64: data }
    })
    await service.persistResult('thread_1', 'turn_1', call, { item, approved: true })
    const persisted = vi.mocked(turns.applyItem).mock.calls[0]?.[1]
    if (persisted?.kind !== 'tool_result') throw new Error('expected tool result')
    // Reparse the durable JSON shape, not the original host object.
    const replayed: TurnItem = JSON.parse(JSON.stringify(persisted))
    expect(extractToolResultImages(persisted.output)).toEqual([{ mimeType: 'image/png', dataBase64: data }])
    expect(put).not.toHaveBeenCalled()
    const toolCall: TurnItem = { ...persisted, kind: 'tool_call', role: 'assistant', arguments: {} }
    for (const supportsImages of [true, false]) {
      const projected = projectCompatMessages({
        threadId: 'thread_1', turnId: 'turn_1', model: 'vision', systemPrompt: '',
        prefix: [], history: [toolCall, replayed], tools: [], abortSignal: new AbortController().signal
      }, { thinkingMode: false, supportsImages })
      expect(JSON.stringify(projected).includes(`data:image/png;base64,${data}`)).toBe(supportsImages)
      if (!supportsImages) expect(JSON.stringify(projected)).not.toContain(data)
    }
  })

  it.each([false, true])('retains images when large metadata is externalized (storage failure=%s)', async (failure) => {
    const artifacts = new InMemoryArtifactStore()
    const put = vi.spyOn(artifacts, 'put')
    if (failure) put.mockRejectedValue(new Error('disk unavailable'))
    const { service, turns } = makeService({ artifactStore: artifacts })
    const data = 'A'.repeat(2 * 1024 * 1024)
    const item = makeToolResultItem({
      id: 'large_metadata_image', threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1', toolName: 'read',
      output: { kind: 'image', mime_type: 'image/png', data_base64: data, text: 'x'.repeat(2 * 1024 * 1024) }
    })
    await service.persistResult('thread_1', 'turn_1', call, { item, approved: true })
    const persisted = vi.mocked(turns.applyItem).mock.calls[0]?.[1]
    if (persisted?.kind !== 'tool_result') throw new Error('expected tool result')
    expect(extractToolResultImages(persisted.output)).toHaveLength(1)
    expect(put.mock.calls[0]?.[0].content).not.toContain(data)
    expect(persisted.output).toMatchObject(failure ? { artifactUnavailable: true } : { artifactId: expect.any(String) })
    const output = persisted.output as Record<string, unknown>
    expect(String(output.inline ?? output.preview)).not.toContain(data.slice(0, 80))
  })

  it('bounds browser images before transient caching and never persists their bytes', async () => {
    clearTransientBrowserUseOutputsForTest()
    try {
      const { service, turns } = makeService()
      const kept = 'A'.repeat(2 * 1024 * 1024)
      const omitted = 'B'.repeat(DEFAULT_IMAGE_MAX_BASE64_BYTES + 4)
      const item = makeToolResultItem({
        id: 'browser_large', threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1', toolName: 'browser_use',
        output: { kind: 'browser_screenshot', images: [
          { mime_type: 'image/png', data_base64: kept }, { mime_type: 'image/png', data_base64: omitted }
        ] }
      })
      await service.persistResult('thread_1', 'turn_1', { ...call, toolName: 'browser_use' }, { item, approved: true })
      const persisted = vi.mocked(turns.applyItem).mock.calls[0]?.[1]
      if (persisted?.kind !== 'tool_result') throw new Error('expected tool result')
      expect(JSON.stringify(persisted)).not.toContain(kept)
      expect(JSON.stringify(persisted)).not.toContain(omitted)
      const forwarded = rehydrateTransientBrowserUseOutputsForForward([persisted])[0]
      if (forwarded.kind !== 'tool_result') throw new Error('expected tool result')
      expect(extractToolResultImages(forwarded.output)).toEqual([{ mimeType: 'image/png', dataBase64: kept }])
    } finally { clearTransientBrowserUseOutputsForTest() }
  })

  it('externalizes oversized generic tool output before persisting the result', async () => {
    const artifacts = new InMemoryArtifactStore()
    const { service, turns } = makeService({ artifactStore: artifacts })
    const result: ToolHostResult = {
      item: makeToolResultItem({
        id: 'item_large',
        threadId: 'thread_1',
        turnId: 'turn_1',
        callId: 'call_1',
        toolName: 'read',
        output: { text: 'x'.repeat(1024 * 1024 + 1) }
      }),
      approved: true
    }

    await service.persistResult('thread_1', 'turn_1', call, result)

    const persisted = vi.mocked(turns.applyItem).mock.calls[0]?.[1]
    expect(persisted).toMatchObject({
      kind: 'tool_result',
      output: {
        artifactId: expect.stringMatching(/^art_/),
        truncated: true,
        byteSize: expect.any(Number)
      }
    })
    if (persisted?.kind !== 'tool_result' || !persisted.output || typeof persisted.output !== 'object') {
      throw new Error('expected artifact-backed tool result')
    }
    const artifactId = (persisted.output as Record<string, unknown>).artifactId as string
    expect(await artifacts.get(artifactId)).toContain('"text"')
  })

  it('persists only a bounded preview when artifact storage fails', async () => {
    const artifacts = {
      put: vi.fn(async () => { throw new Error('artifact disk unavailable') })
    } as unknown as ArtifactStore
    const { service, turns } = makeService({ artifactStore: artifacts })
    const result: ToolHostResult = {
      item: makeToolResultItem({
        id: 'item_large_failed',
        threadId: 'thread_1',
        turnId: 'turn_1',
        callId: 'call_1',
        toolName: 'read',
        output: { text: 'x'.repeat(1024 * 1024 + 1) }
      }),
      approved: true
    }

    await service.persistResult('thread_1', 'turn_1', call, result)

    const persisted = vi.mocked(turns.applyItem).mock.calls[0]?.[1]
    expect(persisted).toMatchObject({
      kind: 'tool_result',
      output: {
        artifactUnavailable: true,
        byteSize: expect.any(Number),
        reason: 'artifact disk unavailable'
      }
    })
    if (persisted?.kind !== 'tool_result') throw new Error('expected tool result')
    expect(JSON.stringify(persisted.output).length).toBeLessThan(20 * 1024)
  })

  it('normalizes advertised-tool rejection into a model-visible result', async () => {
    const { service, events } = makeService({
      execute: async () => { throw new Error('unknown tool: missing_tool') }
    })

    const result = await service.executeSafely({
      threadId: 'thread_1', turnId: 'turn_1', call: { ...call, toolName: 'missing_tool' }, context
    })

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: expect.objectContaining({ code: 'tool_dispatch_rejected' })
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'tool_dispatch_rejected' })
    ]))
  })

  it('turns an accepted tool cancellation into a paired model-visible error result', async () => {
    const registry = new ToolCancellationRegistry()
    let started!: () => void
    const toolStarted = new Promise<void>((resolve) => { started = resolve })
    const setup = makeService({
      toolCancellation: registry,
      execute: async (_call, executionContext) => {
        started()
        return await new Promise<never>((_resolve, reject) => {
          executionContext.abortSignal.addEventListener('abort', () => {
            reject(executionContext.abortSignal.reason)
          }, { once: true })
        })
      }
    })
    const parent = new AbortController()
    const execution = setup.service.executeSafely({
      threadId: 'thread_1',
      turnId: 'turn_1',
      call,
      context: { ...context, abortSignal: parent.signal }
    })
    await toolStarted
    expect(registry.request(
      { threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1' },
      '2026-08-07T00:00:00.000Z'
    )).toBe('cancellation_requested')
    const result = await execution
    expect(result).toMatchObject({ approved: false, item: { isError: true } })
    expect(result.item.kind === 'tool_result' ? result.item.output : null).toMatchObject({
      code: 'tool_cancelled_by_user',
      guidance: expect.stringContaining('Do not repeat the identical call automatically')
    })
    expect(registry.list()).toEqual([])
  })

  it('keeps the cancellation result when a tool catches abort and returns normally', async () => {
    const registry = new ToolCancellationRegistry()
    let started!: () => void
    const toolStarted = new Promise<void>((resolve) => { started = resolve })
    const setup = makeService({
      toolCancellation: registry,
      execute: async (toolCall, executionContext) => {
        started()
        await new Promise<void>((resolve) => {
          executionContext.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        return {
          item: makeToolResultItem({
            id: `item_${toolCall.callId}`,
            threadId: 'thread_1',
            turnId: 'turn_1',
            callId: toolCall.callId,
            toolName: toolCall.toolName,
            output: { stale: true }
          }),
          approved: true
        }
      }
    })
    const execution = setup.service.executeSafely({
      threadId: 'thread_1',
      turnId: 'turn_1',
      call,
      context: { ...context, abortSignal: new AbortController().signal }
    })
    await toolStarted
    expect(registry.request(
      { threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1' },
      '2026-08-07T00:00:00.000Z'
    )).toBe('cancellation_requested')
    const result = await execution
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(result.item.kind === 'tool_result' ? result.item.output : null).toMatchObject({
      code: 'tool_cancelled_by_user'
    })
  })

  it('settles an abort-ignoring tool as unknown after the bounded grace period', async () => {
    const registry = new ToolCancellationRegistry()
    let started!: () => void
    const toolStarted = new Promise<void>((resolve) => { started = resolve })
    const setup = makeService({
      toolCancellation: registry,
      abortGraceMs: 1,
      execute: async () => {
        started()
        return await new Promise<never>(() => undefined)
      }
    })
    const execution = setup.service.executeSafely({
      threadId: 'thread_1', turnId: 'turn_1', call,
      context: { ...context, abortSignal: new AbortController().signal }
    })
    await toolStarted
    expect(registry.request(
      { threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1' },
      '2026-08-30T00:00:00.000Z'
    )).toBe('cancellation_requested')

    const result = await execution
    expect(result.item.kind === 'tool_result' ? result.item.output : null).toMatchObject({
      code: TOOL_ABORT_OUTCOME_UNKNOWN_CODE,
      guidance: expect.stringContaining('Inspect state before retrying')
    })
    expect(registry.list()).toEqual([])
  })

  it('waits for a pending checkpoint before the first workspace mutation', async () => {
    const order: string[] = []
    const setup = makeService({
      awaitWorkspaceCheckpoint: async (requestId) => {
        order.push(`checkpoint:${requestId}`)
        return 'gcp_ready'
      },
      execute: async () => {
        order.push('execute')
        return {
          item: makeToolResultItem({
            id: 'item_call_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            callId: 'call_1',
            toolName: 'write',
            output: {}
          }),
          approved: true
        }
      }
    })

    await setup.service.executeSafely({
      threadId: 'thread_1',
      turnId: 'turn_1',
      call: { ...call, toolName: 'write', toolKind: 'file_change' },
      context: { ...context, workspaceCheckpointRequestId: 'gcp_pending' }
    })

    expect(order).toEqual(['checkpoint:gcp_pending', 'execute'])
    expect(setup.turns.updateTurnMetadata).toHaveBeenCalledWith(
      'thread_1',
      'turn_1',
      { workspaceCheckpointId: 'gcp_ready' }
    )
    expect(setup.turns.updateItem).toHaveBeenCalledWith(
      'thread_1',
      'item_turn_1_user',
      { workspaceCheckpointId: 'gcp_ready' }
    )
  })

  it('persists a successful plan result before notifying the plan callback', async () => {
    let lifecycle: string[] = []
    const setup = makeService({
      onPlanWritten: async () => { lifecycle.push('plan') }
    })
    lifecycle = setup.lifecycle
    const result: ToolHostResult = {
      item: makeToolResultItem({
        id: 'item_call_plan', threadId: 'thread_1', turnId: 'turn_1', callId: 'call_plan',
        toolName: 'create_plan', output: { plan_id: 'plan_1', relative_path: '.kun/plan.md' }
      }),
      approved: true
    }

    await setup.service.persistResult('thread_1', 'turn_1', {
      callId: 'call_plan',
      toolName: 'create_plan',
      arguments: { markdown: '# Plan' }
    }, result)

    expect(lifecycle).toEqual(['update', 'apply', 'plan', 'compact'])
  })

  it('registers a renderer receipt before publishing its accepted result', async () => {
    const register = vi.fn()
    const setup = makeService({
      receipts: { register } as unknown as CanvasReceiptRegistry
    })
    const result: ToolHostResult = {
      item: makeToolResultItem({
        id: 'item_call_design', threadId: 'thread_1', turnId: 'turn_1',
        callId: 'call_design', toolName: 'design_update_shapes',
        output: { status: 'accepted', receiptKey: 'design-receipt-order', ops: [] }
      }),
      approved: true
    }

    await setup.service.persistResult('thread_1', 'turn_1', {
      callId: 'call_design', toolName: 'design_update_shapes', arguments: {}
    }, result)

    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(setup.turns.applyItem).mock.invocationCallOrder[0]!)
  })

  it('persists storm suppression as a failed result and public event', async () => {
    const { service, lifecycle, events } = makeService()

    await service.persistSuppressed({
      threadId: 'thread_1', turnId: 'turn_1', call, reason: 'duplicate call'
    })

    expect(lifecycle).toEqual(['update', 'apply'])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_storm_suppressed', message: 'duplicate call' })
    ]))
  })

  it('drains in-flight progress and ignores updates after tool execution completes', async () => {
    let emitUpdate: ((item: TurnItem) => Promise<void> | void) | undefined
    const runningItem = makeToolResultItem({
      id: 'item_call_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: 'call_1',
      toolName: 'read',
      output: { partial: true },
      status: 'running'
    })
    const { service, lifecycle } = makeService({
      execute: async (_call, _context, onUpdate) => {
        emitUpdate = onUpdate
        void onUpdate?.(runningItem)
        return {
          item: makeToolResultItem({
            id: 'item_call_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            callId: 'call_1',
            toolName: 'read',
            output: { completed: true }
          }),
          approved: true
        }
      }
    })

    const result = await service.executeSafely({
      threadId: 'thread_1',
      turnId: 'turn_1',
      call,
      context
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', status: 'completed' })
    expect(lifecycle).toEqual(['update', 'update', 'apply', 'update'])
    const settledWrites = [...lifecycle]
    await emitUpdate?.(runningItem)
    expect(lifecycle).toEqual(settledWrites)
  })

  it('persists the first progress state and publishes only changed later snapshots transiently', async () => {
    const first = makeToolResultItem({
      id: 'item_call_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: 'call_1',
      toolName: 'read',
      output: { output: 'a', partial: true },
      status: 'running'
    })
    const second = makeToolResultItem({
      id: 'item_call_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: 'call_1',
      toolName: 'read',
      output: { output: 'ab', partial: true },
      status: 'running'
    })
    const setup = makeService({
      execute: async (_call, _context, onUpdate) => {
        await onUpdate?.(first)
        await onUpdate?.(first)
        await onUpdate?.(second)
        return {
          item: makeToolResultItem({
            id: first.id,
            threadId: first.threadId,
            turnId: first.turnId,
            callId: 'call_1',
            toolName: 'read',
            output: { output: 'ab', partial: false }
          }),
          approved: true
        }
      }
    })

    await setup.service.executeSafely({
      threadId: 'thread_1',
      turnId: 'turn_1',
      call,
      context
    })

    expect(vi.mocked(setup.turns.updateItem).mock.calls.filter(([, id]) => id === first.id)).toHaveLength(1)
    expect(setup.turns.applyItem).toHaveBeenCalledTimes(1)
    expect(setup.turns.publishTransientItem).toHaveBeenCalledTimes(1)
    expect(setup.lifecycle).toEqual(['update', 'update', 'apply', 'transient', 'update'])
  })

  it('advertises single-tool cancellation only after registration and clears it after disposal', async () => {
    const registry = new ToolCancellationRegistry()
    const setup = makeService({ toolCancellation: registry })
    const observed: boolean[] = []
    vi.mocked(setup.turns.updateItem).mockImplementation(async (threadId, _id, patch) => {
      const presentation = 'meta' in patch ? patch.meta?.toolPresentation as { canCancel?: boolean } | undefined : undefined
      if (presentation) {
        observed.push(presentation.canCancel === true)
        expect(registry.has({ threadId, turnId: 'turn_1', callId: 'call_1' })).toBe(presentation.canCancel)
      }
      return null
    })
    await setup.service.executeSafely({ threadId: 'thread_1', turnId: 'turn_1', call, context })
    expect(observed).toEqual([true, false])
    expect(registry.list()).toEqual([])
  })

  it('does not advertise foreground cancellation for detached execution', async () => {
    const registry = new ToolCancellationRegistry()
    const setup = makeService({ toolCancellation: registry })
    await setup.service.executeSafely({ threadId: 'thread_1', turnId: 'turn_1', call,
      context: { ...context, messageSource: 'background_subagent' } })
    expect(registry.list()).toEqual([])
    expect(setup.turns.updateItem).not.toHaveBeenCalled()
  })
})
