import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0',
    getPath: () => '/tmp/kun-user-data',
    getAppPath: () => '/tmp/app'
  }
}))

import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import {
  drainKunOwnersForHandoff,
  KunHandoffError
} from './kun-installed-build-handoff'
import { handoffFailureKind } from './kun-handoff-failure'

const controlDir = '/tmp/kun-control'
const dataDir = '/tmp/kun-data'
const settingsPath = '/tmp/Kun/kun-settings.json'

function manager(): ManagerHandoffDiscoveryRecord {
  return {
    version: 7,
    protocolVersion: 3,
    instanceId: 'manager-old',
    pid: 900,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: 43000,
    baseUrl: 'http://127.0.0.1:43000',
    managerToken: 'manager-secret',
    dataDir,
    settingsPath,
    buildId: 'a'.repeat(64)
  }
}

function input() {
  return {
    reason: 'installed-build-change' as const,
    dataDirs: [dataDir],
    settingsPath,
    controlDir,
    targetBuildId: 'b'.repeat(64)
  }
}

describe('identity-unverifiable handoff', () => {
  it('fails closed with identity_unverifiable when OS identity and HTTP cross-verification are both unavailable', async () => {
    const currentManager = manager()
    const stopRuntime = vi.fn()
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(
      {
        ...input(),
        fetch: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
      },
      {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => currentManager,
        readRuntime: async () => null,
        processAlive: () => true,
        processIdentity: async () => null,
        stopRuntime: stopRuntime as never,
        stopManager: stopManager as never
      }
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(KunHandoffError)
    expect(failure).toMatchObject({ code: 'identity_unverifiable', retryable: true })
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(stopManager).not.toHaveBeenCalled()
  })

  it('does not terminate an unverifiable owner even when stale records settle', async () => {
    const currentManager = manager()
    const stopRuntime = vi.fn()
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(
      {
        ...input(),
        fetch: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
      },
      {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => currentManager,
        readRuntime: async () => null,
        processAlive: () => true,
        processIdentity: async () => ({ pid: 900, commandLine: '', executablePath: null, startedAtMs: null }),
        stopRuntime: stopRuntime as never,
        stopManager: stopManager as never
      }
    ).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'identity_unverifiable' })
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(stopManager).not.toHaveBeenCalled()
  })
})

describe('handoffFailureKind', () => {
  it('classifies identity_unverifiable and probe_failed as handoff failures', () => {
    expect(handoffFailureKind(
      new KunHandoffError('identity_unverifiable', 'discover', 'installed-build-change', true, undefined, 'x')
    )).toBe('identity_unverifiable')
    expect(handoffFailureKind(
      new KunHandoffError('probe_failed', 'discover', 'installed-build-change', true, undefined, 'x')
    )).toBe('probe_failed')
  })

  it('returns null for non-handoff errors', () => {
    expect(handoffFailureKind(new Error('boom'))).toBeNull()
    expect(handoffFailureKind(
      new KunHandoffError('runtime_stop_failed', 'stop-runtimes', 'installed-build-change', true, undefined, 'x')
    )).toBeNull()
  })
})
