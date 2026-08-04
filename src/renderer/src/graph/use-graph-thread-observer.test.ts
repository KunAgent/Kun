import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEventSink } from '../agent/types'
import { useGraphStore } from './graph-store'
import { useGraphThreadObserver } from './use-graph-thread-observer'

const provider = vi.hoisted(() => ({
  subscribeThreadEvents: vi.fn()
}))

const client = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listDrafts: vi.fn(),
  delegationDiagnostics: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: () => provider
}))

vi.mock('./graph-runtime-client', () => ({
  graphRuntimeClient: client
}))

function Harness({
  threadId,
  active
}: {
  threadId: string | null
  active: boolean
}): null {
  useGraphThreadObserver(threadId, active)
  return null
}

function run(id: string, seq: number, status: 'running' | 'completed' = 'running') {
  return {
    version: 1 as const,
    id,
    projectId: 'project_1',
    threadId: 'thread_1',
    sourceTurnId: 'turn_1',
    status,
    currentRevision: 1,
    plans: [],
    nodes: {
      node_1: {
        node: {
          id: 'node_1',
          phaseId: 'phase_1',
          kind: 'work' as const,
          title: 'Work',
          objective: 'Do work',
          priority: 1,
          required: true,
          riskClass: 'low' as const,
          readScopes: [],
          writeScopes: []
        },
        status: status === 'completed' ? 'accepted' as const : 'running' as const,
        attempts: [],
        loopIteration: 0
      }
    },
    reviews: [],
    messages: [],
    artifacts: [],
    cleanup: [],
    steering: [],
    budget: {
      limits: { maxWallTimeMs: 60_000, maxAttemptsPerNode: 3 },
      attempts: 0,
      revisions: 0,
      loopIterations: 0,
      elapsedMs: 0,
      totalTokens: 0,
      messages: 0,
      artifactBytes: 0,
      warningKinds: [],
      closed: false
    },
    lastEventSeq: seq,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

describe('useGraphThreadObserver', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useGraphStore.setState({
      threadId: null,
      runs: [],
      drafts: [],
      childRuns: {},
      syncStatus: 'idle',
      threadEventSeq: 0,
      loading: false,
      error: null
    })
    client.listDrafts.mockResolvedValue([])
    client.delegationDiagnostics.mockResolvedValue({
      enabled: true,
      active: 0,
      childRuns: []
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps observing after Lead settles (chat busy=false) and projects later Graph status', async () => {
    client.listRuns.mockResolvedValue([run('run_1', 2)])
    provider.subscribeThreadEvents.mockImplementation(
      async (
        _threadId: string,
        _seq: number,
        sink: ThreadEventSink,
        signal: AbortSignal
      ) => {
        sink.onConnected?.()
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    )

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { threadId: 'thread_1', active: true }))
    })

    await act(async () => {
      await useGraphStore.getState().refreshThread('thread_1')
    })
    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(2)
    expect(useGraphStore.getState().syncStatus).toBe('live')

    client.listRuns.mockResolvedValue([run('run_1', 6)])
    const sink = provider.subscribeThreadEvents.mock.calls[0]![2] as ThreadEventSink
    await act(async () => {
      sink.onGraphEvent?.({
        version: 1,
        eventId: 'event_6',
        runId: 'run_1',
        threadId: 'thread_1',
        graphSeq: 6,
        graphRevision: 1,
        timestamp: '2026-07-26T00:00:06.000Z',
        event: { type: 'node_status_changed', payload: {} }
      })
    })

    await vi.waitFor(() => {
      expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(6)
    })

    await act(async () => renderer!.unmount())
  })

  it('aborts the previous thread observer when the Graph panel switches threads', async () => {
    const signals: AbortSignal[] = []
    provider.subscribeThreadEvents.mockImplementation(
      (_threadId: string, _seq: number, _sink: ThreadEventSink, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    )

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { threadId: 'thread_a', active: true }))
    })
    await vi.waitFor(() => expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(1))

    await act(async () => {
      renderer!.update(createElement(Harness, { threadId: 'thread_b', active: true }))
    })
    await vi.waitFor(() => expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(2))
    expect(signals[0]?.aborted).toBe(true)
    expect(provider.subscribeThreadEvents.mock.calls[1]?.[0]).toBe('thread_b')

    await act(async () => renderer!.unmount())
  })

  it('resets the SSE cursor to 0 on thread switch and ignores late owner callbacks', async () => {
    useGraphStore.setState({
      threadId: 'thread_a',
      threadEventSeq: 100,
      runs: [run('run_a', 100)],
      syncStatus: 'live'
    })

    const sinks: ThreadEventSink[] = []
    provider.subscribeThreadEvents.mockImplementation(
      (_threadId: string, _seq: number, sink: ThreadEventSink, signal: AbortSignal) => {
        sinks.push(sink)
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    )

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { threadId: 'thread_a', active: true }))
    })
    await vi.waitFor(() => expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(1))
    // Same thread remount/bind must keep cursor (subscribe still sees 100).
    expect(provider.subscribeThreadEvents.mock.calls[0]?.[1]).toBe(100)

    await act(async () => {
      renderer!.update(createElement(Harness, { threadId: 'thread_b', active: true }))
    })
    await vi.waitFor(() => expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(2))

    // Critical: second subscribe must not reuse thread-A's cursor.
    expect(provider.subscribeThreadEvents.mock.calls[1]?.slice(0, 2)).toEqual([
      'thread_b',
      0
    ])
    expect(useGraphStore.getState().threadEventSeq).toBe(0)
    expect(useGraphStore.getState().runs).toEqual([])

    await act(async () => {
      sinks[1]!.onSeq(3)
      sinks[1]!.onConnected?.()
    })
    expect(useGraphStore.getState()).toMatchObject({
      threadId: 'thread_b',
      threadEventSeq: 3,
      syncStatus: 'live'
    })

    // Late callbacks from the aborted thread-A observer must not pollute B.
    await act(async () => {
      sinks[0]!.onSeq(250)
      sinks[0]!.onConnected?.()
      // startGraphThreadObserver sets reconnecting on error; ownership must drop it.
      sinks[0]!.onError(new Error('stale a'))
    })
    expect(useGraphStore.getState()).toMatchObject({
      threadId: 'thread_b',
      threadEventSeq: 3,
      syncStatus: 'live'
    })

    await act(async () => renderer!.unmount())
  })

  it('preserves cursor when the same thread is hidden and reopened', async () => {
    provider.subscribeThreadEvents.mockImplementation(
      (_threadId: string, _seq: number, sink: ThreadEventSink, signal: AbortSignal) => {
        sink.onSeq(7)
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    )

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { threadId: 'thread_1', active: true }))
    })
    await vi.waitFor(() => expect(useGraphStore.getState().threadEventSeq).toBe(7))

    await act(async () => {
      renderer!.update(createElement(Harness, { threadId: 'thread_1', active: false }))
    })
    expect(useGraphStore.getState().threadEventSeq).toBe(7)

    await act(async () => {
      renderer!.update(createElement(Harness, { threadId: 'thread_1', active: true }))
    })
    await vi.waitFor(() => expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(2))
    expect(provider.subscribeThreadEvents.mock.calls[1]?.[1]).toBe(7)

    await act(async () => renderer!.unmount())
  })

  it('does not clear durable Graph runs while reconnecting', async () => {
    useGraphStore.setState({
      threadId: 'thread_1',
      runs: [run('run_1', 3)],
      syncStatus: 'live'
    })
    provider.subscribeThreadEvents
      .mockImplementationOnce(async (_t, _s, sink: ThreadEventSink) => {
        sink.onConnected?.()
        sink.onError(new Error('socket dropped'))
      })
      .mockImplementation(
        (_threadId: string, _seq: number, _sink: ThreadEventSink, signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
      )

    vi.useFakeTimers()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, { threadId: 'thread_1', active: true }))
      await Promise.resolve()
    })

    expect(useGraphStore.getState().runs).toHaveLength(1)
    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(3)
    expect(useGraphStore.getState().syncStatus).toMatch(/reconnecting|connecting|live|stopped/)

    await act(async () => renderer!.unmount())
  })
})
