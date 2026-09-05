import { describe, expect, it, vi } from 'vitest'
import { makeToolResultItem } from '../domain/item.js'
import type { ToolCallLike, ToolHostContext, ToolHostResult } from '../ports/tool-host.js'
import type { ToolDispatchInput } from './turn-execution-types.js'
import { ToolCallDispatcher } from './tool-call-dispatcher.js'
import {
  FastContextSourceSemaphore,
  fastContextSourceToolSemaphoreSnapshot,
  withFastContextSourceToolSlot
} from './fast-context-source-semaphore.js'

const context = {
  threadId: 'thread_1',
  turnId: 'turn_1',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  sandboxMode: 'workspace-write',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow' as const
} as ToolHostContext

const call = (toolName: string, callId: string): ToolCallLike => ({ callId, toolName, arguments: {} })

function resultFor(call: ToolCallLike): ToolHostResult {
  return {
    item: makeToolResultItem({
      id: `item_${call.callId}`,
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: call.callId,
      toolName: call.toolName,
      output: { ok: true }
    }),
    approved: true
  }
}

function dispatchInput(calls: ToolCallLike[]): ToolDispatchInput {
  return {
    calls,
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/workspace',
    clientSurface: 'api',
    modelCapabilities: {
      id: 'model_1',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    },
    activeSkillIds: [],
    toolProviderKinds: new Map([
      ['read', 'built-in'],
      ['grep', 'built-in'],
      ['glob', 'built-in'],
      ['delegate_task', 'delegation']
    ]),
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    signal: new AbortController().signal
  }
}

describe('ToolCallDispatcher', () => {
  it('shares the source result budget across a parallel source batch', async () => {
    const observed: number[] = []
    const dispatcher = new ToolCallDispatcher({
      executeSafely: vi.fn(async (input: { call: ToolCallLike; context: ToolHostContext }) => {
        observed.push(input.context.sourceResultBudgetTokens ?? 0)
        return resultFor(input.call)
      }),
      persistResult: vi.fn(async () => undefined), persistSuppressed: vi.fn(async () => undefined)
    } as never)
    await dispatcher.dispatch({ dispatch: dispatchInput([call('read', 'a'), call('grep', 'b')]), context: { ...context, sourceResultBudgetTokens: 100 } })
    expect(observed).toEqual([50, 50])
  })

  it('shares one Fast Context result budget across sequential parallel batches', async () => {
    const observed: number[] = []
    const dispatcher = new ToolCallDispatcher({
      executeSafely: vi.fn(async (input: { call: ToolCallLike; context: ToolHostContext }) => {
        observed.push(input.context.sourceResultBudgetTokens ?? 0)
        return resultFor(input.call)
      }),
      persistResult: vi.fn(async () => undefined), persistSuppressed: vi.fn(async () => undefined)
    } as never)
    await dispatcher.dispatch({
      dispatch: dispatchInput(Array.from({ length: 8 }, (_, index) => call('read', `read_${index}`))),
      context: { ...context, fastContext: true, sourceResultBudgetTokens: 80 }
    })

    expect(observed).toEqual(Array.from({ length: 8 }, () => 10))
  })

  it('fans out a read-only batch but persists results in model order', async () => {
    const started: string[] = []
    const persisted: string[] = []
    const executed: string[] = []
    const toolExecution = {
      executeSafely: vi.fn(async (input: { call: ToolCallLike }) => {
        started.push(input.call.callId)
        return resultFor(input.call)
      }),
      persistResult: vi.fn(async (_threadId: string, _turnId: string, entry: ToolCallLike) => {
        persisted.push(entry.callId)
      }),
      persistSuppressed: vi.fn(async () => undefined)
    }
    const dispatcher = new ToolCallDispatcher(toolExecution as never)
    const calls = [call('read', 'read_1'), call('grep', 'grep_1')]

    await expect(dispatcher.dispatch({
      dispatch: dispatchInput(calls),
      context,
      onToolExecuted: (toolName) => { executed.push(toolName) }
    })).resolves.toBe('continue')

    expect(started).toEqual(['read_1', 'grep_1'])
    expect(persisted).toEqual(['read_1', 'grep_1'])
    expect(executed).toEqual(['read', 'grep'])
  })

  it('reports execution only after the result is durably persisted', async () => {
    const onToolExecuted = vi.fn()
    const dispatcher = new ToolCallDispatcher({
      executeSafely: vi.fn(async (input: { call: ToolCallLike }) => resultFor(input.call)),
      persistResult: vi.fn(async () => { throw new Error('item log unavailable') }),
      persistSuppressed: vi.fn(async () => undefined)
    } as never)

    await expect(dispatcher.dispatch({
      dispatch: dispatchInput([call('write', 'write_1')]), context, onToolExecuted
    })).rejects.toThrow('item log unavailable')
    expect(onToolExecuted).not.toHaveBeenCalled()
  })

  it('continues a parallel batch when one result is a tool-level cancellation', async () => {
    const persisted: Array<{ callId: string; isError?: boolean }> = []
    const dispatcher = new ToolCallDispatcher({
      executeSafely: vi.fn(async (input: { call: ToolCallLike }) => {
        if (input.call.callId === 'read_1') {
          return {
            item: makeToolResultItem({
              id: 'item_read_1',
              threadId: 'thread_1',
              turnId: 'turn_1',
              callId: 'read_1',
              toolName: input.call.toolName,
              output: { code: 'tool_cancelled_by_user' },
              isError: true
            }),
            approved: false
          }
        }
        return resultFor(input.call)
      }),
      persistResult: vi.fn(async (_threadId: string, _turnId: string, entry: ToolCallLike, result: ToolHostResult) => {
        persisted.push({
          callId: entry.callId,
          isError: result.item.kind === 'tool_result' ? result.item.isError : undefined
        })
      }),
      persistSuppressed: vi.fn(async () => undefined)
    } as never)

    await expect(dispatcher.dispatch({
      dispatch: dispatchInput([call('read', 'read_1'), call('grep', 'grep_1')]),
      context
    })).resolves.toBe('continue')
    expect(persisted).toEqual([
      { callId: 'read_1', isError: true },
      { callId: 'grep_1', isError: false }
    ])
  })

  it('reports all-suppressed only when no call executes', async () => {
    const persistSuppressed = vi.fn(async () => undefined)
    const dispatcher = new ToolCallDispatcher({
      executeSafely: vi.fn(),
      persistResult: vi.fn(),
      persistSuppressed
    } as never)
    const calls = [call('read', 'read_1'), call('grep', 'grep_1')]

    await expect(dispatcher.dispatch({
      dispatch: dispatchInput(calls),
      context,
      stormBreaker: { inspect: () => ({ suppress: true, reason: 'duplicate' }) } as never
    })).resolves.toBe('all_suppressed')

    expect(persistSuppressed).toHaveBeenCalledTimes(2)
  })

  it('shares four source slots across concurrent Fast Context dispatchers', async () => {
    let active = 0
    let maximum = 0
    let resolveFirstFour: () => void = () => undefined
    const firstFour = new Promise<void>((resolve) => { resolveFirstFour = resolve })
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const toolExecution = {
      executeSafely: async (input: { call: ToolCallLike }) => {
        active += 1
        maximum = Math.max(maximum, active)
        if (active === 4) resolveFirstFour()
        try {
          await held
          return resultFor(input.call)
        } finally {
          active -= 1
        }
      },
      persistResult: async () => undefined,
      persistSuppressed: async () => undefined
    }
    const dispatcher = new ToolCallDispatcher(toolExecution as never)
    const fastContext = { ...context, fastContext: true, fastContextScopeId: 'parent_a' }
    const first = dispatcher.dispatch({
      dispatch: dispatchInput(Array.from({ length: 8 }, (_, index) => call('read', `first_${index}`))), context: fastContext
    })
    const second = dispatcher.dispatch({
      dispatch: dispatchInput(Array.from({ length: 8 }, (_, index) => call('grep', `second_${index}`))), context: fastContext
    })

    await firstFour
    expect(maximum).toBe(4)
    expect(fastContextSourceToolSemaphoreSnapshot('parent_a')).toMatchObject({ active: 4, capacity: 4 })
    release()
    await expect(Promise.all([first, second])).resolves.toEqual(['continue', 'continue'])
    expect(fastContextSourceToolSemaphoreSnapshot('parent_a')).toMatchObject({
      active: 0, waiting: 0, exists: false
    })
  })

  it('gives different parent sessions independent four-slot source budgets', async () => {
    let active = 0
    let maximum = 0
    let resolveEight: () => void = () => undefined
    const eightStarted = new Promise<void>((resolve) => { resolveEight = resolve })
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const toolExecution = {
      executeSafely: async (input: { call: ToolCallLike }) => {
        active += 1
        maximum = Math.max(maximum, active)
        if (active === 8) resolveEight()
        try {
          await held
          return resultFor(input.call)
        } finally {
          active -= 1
        }
      },
      persistResult: async () => undefined,
      persistSuppressed: async () => undefined
    }
    const dispatcher = new ToolCallDispatcher(toolExecution as never)
    const callsA = Array.from({ length: 4 }, (_, index) => call('read', `a_${index}`))
    const callsB = Array.from({ length: 4 }, (_, index) => call('grep', `b_${index}`))
    const first = dispatcher.dispatch({
      dispatch: dispatchInput(callsA),
      context: { ...context, threadId: 'child_a', fastContext: true, fastContextScopeId: 'parent_a' }
    })
    const second = dispatcher.dispatch({
      dispatch: dispatchInput(callsB),
      context: { ...context, threadId: 'child_b', fastContext: true, fastContextScopeId: 'parent_b' }
    })

    await eightStarted
    expect(maximum).toBe(8)
    expect(fastContextSourceToolSemaphoreSnapshot('parent_a')).toMatchObject({ active: 4, waiting: 0 })
    expect(fastContextSourceToolSemaphoreSnapshot('parent_b')).toMatchObject({ active: 4, waiting: 0 })
    release()
    await expect(Promise.all([first, second])).resolves.toEqual(['continue', 'continue'])
    expect(fastContextSourceToolSemaphoreSnapshot('parent_a')).toMatchObject({
      active: 0, waiting: 0, exists: false
    })
    expect(fastContextSourceToolSemaphoreSnapshot('parent_b')).toMatchObject({
      active: 0, waiting: 0, exists: false
    })
  })

  it('removes a newly created source scope when its signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(withFastContextSourceToolSlot({
      context: {
        ...context,
        threadId: 'aborted_child',
        fastContext: true,
        fastContextScopeId: 'aborted_parent',
        abortSignal: controller.signal
      },
      toolName: 'read',
      work: async () => resultFor(call('read', 'never'))
    })).rejects.toThrow('aborted while queued')
    expect(fastContextSourceToolSemaphoreSnapshot('aborted_parent')).toMatchObject({
      active: 0,
      waiting: 0,
      exists: false
    })
  })

  it('releases Fast Context source permits after errors and queued cancellation', async () => {
    const semaphore = new FastContextSourceSemaphore(1)
    await expect(semaphore.run(new AbortController().signal, async () => {
      throw new Error('source failure')
    })).rejects.toThrow('source failure')
    expect(semaphore.snapshot()).toEqual({ active: 0, waiting: 0, capacity: 1 })

    const holder = new AbortController()
    const release = await semaphore.acquire(holder.signal)
    const queued = new AbortController()
    const waiting = semaphore.acquire(queued.signal)
    queued.abort()
    await expect(waiting).rejects.toThrow('aborted while queued')
    release()
    await expect(semaphore.run(new AbortController().signal, async () => 'released')).resolves.toBe('released')
    expect(semaphore.snapshot()).toEqual({ active: 0, waiting: 0, capacity: 1 })
  })
})
