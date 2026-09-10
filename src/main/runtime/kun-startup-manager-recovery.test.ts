import { describe, expect, it, vi } from 'vitest'
import { recoverManager } from './kun-startup-manager-recovery'
import { ServiceManagerUnavailableError } from '../../../kun/src/manager/manager-resolution-error.js'
import { KUN_MANAGER_PROTOCOL_VERSION } from '../../../kun/src/manager/manager-discovery.js'

vi.mock('./kun-handoff-logging', () => ({ logKunHandoffEvent: vi.fn() }))
const input = { flavor: 'production' as const, controlDir: '/tmp/control', dataDir: '/tmp/data', settingsPath: '/tmp/settings' }
const connection = { discovery: {
  version: 1 as const, protocolVersion: KUN_MANAGER_PROTOCOL_VERSION, pid: 999, instanceId: 'manager',
  startedAt: new Date().toISOString(), host: '127.0.0.1', port: 12345, baseUrl: 'http://127.0.0.1:12345',
  managerToken: 'secret', serviceVersion: 'test', dataDir: input.dataDir, settingsPath: input.settingsPath
} }
function harness() {
  const order: string[] = []
  const deps = {
    read: vi.fn(async () => connection.discovery),
    lock: async <T>(_path: string, action: () => Promise<T>): Promise<T> => {
      order.push('lock')
      try { return await action() } finally { order.push('unlock') }
    },
    inspect: vi.fn(async () => ({ state: 'unavailable' as const, error: new ServiceManagerUnavailableError('http_failure', 999) })),
    drain: vi.fn(async () => { order.push('drain'); return { reason: 'startup-retry' as const, owners: [], elapsedMs: 1 } }),
    ensure: vi.fn(async () => { order.push('ensure'); return connection })
  }
  return { deps, order }
}
describe('startup Manager recovery', () => {
  it('holds one lock through handoff and bootstrap', async () => {
    const { deps, order } = harness()
    expect(await recoverManager(input, false, deps)).toBe(connection)
    expect(order).toEqual(['lock', 'drain', 'ensure', 'unlock'])
    expect(deps.drain).toHaveBeenCalledWith(expect.objectContaining({ reason: 'startup-retry', dataDirs: [input.dataDir] }))
  })
  it('does not bootstrap when ownership cannot be verified', async () => {
    const { deps, order } = harness()
    deps.drain.mockRejectedValue(new Error('Runtime ownership cannot be verified'))
    await expect(recoverManager(input, false, deps)).rejects.toThrow('ownership cannot be verified')
    expect(deps.ensure).not.toHaveBeenCalled()
    expect(order).toEqual(['lock', 'unlock'])
  })
  it('propagates bootstrap failure instead of reporting successful repair', async () => {
    const { deps } = harness()
    deps.ensure.mockRejectedValue(new Error('bootstrap failed'))
    await expect(recoverManager(input, false, deps)).rejects.toThrow('bootstrap failed')
  })
  it('preserves a healthy replacement discovered after acquiring the lock', async () => {
    const { deps } = harness()
    const inspect = vi.fn(async () => ({ state: 'ready' as const, ...connection, health: {} as never }))
    expect(await recoverManager(input, false, { ...deps, inspect })).toEqual(connection)
    expect(deps.drain).not.toHaveBeenCalled()
    expect(deps.ensure).not.toHaveBeenCalled()
  })
  it('rejects a healthy Manager from a different scope', async () => {
    const { deps } = harness()
    const inspect = vi.fn(async () => ({ state: 'ready' as const,
      discovery: { ...connection.discovery, dataDir: '/other' }, health: {} as never }))
    await expect(recoverManager(input, false, { ...deps, inspect })).rejects.toThrow('scope')
    expect(deps.drain).not.toHaveBeenCalled()
  })
})
