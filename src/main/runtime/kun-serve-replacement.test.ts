import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import type { RuntimeDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import type { ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'
import type { SharedRuntimeInspection } from '../../../kun/src/cli/shared-runtime.js'
import { stopSharedRuntimeForReplacement } from './kun-serve-replacement'

const dataDir = resolve('tmp', 'kun-replacement-data')
const runtimeExecutablePath = process.platform === 'win32'
  ? 'C:\\Program Files\\nodejs\\node.exe'
  : null

const manager: ServiceManagerConnection = {
  discovery: {
    version: 1,
    protocolVersion: 5,
    instanceId: 'manager-current',
    pid: 900,
    startedAt: '2026-08-13T00:00:00.000Z',
    host: '127.0.0.1',
    port: 43000,
    baseUrl: 'http://127.0.0.1:43000',
    managerToken: 'manager-token',
    serviceVersion: '0.1.0',
    dataDir,
    settingsPath: '/tmp/kun-settings.json'
  }
}

function inspection(overrides: Partial<RuntimeDiscoveryRecord> = {}): SharedRuntimeInspection {
  return {
    discovery: {
      version: 2,
      instanceId: 'production-old',
      pid: 101,
      startedAt: '2026-08-13T00:00:00.000Z',
      host: '127.0.0.1',
      port: 43001,
      baseUrl: 'http://127.0.0.1:43001',
      runtimeToken: 'runtime-token',
      insecure: false,
      serviceVersion: '0.1.0',
      flavor: 'production',
      buildId: 'a'.repeat(64),
      launchMode: 'shared',
      ...overrides
    },
    connection: null
  }
}

describe('stopSharedRuntimeForReplacement', () => {
  it('gracefully stops an authenticated old Runtime even when its full info schema is incompatible', async () => {
    const target = inspection()
    const fetchMock = vi.fn(async () => Response.json({ stopping: true }))
    const removeDiscovery = vi.fn(async () => true)
    const unregister = vi.fn(async () => true)

    await expect(stopSharedRuntimeForReplacement(dataDir, fetchMock as unknown as typeof fetch, {
      runtimeFlavor: 'production',
      manager
    }, {
      inspect: vi.fn(async () => target),
      waitForExit: vi.fn(async () => true),
      commandLine: vi.fn(async () => 'kun-runtime'),
      listenerPids: vi.fn(async () => [target.discovery.pid]),
      processIdentity: vi.fn(async () => ({
        pid: target.discovery.pid,
        commandLine: 'kun-runtime',
        executablePath: runtimeExecutablePath,
        startedAtMs: Date.parse(target.discovery.startedAt)
      })),
      terminate: vi.fn(),
      removeDiscovery,
      withAncillaryWriter: async (_dataDir, action) => action(),
      unregister
    })).resolves.toEqual({ stopped: true, forced: false })

    expect(fetchMock).toHaveBeenCalledWith(
      `${target.discovery.baseUrl}/v1/runtime/shutdown`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: `Bearer ${target.discovery.runtimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ instanceId: target.discovery.instanceId })
      })
    )
    expect(removeDiscovery).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('uses authenticated graceful shutdown without touching another flavor or the manager', async () => {
    const target = inspection()
    const requestShutdown = vi.fn(async () => undefined)
    const waitForExit = vi.fn(async () => true)
    const terminate = vi.fn()
    const removeDiscovery = vi.fn(async () => true)
    const unregister = vi.fn(async () => true)

    await expect(stopSharedRuntimeForReplacement(dataDir, fetch, {
      runtimeFlavor: 'production',
      manager
    }, {
      inspect: vi.fn(async () => target),
      requestShutdown,
      waitForExit,
      commandLine: vi.fn(async () => 'kun-runtime'),
      listenerPids: vi.fn(async () => [target.discovery.pid]),
      processIdentity: vi.fn(async () => ({
        pid: target.discovery.pid,
        commandLine: 'kun-runtime',
        executablePath: runtimeExecutablePath,
        startedAtMs: Date.parse(target.discovery.startedAt)
      })),
      terminate,
      removeDiscovery,
      withAncillaryWriter: async (_dataDir, action) => action(),
      unregister
    })).resolves.toEqual({ stopped: true, forced: false })

    expect(requestShutdown).toHaveBeenCalledWith(target, fetch)
    expect(waitForExit).toHaveBeenCalledWith(target.discovery.pid, 15_000)
    expect(terminate).not.toHaveBeenCalled()
    expect(removeDiscovery).toHaveBeenCalledWith(
      dataDir,
      target.discovery.instanceId,
      'production'
    )
    expect(unregister).toHaveBeenCalledWith({
      manager,
      flavor: 'production',
      instanceId: target.discovery.instanceId
    })
  })

  it('forces only the re-verified current flavor owner after graceful shutdown fails', async () => {
    const target = inspection()
    let current: SharedRuntimeInspection | null = target
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => {
      expect(await verify()).toBe(true)
      current = null
      return true
    })
    const removeDiscovery = vi.fn(async () => true)
    const unregister = vi.fn(async () => true)

    await expect(stopSharedRuntimeForReplacement(dataDir, fetch, {
      runtimeFlavor: 'production',
      manager
    }, {
      inspect: vi.fn(async () => current),
      requestShutdown: vi.fn(async () => { throw new Error('shutdown probe timed out') }),
      waitForExit: vi.fn(async (_pid, timeoutMs) => timeoutMs === 0),
      commandLine: vi.fn(async () => 'kun-runtime'),
      listenerPids: vi.fn(async () => [target.discovery.pid]),
      processIdentity: vi.fn(async () => ({
        pid: target.discovery.pid,
        commandLine: 'kun-runtime',
        executablePath: runtimeExecutablePath,
        startedAtMs: Date.parse(target.discovery.startedAt)
      })),
      terminate,
      removeDiscovery,
      withAncillaryWriter: async (_dataDir, action) => action(),
      unregister
    })).resolves.toEqual({ stopped: true, forced: true })

    expect(terminate).toHaveBeenCalledTimes(1)
    expect(terminate.mock.calls[0]?.[0]).toBe(target.discovery.pid)
    expect(removeDiscovery).toHaveBeenCalledWith(
      dataDir,
      target.discovery.instanceId,
      'production'
    )
    expect(unregister).toHaveBeenCalledWith({
      manager,
      flavor: 'production',
      instanceId: target.discovery.instanceId
    })
  })

  it('forces the matching discovery PID after HTTP has stopped listening', async () => {
    const target = inspection()
    let current: SharedRuntimeInspection | null = target
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => {
      expect(await verify()).toBe(true)
      current = null
      return true
    })

    await expect(stopSharedRuntimeForReplacement(dataDir, fetch, {
      runtimeFlavor: 'production',
      manager
    }, {
      inspect: vi.fn(async () => current),
      requestShutdown: vi.fn(async () => { throw new Error('shutdown unavailable') }),
      waitForExit: vi.fn(async (_pid, timeoutMs) => timeoutMs === 0),
      commandLine: vi.fn(async () => 'kun-runtime'),
      listenerPids: vi.fn(async () => []),
      processIdentity: vi.fn(async () => ({
        pid: target.discovery.pid,
        commandLine: `node serve-entry.js --data-dir ${dataDir}`,
        executablePath: runtimeExecutablePath,
        startedAtMs: Date.parse(target.discovery.startedAt)
      })),
      terminate,
      removeDiscovery: vi.fn(async () => true),
      withAncillaryWriter: async (_dataDir, action) => action(),
      unregister: vi.fn(async () => true)
    })).resolves.toEqual({ stopped: true, forced: true })

    expect(terminate).toHaveBeenCalledOnce()
  })

  it.each([
    ['command mismatch', 'node unrelated-service.js', Date.parse('2026-08-13T00:00:00.000Z')],
    ['PID reuse', 'kun-runtime', Date.parse('2026-08-13T00:02:00.000Z')],
    ['process inspection denied', '', null]
  ])('does not signal a PID on %s', async (_label, command, startedAtMs) => {
    const target = inspection()
    let signalSent = false
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => {
      if (!(await verify())) return false
      signalSent = true
      return true
    })
    const removeDiscovery = vi.fn(async () => true)

    await expect(stopSharedRuntimeForReplacement(dataDir, fetch, {
      runtimeFlavor: 'production',
      manager
    }, {
      inspect: vi.fn(async () => target),
      requestShutdown: vi.fn(async () => { throw new Error('shutdown unavailable') }),
      waitForExit: vi.fn(async () => false),
      commandLine: vi.fn(async () => command),
      listenerPids: vi.fn(async () => []),
      processIdentity: vi.fn(async () => startedAtMs === null ? null : ({
        pid: target.discovery.pid,
        commandLine: command,
        executablePath: runtimeExecutablePath,
        startedAtMs
      })),
      terminate,
      removeDiscovery,
      withAncillaryWriter: async (_dataDir, action) => action(),
      unregister: vi.fn(async () => true)
    })).rejects.toThrow(/could not be safely replaced/)

    expect(signalSent).toBe(false)
    expect(removeDiscovery).not.toHaveBeenCalled()
  })

  it('does not shut down or signal a replacement that wins before graceful shutdown', async () => {
    const target = inspection()
    const replacement = inspection({
      instanceId: 'production-new',
      pid: 202,
      startedAt: '2026-08-13T00:01:00.000Z',
      port: 43002,
      baseUrl: 'http://127.0.0.1:43002'
    })
    let reads = 0
    const terminate = vi.fn()
    const removeDiscovery = vi.fn(async () => true)
    const unregister = vi.fn(async () => true)
    const requestShutdown = vi.fn(async () => undefined)

    await expect(stopSharedRuntimeForReplacement(dataDir, fetch, {
      runtimeFlavor: 'production',
      manager
    }, {
      inspect: vi.fn(async () => ++reads === 1 ? target : replacement),
      requestShutdown,
      waitForExit: vi.fn(async (_pid, timeoutMs) => timeoutMs === 0),
      commandLine: vi.fn(async () => 'kun-runtime'),
      listenerPids: vi.fn(async () => [target.discovery.pid]),
      processIdentity: vi.fn(async () => ({
        pid: target.discovery.pid,
        commandLine: 'kun-runtime',
        executablePath: runtimeExecutablePath,
        startedAtMs: Date.parse(target.discovery.startedAt)
      })),
      terminate,
      removeDiscovery,
      withAncillaryWriter: async (_dataDir, action) => action(),
      unregister
    })).resolves.toEqual({ stopped: true, forced: false })

    expect(terminate).not.toHaveBeenCalled()
    expect(requestShutdown).not.toHaveBeenCalled()
    expect(removeDiscovery).toHaveBeenCalledWith(
      dataDir,
      target.discovery.instanceId,
      'production'
    )
    expect(unregister).toHaveBeenCalledWith({
      manager,
      flavor: 'production',
      instanceId: target.discovery.instanceId
    })
  })
})
