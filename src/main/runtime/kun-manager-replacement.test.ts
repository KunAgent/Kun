import { describe, expect, it, vi } from 'vitest'
import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import { stopServiceManagerForReplacement } from './kun-manager-replacement'

const controlDir = '/tmp/kun-control'
const scope = {
  dataDir: '/tmp/kun-data',
  settingsPath: '/tmp/Kun/kun-settings.json'
}

function manager(
  overrides: Partial<ManagerHandoffDiscoveryRecord> = {}
): ManagerHandoffDiscoveryRecord {
  return {
    version: 1,
    protocolVersion: 1,
    instanceId: 'manager-old',
    pid: 901,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: 43100,
    baseUrl: 'http://127.0.0.1:43100',
    managerToken: 'manager-secret',
    serviceVersion: '0.1.0',
    dataDir: scope.dataDir,
    settingsPath: scope.settingsPath,
    ...overrides
  }
}

describe('stopServiceManagerForReplacement', () => {
  it('gracefully stops an exact authenticated Manager without full health parsing', async () => {
    const target = manager({ version: 7, protocolVersion: 3 })
    const fetchMock = vi.fn(async () => Response.json({ accepted: true }))
    const removeDiscovery = vi.fn(async () => true)
    let waitCalls = 0

    await expect(stopServiceManagerForReplacement(
      controlDir,
      scope,
      fetchMock as unknown as typeof fetch,
      {
        readDiscovery: vi.fn(async () => target),
        waitForExit: vi.fn(async () => ++waitCalls > 1),
        commandLine: vi.fn(),
        listenerPids: vi.fn(),
        terminate: vi.fn(),
        removeDiscovery
      }
    )).resolves.toEqual({ stopped: true, forced: false })

    expect(fetchMock).toHaveBeenCalledWith(
      `${target.baseUrl}/v1/manager/shutdown`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: `Bearer ${target.managerToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ instanceId: target.instanceId })
      })
    )
    expect(removeDiscovery).toHaveBeenCalledWith(controlDir, target.instanceId)
  })

  it('forces only an unchanged Manager with matching command, scope, and listener', async () => {
    const target = manager()
    let current: ManagerHandoffDiscoveryRecord | null = target
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => {
      expect(await verify()).toBe(true)
      current = null
      return true
    })
    const removeDiscovery = vi.fn(async () => true)

    await expect(stopServiceManagerForReplacement(controlDir, scope, fetch, {
      readDiscovery: vi.fn(async () => current),
      requestShutdown: vi.fn(async () => { throw new Error('shutdown timed out') }),
      waitForExit: vi.fn(async () => current === null),
      commandLine: vi.fn(async () => '/Applications/Kun.app/manager-entry.js'),
      listenerPids: vi.fn(async () => [target.pid]),
      terminate,
      removeDiscovery
    })).resolves.toEqual({ stopped: true, forced: true })

    expect(terminate).toHaveBeenCalledTimes(1)
    expect(removeDiscovery).not.toHaveBeenCalled()
  })

  it.each([
    ['command mismatch', 'node unrelated.js', [901]],
    ['listener mismatch', 'kun-service-manager', [902]],
    ['process inspection denied', '', []]
  ])('refuses force replacement on %s', async (_label, command, listeners) => {
    const target = manager()
    let signalSent = false
    const terminate = vi.fn(async (_pid: number, verify: () => Promise<boolean>) => {
      if (!(await verify())) return false
      signalSent = true
      return true
    })

    await expect(stopServiceManagerForReplacement(controlDir, scope, fetch, {
      readDiscovery: vi.fn(async () => target),
      requestShutdown: vi.fn(async () => { throw new Error('shutdown unavailable') }),
      waitForExit: vi.fn(async () => false),
      commandLine: vi.fn(async () => command),
      listenerPids: vi.fn(async () => listeners),
      terminate,
      removeDiscovery: vi.fn(async () => true)
    })).rejects.toThrow(/could not be safely replaced/)

    expect(signalSent).toBe(false)
  })

  it('does not signal a changed live owner or erase its record', async () => {
    const target = manager()
    const replacement = manager({
      instanceId: 'manager-new',
      pid: 902,
      startedAt: '2026-08-21T00:01:00.000Z',
      port: 43101,
      baseUrl: 'http://127.0.0.1:43101',
      managerToken: 'new-secret'
    })
    let reads = 0
    const removeDiscovery = vi.fn(async () => true)
    const requestShutdown = vi.fn()
    const terminate = vi.fn()

    await expect(stopServiceManagerForReplacement(controlDir, scope, fetch, {
      readDiscovery: vi.fn(async () => ++reads === 1 ? target : replacement),
      requestShutdown,
      waitForExit: vi.fn(async () => false),
      commandLine: vi.fn(),
      listenerPids: vi.fn(),
      terminate,
      removeDiscovery
    })).rejects.toThrow(/ownership changed before shutdown/)

    expect(requestShutdown).not.toHaveBeenCalled()
    expect(terminate).not.toHaveBeenCalled()
    expect(removeDiscovery).not.toHaveBeenCalled()
  })

  it('treats an already-exited changed target as settled without touching replacement', async () => {
    const target = manager()
    const replacement = manager({
      instanceId: 'manager-new',
      pid: 902,
      startedAt: '2026-08-21T00:01:00.000Z'
    })
    let reads = 0
    let waits = 0
    const removeDiscovery = vi.fn(async () => false)

    await expect(stopServiceManagerForReplacement(controlDir, scope, fetch, {
      readDiscovery: vi.fn(async () => ++reads === 1 ? target : replacement),
      requestShutdown: vi.fn(),
      waitForExit: vi.fn(async () => ++waits > 1),
      commandLine: vi.fn(),
      listenerPids: vi.fn(),
      terminate: vi.fn(),
      removeDiscovery
    })).resolves.toEqual({ stopped: true, forced: false })

    expect(removeDiscovery).toHaveBeenCalledWith(controlDir, target.instanceId)
  })

  it('rejects a Manager outside the selected canonical scope', async () => {
    const target = manager({ dataDir: '/tmp/other-data' })
    await expect(stopServiceManagerForReplacement(controlDir, scope, fetch, {
      readDiscovery: vi.fn(async () => target)
    })).rejects.toThrow(/different canonical scope/)
  })
})
