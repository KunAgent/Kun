import { describe, expect, it, vi } from 'vitest'
import { makeToolResultItem } from '../domain/item.js'
import type { ToolCallLike, ToolHostResult, ToolProviderKind } from '../ports/tool-host.js'
import { dispatchToolCalls, type ToolCallDispatchDependencies } from './tool-call-dispatcher.js'

function call(toolName: string, index: number): ToolCallLike {
  return {
    callId: `call_${index}`,
    toolName,
    toolKind: 'tool_call',
    arguments: { index }
  }
}

function toolResult(toolCall: ToolCallLike): ToolHostResult {
  return {
    item: makeToolResultItem({
      id: `result_${toolCall.callId}`,
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      toolKind: toolCall.toolKind ?? 'tool_call',
      output: { ok: true }
    }),
    approved: false
  }
}

function providers(entries: Array<[string, ToolProviderKind]>): Map<string, ToolProviderKind> {
  return new Map(entries)
}

function dependencies(options: {
  suppressed?: ReadonlySet<string>
  delayMs?: number
} = {}): ToolCallDispatchDependencies & {
  persisted: string[]
  suppressed: string[]
  progress: string[]
  maxActive: () => number
} {
  const persisted: string[] = []
  const suppressed: string[] = []
  const progress: string[] = []
  let active = 0
  let maxActive = 0
  return {
    persisted,
    suppressed,
    progress,
    maxActive: () => maxActive,
    inspectStorm: (toolCall) => options.suppressed?.has(toolCall.callId)
      ? { suppress: true, reason: 'repeat' }
      : { suppress: false },
    execute: async (toolCall) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 1))
      active -= 1
      return toolResult(toolCall)
    },
    persistResult: async (toolCall) => {
      persisted.push(toolCall.callId)
    },
    persistSuppressed: async (toolCall) => {
      suppressed.push(toolCall.callId)
    },
    markProgress: (toolName) => {
      progress.push(toolName)
    }
  }
}

describe('dispatchToolCalls', () => {
  it('caps built-in read-only batches at three and persists in model order', async () => {
    const calls = Array.from({ length: 7 }, (_, index) => call('read', index))
    const deps = dependencies()

    await expect(dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in']]),
      signal: new AbortController().signal
    }, deps)).resolves.toBe('continue')

    expect(deps.maxActive()).toBe(3)
    expect(deps.persisted).toEqual(calls.map((entry) => entry.callId))
    expect(deps.progress).toHaveLength(calls.length)
  })

  it('fans out isolated delegation calls through the runtime concurrency gate', async () => {
    const calls = Array.from({ length: 5 }, (_, index) => call('delegate_task', index))
    const deps = dependencies()

    await dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['delegate_task', 'delegation']]),
      signal: new AbortController().signal
    }, deps)

    expect(deps.maxActive()).toBe(5)
    expect(deps.persisted).toEqual(calls.map((entry) => entry.callId))
  })

  it('keeps approval-gated and mutating calls sequential', async () => {
    const calls = [call('read', 0), call('write', 1), call('read', 2)]
    const deps = dependencies()

    await dispatchToolCalls({
      calls,
      approvalPolicy: 'always',
      toolProviderKinds: providers([['read', 'built-in'], ['write', 'built-in']]),
      signal: new AbortController().signal
    }, deps)

    expect(deps.maxActive()).toBe(1)
    expect(deps.persisted).toEqual(calls.map((entry) => entry.callId))
  })

  it('persists storm-suppressed calls without treating them as progress', async () => {
    const calls = [call('read', 0), call('read', 1)]
    const deps = dependencies({ suppressed: new Set(calls.map((entry) => entry.callId)) })

    await expect(dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in']]),
      signal: new AbortController().signal
    }, deps)).resolves.toBe('all_suppressed')

    expect(deps.persisted).toEqual([])
    expect(deps.suppressed).toEqual(calls.map((entry) => entry.callId))
    expect(deps.progress).toEqual([])
  })

  it('does not execute after the turn is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = dependencies()
    deps.execute = vi.fn(deps.execute)

    await expect(dispatchToolCalls({
      calls: [call('read', 0)],
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in']]),
      signal: controller.signal
    }, deps)).resolves.toBe('aborted')
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('splits read and delegation calls into homogeneous batches', async () => {
    const calls = [
      call('read', 0),
      call('delegate_task', 1),
      call('delegate_task', 2),
      call('read', 3)
    ]
    const deps = dependencies()

    await dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in'], ['delegate_task', 'delegation']]),
      signal: new AbortController().signal
    }, deps)

    expect(deps.maxActive()).toBe(2)
    expect(deps.persisted).toEqual(calls.map((entry) => entry.callId))
  })

  it('continues after a storm-suppressed call at a batch boundary', async () => {
    const calls = [call('read', 0), call('read', 1), call('write', 2)]
    const deps = dependencies({ suppressed: new Set(['call_1']) })

    await dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in'], ['write', 'built-in']]),
      signal: new AbortController().signal
    }, deps)

    expect(deps.persisted).toEqual(['call_0', 'call_2'])
    expect(deps.suppressed).toEqual(['call_1'])
  })

  it('persists parallel results in model order regardless of completion order', async () => {
    const calls = [call('read', 0), call('read', 1), call('read', 2)]
    const deps = dependencies()
    deps.execute = async (toolCall) => {
      const index = Number(toolCall.arguments.index)
      await new Promise((resolve) => setTimeout(resolve, (3 - index) * 2))
      return toolResult(toolCall)
    }

    await dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in']]),
      signal: new AbortController().signal
    }, deps)

    expect(deps.persisted).toEqual(calls.map((entry) => entry.callId))
  })

  it('does not start a second batch after the turn aborts', async () => {
    const controller = new AbortController()
    const calls = Array.from({ length: 4 }, (_, index) => call('read', index))
    const deps = dependencies()
    const started: string[] = []
    deps.execute = async (toolCall) => {
      started.push(toolCall.callId)
      if (started.length === 3) controller.abort()
      return toolResult(toolCall)
    }

    await expect(dispatchToolCalls({
      calls,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in']]),
      signal: controller.signal
    }, deps)).resolves.toBe('aborted')

    expect(started).toEqual(['call_0', 'call_1', 'call_2'])
    expect(deps.persisted).toEqual(['call_0', 'call_1', 'call_2'])
  })

  it('does not parallelize provider tools or file-changing calls by name alone', async () => {
    const providerRead = [call('read', 0), call('read', 1)]
    const providerDeps = dependencies()
    await dispatchToolCalls({
      calls: providerRead,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'mcp']]),
      signal: new AbortController().signal
    }, providerDeps)
    expect(providerDeps.maxActive()).toBe(1)

    const changingRead = providerRead.map((entry) => ({ ...entry, toolKind: 'file_change' as const }))
    const changingDeps = dependencies()
    await dispatchToolCalls({
      calls: changingRead,
      approvalPolicy: 'on-request',
      toolProviderKinds: providers([['read', 'built-in']]),
      signal: new AbortController().signal
    }, changingDeps)
    expect(changingDeps.maxActive()).toBe(1)
  })
})
