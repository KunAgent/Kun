import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SharedRuntimeInspection } from '../../../kun/src/cli/shared-runtime.js'
import type { ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'
import {
  handoffExistingKunServiceManagerForDataDir,
  probeRuntimeForServiceManagerHandoff
} from './service-manager-build-handoff'

const dataDir = '/tmp/kun-handoff-data'
const settingsPath = '/tmp/kun-settings.json'

function manager(): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 5,
      instanceId: 'manager-old',
      pid: 900,
      startedAt: '2026-08-19T00:00:00.000Z',
      host: '127.0.0.1',
      port: 43000,
      baseUrl: 'http://127.0.0.1:43000',
      managerToken: 'manager-token',
      serviceVersion: '0.1.0',
      buildId: 'a'.repeat(64),
      dataDir,
      settingsPath
    }
  }
}

function oldRuntime(): SharedRuntimeInspection {
  return {
    discovery: {
      version: 2,
      instanceId: 'runtime-old',
      pid: 901,
      startedAt: '2026-08-19T00:01:00.000Z',
      host: '127.0.0.1',
      port: 43001,
      baseUrl: 'http://127.0.0.1:43001',
      runtimeToken: 'runtime-token',
      insecure: false,
      serviceVersion: '0.1.0',
      flavor: 'production',
      buildId: 'a'.repeat(64),
      launchMode: 'shared'
    },
    // The new build rejected this Runtime's complete capability manifest.
    connection: null
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Service Manager build handoff', () => {
  it('uses the stable identity contract when an old capability schema cannot be parsed', async () => {
    const runtime = oldRuntime()
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: runtime.discovery.instanceId,
      pid: runtime.discovery.pid,
      startedAt: runtime.discovery.startedAt,
      dataDir,
      buildId: runtime.discovery.buildId,
      capabilities: {
        subagents: {
          // Intentionally omits fields required only by the new build.
          profiles: []
        }
      }
    }, {
      headers: { 'x-kun-active-turn-count': '0' }
    }))

    await expect(probeRuntimeForServiceManagerHandoff(
      runtime,
      dataDir,
      fetchMock as unknown as typeof fetch
    )).resolves.toBe(0)

    expect(fetchMock).toHaveBeenCalledWith(
      `${runtime.discovery.baseUrl}/v1/runtime/info`,
      expect.objectContaining({
        headers: { authorization: `Bearer ${runtime.discovery.runtimeToken}` }
      })
    )
  })

  it('automatically replaces an idle old Runtime and Manager after the compatibility probe', async () => {
    const currentManager = manager()
    const runtime = oldRuntime()
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: runtime.discovery.instanceId,
      pid: runtime.discovery.pid,
      startedAt: runtime.discovery.startedAt,
      dataDir,
      buildId: runtime.discovery.buildId
    }, {
      headers: { 'x-kun-active-turn-count': '0' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const inspect = vi.fn(async (
      _dataDir: string,
      _fetchImpl: typeof fetch,
      scope: { runtimeFlavor?: string }
    ) => scope.runtimeFlavor === 'production' ? runtime : null)
    const stop = vi.fn(async () => undefined)
    const shutdown = vi.fn(async () => undefined)
    const waitForExit = vi.fn(async () => true)

    await handoffExistingKunServiceManagerForDataDir(
      currentManager,
      dataDir,
      settingsPath,
      {
        force: true,
        inspect: inspect as never,
        stop,
        shutdown,
        waitForExit
      }
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(waitForExit).toHaveBeenCalledWith(currentManager.discovery.pid, 15_000)
  })

  it('does not hand off when the compatible old Runtime reports active work', async () => {
    const runtime = oldRuntime()
    const stop = vi.fn(async () => undefined)

    await expect(handoffExistingKunServiceManagerForDataDir(
      manager(),
      dataDir,
      settingsPath,
      {
        force: true,
        inspect: vi.fn(async (_dataDir, _fetchImpl, scope) =>
          scope.runtimeFlavor === 'production' ? runtime : null),
        probe: vi.fn(async () => 1),
        stop
      }
    )).rejects.toThrow(/still has active turns/)

    expect(stop).not.toHaveBeenCalled()
  })

  it('rejects a compatibility response whose authenticated identity changed', async () => {
    const runtime = oldRuntime()
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: 'different-runtime',
      pid: runtime.discovery.pid,
      startedAt: runtime.discovery.startedAt,
      dataDir
    }, {
      headers: { 'x-kun-active-turn-count': '0' }
    }))

    await expect(probeRuntimeForServiceManagerHandoff(
      runtime,
      dataDir,
      fetchMock as unknown as typeof fetch
    )).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
