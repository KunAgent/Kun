import { describe, expect, it, vi } from 'vitest'
import {
  shutdownGraphExecutionForHost,
  shutdownRuntimeExecutionForHost
} from './runtime-factory.js'

describe('runtime Graph shutdown ordering', () => {
  it('quiesces Graph workers before parking source turns and stopping Lead queues', async () => {
    const order: string[] = []
    let releaseWorkers!: () => void
    const workersStopped = new Promise<void>((resolve) => {
      releaseWorkers = resolve
    })
    const graphRuntime = {
      quiesceExecution: vi.fn(async () => {
        order.push('workers:begin')
        await workersStopped
        order.push('workers:done')
      }),
      stop: vi.fn(async () => {
        order.push('graph:stop')
      })
    }
    const turnService = {
      suspendActiveTurnsForShutdown: vi.fn(async () => {
        order.push('turns:suspend')
        return 1
      })
    }

    const shutdown = shutdownGraphExecutionForHost({
      graphRuntime,
      turnService
    })
    await vi.waitFor(() => {
      expect(order).toEqual(['workers:begin'])
    })
    expect(turnService.suspendActiveTurnsForShutdown).not.toHaveBeenCalled()
    expect(graphRuntime.stop).not.toHaveBeenCalled()

    releaseWorkers()
    await shutdown

    expect(order).toEqual([
      'workers:begin',
      'workers:done',
      'turns:suspend',
      'graph:stop'
    ])
  })

  it('waits for suspended runs before draining execution leases', async () => {
    const order: string[] = []
    let finishRun!: () => void
    const activeRun = new Promise<void>((resolve) => { finishRun = resolve })
    const shutdown = shutdownRuntimeExecutionForHost({
      prepare: () => { order.push('prepare') },
      graphRuntime: {
        quiesceExecution: vi.fn(async () => { order.push('graph:quiesce') }),
        stop: vi.fn(async () => { order.push('graph:stop') })
      },
      turnService: {
        suspendActiveTurnsForShutdown: vi.fn(async () => {
          order.push('turns:suspend')
          return 1
        })
      },
      activeRuntimeRuns: new Set([activeRun.then(() => { order.push('runs:settled') })]),
      shutdownLeases: vi.fn(async () => { order.push('leases:shutdown') })
    })

    await vi.waitFor(() => expect(order).toEqual([
      'prepare', 'graph:quiesce', 'turns:suspend', 'graph:stop'
    ]))
    finishRun()
    await shutdown

    expect(order).toEqual([
      'prepare',
      'graph:quiesce',
      'turns:suspend',
      'graph:stop',
      'runs:settled',
      'leases:shutdown'
    ])
  })

  it('still settles runs and drains leases when shutdown preparation fails', async () => {
    const order: string[] = []
    let finishRun!: () => void
    const activeRun = new Promise<void>((resolve) => { finishRun = resolve })
    const shutdownLeases = vi.fn(async () => { order.push('leases:shutdown') })

    const shutdown = shutdownRuntimeExecutionForHost({
      prepare: () => {
        order.push('prepare')
        throw new Error('prepare failed')
      },
      graphRuntime: {
        quiesceExecution: vi.fn(async () => { order.push('graph:quiesce') }),
        stop: vi.fn(async () => { order.push('graph:stop') })
      },
      turnService: {
        suspendActiveTurnsForShutdown: vi.fn(async () => {
          order.push('turns:suspend')
          return 1
        })
      },
      activeRuntimeRuns: new Set([activeRun.then(() => { order.push('runs:settled') })]),
      shutdownLeases
    })

    await vi.waitFor(() => expect(order).toEqual([
      'prepare', 'graph:quiesce', 'turns:suspend', 'graph:stop'
    ]))
    finishRun()
    await expect(shutdown).rejects.toThrow('prepare failed')

    expect(order).toEqual([
      'prepare',
      'graph:quiesce',
      'turns:suspend',
      'graph:stop',
      'runs:settled',
      'leases:shutdown'
    ])
    expect(shutdownLeases).toHaveBeenCalledOnce()
  })

  it('continues suspension, Graph stop, run settlement, and lease drain after quiesce fails', async () => {
    const order: string[] = []

    await expect(shutdownRuntimeExecutionForHost({
      prepare: () => { order.push('prepare') },
      graphRuntime: {
        quiesceExecution: vi.fn(async () => {
          order.push('graph:quiesce')
          throw new Error('quiesce failed')
        }),
        stop: vi.fn(async () => { order.push('graph:stop') })
      },
      turnService: {
        suspendActiveTurnsForShutdown: vi.fn(async () => {
          order.push('turns:suspend')
          return 1
        })
      },
      activeRuntimeRuns: new Set(),
      shutdownLeases: vi.fn(async () => { order.push('leases:shutdown') })
    })).rejects.toThrow('quiesce failed')

    expect(order).toEqual([
      'prepare',
      'graph:quiesce',
      'turns:suspend',
      'graph:stop',
      'leases:shutdown'
    ])
  })
})
