import { describe, expect, it, vi } from 'vitest'
import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import {
  ClientRuntimeOwnerBusyError,
  drainKunOwnersForHandoff
} from './kun-installed-build-handoff'

const dataDir = '/tmp/kun-data'
const settingsPath = '/tmp/Kun/kun-settings.json'
const startedAt = '2026-08-21T00:00:00.000Z'

function manager(): ManagerHandoffDiscoveryRecord {
  return {
    version: 1,
    protocolVersion: 5,
    instanceId: 'manager-current',
    pid: 900,
    startedAt,
    host: '127.0.0.1',
    port: 43000,
    baseUrl: 'http://127.0.0.1:43000',
    managerToken: 'manager-secret',
    dataDir,
    settingsPath
  }
}

function clientRuntime(): RuntimeHandoffDiscoveryRecord {
  return {
    version: 1,
    instanceId: 'development-tui',
    pid: 902,
    startedAt,
    host: '127.0.0.1',
    port: 43002,
    baseUrl: 'http://127.0.0.1:43002',
    runtimeToken: 'runtime-secret',
    flavor: 'development',
    clientOwnerKind: 'tui'
  }
}

describe('startup retry Manager handoff', () => {
  it('preserves another client-owned Runtime instead of restarting its Manager', async () => {
    const currentManager = manager()
    const currentRuntime = clientRuntime()
    const stopRuntime = vi.fn()
    const stopManager = vi.fn()
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: currentManager.instanceId,
      pid: currentManager.pid,
      startedAt: currentManager.startedAt,
      slots: []
    }))

    const failure = await drainKunOwnersForHandoff({
      reason: 'startup-retry',
      dataDirs: [dataDir],
      settingsPath,
      controlDir: '/tmp/kun-control',
      fetch: fetchMock as unknown as typeof fetch
    }, {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => currentManager,
      readRuntime: async (_dir, flavor) => flavor === 'development' ? currentRuntime : null,
      processAlive: (pid) => pid === currentManager.pid || pid === currentRuntime.pid,
      processIdentity: async (pid) => ({
        pid,
        commandLine: pid === currentManager.pid ? 'kun-service-manager' : 'kun-dv-runtime',
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        startedAtMs: Date.parse(startedAt)
      }),
      stopRuntime: stopRuntime as never,
      stopManager: stopManager as never
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ClientRuntimeOwnerBusyError)
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(stopManager).not.toHaveBeenCalled()
  })
})
