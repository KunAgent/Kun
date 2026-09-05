import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MEMORY_PRESSURE_CRITICAL_RSS_BYTES,
  DEFAULT_MEMORY_PRESSURE_WARN_RSS_BYTES,
  startMemoryPressureMonitor,
  type MemoryPressureMonitorDeps
} from './memory-pressure-monitor.js'

function makeDeps(overrides: Partial<MemoryPressureMonitorDeps> = {}): MemoryPressureMonitorDeps {
  const compact = vi.fn().mockImplementation(async (input: { threadId: string }) => ({
    threadId: input.threadId,
    replacedTokens: input.threadId === 'thread-1' ? 100 : 0,
    summary: '',
    pinnedConstraints: []
  }))
  return {
    config: {
      enabled: true,
      pollIntervalMs: 10,
      warnRssBytes: 100,
      criticalRssBytes: 200,
      maxCompactionsPerSweep: 2
    },
    threadStore: {
      list: async () => [
        { id: 'thread-1', status: 'idle', relation: 'primary', updatedAt: '2026-08-10T00:00:00.000Z' },
        { id: 'thread-2', status: 'running', relation: 'primary', updatedAt: '2026-08-10T00:00:00.000Z' }
      ]
    } as unknown as MemoryPressureMonitorDeps['threadStore'],
    sessionStore: {
      resetMemory: vi.fn().mockResolvedValue(undefined)
    },
    turnService: {
      compact
    } as unknown as MemoryPressureMonitorDeps['turnService'],
    events: {
      record: vi.fn().mockResolvedValue(undefined)
    } as unknown as MemoryPressureMonitorDeps['events'],
    instanceId: 'instance-1',
    requestShutdown: vi.fn().mockResolvedValue(true),
    ...overrides
  }
}

describe('startMemoryPressureMonitor', () => {
  it('uses the 6 GiB warning and 10 GiB critical defaults', () => {
    expect(DEFAULT_MEMORY_PRESSURE_WARN_RSS_BYTES).toBe(6 * 1024 ** 3)
    expect(DEFAULT_MEMORY_PRESSURE_CRITICAL_RSS_BYTES).toBe(10 * 1024 ** 3)
  })

  it('compacts idle thread histories when RSS crosses the warning watermark', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 150 } as never)
    const deps = makeDeps()
    const monitor = startMemoryPressureMonitor(deps)

    // Wait for the first poll tick.
    await new Promise((resolve) => setTimeout(resolve, 40))
    monitor.stop()

    expect(deps.turnService.compact).toHaveBeenCalled()
    // thread-2 is running and must be skipped.
    const compacted = (deps.turnService.compact as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].threadId)
    expect(compacted).toContain('thread-1')
    expect(compacted).not.toContain('thread-2')
    vi.restoreAllMocks()
  })

  it('requests a graceful shutdown when RSS crosses the critical watermark', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 250 } as never)
    const deps = makeDeps()
    const monitor = startMemoryPressureMonitor(deps)

    await new Promise((resolve) => setTimeout(resolve, 40))
    monitor.stop()

    expect(deps.requestShutdown).toHaveBeenCalledWith('instance-1')
    expect(deps.events.record).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-2',
      code: 'memory_pressure_critical',
      details: expect.objectContaining({
        event: 'runtime_shutdown',
        reason: 'memory_pressure',
        rssMiB: 0,
        affectedThreadIds: ['thread-2']
      })
    }))
    vi.restoreAllMocks()
  })

  it('temporarily clamps all runtime admission and restores it after hysteresis clears', async () => {
    const memoryUsage = vi.spyOn(process, 'memoryUsage')
      .mockReturnValueOnce({ rss: 150 } as never)
      .mockReturnValue({ rss: 50 } as never)
    const setSubagentParallelLimit = vi.fn()
    const setAdmissionParallelLimit = vi.fn()
    const deps = makeDeps({ setSubagentParallelLimit, setAdmissionParallelLimit })
    const monitor = startMemoryPressureMonitor(deps)

    await new Promise((resolve) => setTimeout(resolve, 40))
    monitor.stop()

    expect(setSubagentParallelLimit).toHaveBeenCalledWith(2)
    expect(setSubagentParallelLimit).toHaveBeenCalledWith(undefined)
    expect(setAdmissionParallelLimit).toHaveBeenCalledWith(2)
    expect(setAdmissionParallelLimit).toHaveBeenCalledWith(undefined)
    memoryUsage.mockRestore()
  })

  it('derives safer defaults from a smaller host memory budget', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 700 * 1024 ** 2 } as never)
    const setAdmissionParallelLimit = vi.fn()
    const deps = makeDeps({
      config: { enabled: true, pollIntervalMs: 10, maxCompactionsPerSweep: 1 },
      totalMemoryBytes: () => 1024 ** 3,
      setAdmissionParallelLimit
    })
    const monitor = startMemoryPressureMonitor(deps)
    await new Promise((resolve) => setTimeout(resolve, 25))
    monitor.stop()

    expect(setAdmissionParallelLimit).toHaveBeenCalledWith(2)
    vi.restoreAllMocks()
  })

  it('reclaims a different bounded idle batch on each sustained warning poll', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 150 } as never)
    const deps = makeDeps({
      config: {
        enabled: true, pollIntervalMs: 10, warnRssBytes: 100,
        criticalRssBytes: 200, maxCompactionsPerSweep: 1
      },
      threadStore: {
        list: async () => [1, 2, 3].map((index) => ({
          id: `idle-${index}`, status: 'idle', relation: 'primary',
          updatedAt: `2026-08-0${index}T00:00:00.000Z`
        }))
      } as never
    })
    const monitor = startMemoryPressureMonitor(deps)
    await new Promise((resolve) => setTimeout(resolve, 45))
    monitor.stop()

    const compacted = (deps.turnService.compact as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0].threadId)
    expect(new Set(compacted)).toEqual(new Set(['idle-1', 'idle-2', 'idle-3']))
    vi.restoreAllMocks()
  })

  it('stops polling after stop()', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 150 } as never)
    const deps = makeDeps()
    const monitor = startMemoryPressureMonitor(deps)
    monitor.stop()
    const callsBefore = (deps.events.record as ReturnType<typeof vi.fn>).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect((deps.events.record as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    vi.restoreAllMocks()
  })
})
