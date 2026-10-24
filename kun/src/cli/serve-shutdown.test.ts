import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServeShutdownHandler, type ServeShutdownReason } from './serve-shutdown.js'

const identity = { flavor: 'production', instanceId: 'runtime-a', pid: 42 }
const reasons: ServeShutdownReason[] = [
  { code: 'manager_runtime_ownership_lost', source: 'heartbeat_rejected', managerInstanceId: 'manager-a' },
  { code: 'process_signal', signal: 'SIGTERM' },
  { code: 'process_signal', signal: 'SIGINT' },
  { code: 'runtime_shutdown_requested' },
  { code: 'client_owner_disconnected' },
  { code: 'client_owner_stop_requested' }
]
afterEach(() => vi.useRealTimers())

describe('serve shutdown reason logging', () => {
  it.each(reasons)('records $code before cleanup and on completion', async (reason) => {
    const log = vi.fn()
    const close = vi.fn(async () => {
      expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('shutdown requested'))
    })
    const shutdown = createServeShutdownHandler({ identity, close, log, timeoutMs: 10_000 })
    shutdown.request(reason)
    await shutdown.completed
    expect(close).toHaveBeenCalledOnce()
    for (const [line] of log.mock.calls) {
      expect(line).toContain(`"code":"${reason.code}"`)
      expect(line).toContain('"instanceId":"runtime-a"')
      expect(line).toContain('"pid":42')
    }
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('shutdown completed'))
  })

  it('keeps the first cause when ownership loss races with a host stop', async () => {
    const log = vi.fn(), close = vi.fn(async () => undefined)
    const shutdown = createServeShutdownHandler({ identity, close, log, timeoutMs: 10_000 })
    shutdown.request(reasons[0]!)
    shutdown.request({ code: 'client_owner_stop_requested' })
    await shutdown.completed
    expect(close).toHaveBeenCalledOnce()
    expect(log.mock.calls.flat().join('\n')).not.toContain('client_owner_stop_requested')
  })

  it('retains the initiating cause when cleanup exceeds its deadline', async () => {
    vi.useFakeTimers()
    const log = vi.fn(), close = vi.fn(() => new Promise<void>(() => undefined))
    const shutdown = createServeShutdownHandler({ identity, close, log, timeoutMs: 10_000 })
    shutdown.request(reasons[0]!)
    await vi.advanceTimersByTimeAsync(10_000)
    await shutdown.completed
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('forcing process exit'))
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('"code":"manager_runtime_ownership_lost"'))
  })

  it('logs a cleanup failure without losing the original stop reason', async () => {
    const log = vi.fn(), close = vi.fn(async () => { throw new Error('store flush failed') })
    const shutdown = createServeShutdownHandler({ identity, close, log, timeoutMs: 10_000 })
    shutdown.request({ code: 'runtime_shutdown_requested' })
    await shutdown.completed
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('shutdown cleanup failed'))
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('runtime_shutdown_requested'))
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('store flush failed'))
  })
})
