import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import {
  RuntimeStartupOwnershipLostError,
  startRuntimeStartupManagerHeartbeat
} from './runtime-startup-manager-heartbeat.js'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const registration: RuntimeRegistration = {
  flavor: 'production',
  instanceId: 'runtime-starting',
  pid: 42,
  startedAt: '2026-09-02T00:00:00.000Z',
  host: '127.0.0.1',
  port: 18899,
  baseUrl: 'http://127.0.0.1:18899',
  runtimeToken: 'runtime-token'
}

const manager: ServiceManagerConnection = {
  discovery: {
    version: 1,
    protocolVersion: 5,
    instanceId: 'manager',
    pid: 41,
    startedAt: '2026-09-02T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18787,
    baseUrl: 'http://127.0.0.1:18787',
    managerToken: 'manager-token',
    serviceVersion: '0.1.0',
    dataDir: '/tmp/kun-heartbeat-test',
    settingsPath: '/tmp/kun-heartbeat-test/settings.json'
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Runtime startup Manager heartbeat', () => {
  it('keeps only one heartbeat request in flight and revalidates before handoff', async () => {
    vi.useFakeTimers()
    const first = deferred<boolean>()
    const heartbeat = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(true)
    const register = vi.fn(async () => registration)
    const bridge = startRuntimeStartupManagerHeartbeat({
      manager,
      registration,
      intervalMs: 10,
      heartbeat,
      register
    })

    await vi.advanceTimersByTimeAsync(30)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    first.resolve(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(heartbeat).toHaveBeenCalledTimes(2)

    await bridge.revalidate()
    expect(heartbeat).toHaveBeenCalledTimes(3)
    expect(register).toHaveBeenCalledOnce()
    await bridge.stop()
    await vi.advanceTimersByTimeAsync(30)
    expect(heartbeat).toHaveBeenCalledTimes(3)
  })

  it('fails closed when any startup heartbeat loses the registered slot', async () => {
    vi.useFakeTimers()
    const heartbeat = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const register = vi.fn(async () => registration)
    const bridge = startRuntimeStartupManagerHeartbeat({
      manager,
      registration,
      intervalMs: 10,
      heartbeat,
      register
    })

    await vi.advanceTimersByTimeAsync(10)
    await expect(bridge.revalidate()).rejects.toBeInstanceOf(
      RuntimeStartupOwnershipLostError
    )
    expect(register).not.toHaveBeenCalled()
    await bridge.stop()
  })
})
