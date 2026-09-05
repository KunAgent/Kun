import { describe, expect, it, vi } from 'vitest'
import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import {
  verifyManagerOwner,
  verifyRuntimeOwner
} from './kun-handoff-owner-verification'

const dataDir = '/tmp/kun-data'
const startedAt = '2026-08-21T00:00:00.000Z'

function runtimeRecord(
  overrides: Partial<RuntimeHandoffDiscoveryRecord> = {}
): RuntimeHandoffDiscoveryRecord {
  return {
    version: 1,
    instanceId: 'runtime-old',
    pid: 901,
    startedAt,
    host: '127.0.0.1',
    port: 43001,
    baseUrl: 'http://127.0.0.1:43001',
    runtimeToken: 'runtime-secret',
    buildId: 'a'.repeat(64),
    ...overrides
  }
}

function managerRecord(
  overrides: Partial<ManagerHandoffDiscoveryRecord> = {}
): ManagerHandoffDiscoveryRecord {
  return {
    version: 7,
    protocolVersion: 3,
    instanceId: 'manager-old',
    pid: 900,
    startedAt,
    host: '127.0.0.1',
    port: 43000,
    baseUrl: 'http://127.0.0.1:43000',
    managerToken: 'manager-secret',
    dataDir,
    settingsPath: '/tmp/Kun/kun-settings.json',
    ...overrides
  }
}

function matchingIdentity(pid: number, commandLine = 'kun-runtime') {
  return {
    pid,
    commandLine,
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    startedAtMs: Date.parse(startedAt)
  }
}

function fetchReturning(body: unknown): typeof fetch {
  return vi.fn(async () => Response.json(body)) as unknown as typeof fetch
}

function identityFor(pid: number, startedAtMs: number) {
  return {
    pid,
    commandLine: 'kun-runtime',
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    startedAtMs
  }
}

describe('verifyRuntimeOwner', () => {
  it('returns verified_owner when OS identity matches', async () => {
    const record = runtimeRecord()
    const result = await verifyRuntimeOwner(record, dataDir, 'production', {
      processIdentity: async () => matchingIdentity(record.pid),
      fetch: fetchReturning({})
    })
    expect(result).toBe('verified_owner')
  })

  it('returns verified_mismatch when OS identity is a different birth', async () => {
    const record = runtimeRecord()
    const result = await verifyRuntimeOwner(record, dataDir, 'production', {
      processIdentity: async () =>
        identityFor(record.pid, Date.parse(startedAt) + 10_000_000),
      fetch: fetchReturning({})
    })
    expect(result).toBe('verified_mismatch')
  })

  it('falls back to authenticated HTTP cross-verification when identity is null', async () => {
    const record = runtimeRecord()
    const fetchImpl = fetchReturning({
      instanceId: record.instanceId,
      pid: record.pid,
      startedAt: record.startedAt,
      buildId: record.buildId,
      dataDir,
      port: record.port
    })
    const result = await verifyRuntimeOwner(record, dataDir, 'production', {
      processIdentity: async () => null,
      fetch: fetchImpl
    })
    expect(result).toBe('verified_owner')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('returns unknown when cross-verification is rejected (401)', async () => {
    const record = runtimeRecord()
    const result = await verifyRuntimeOwner(record, dataDir, 'production', {
      processIdentity: async () => null,
      fetch: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
    })
    expect(result).toBe('unknown')
  })

  it('returns unknown when cross-verification fields do not match', async () => {
    const record = runtimeRecord()
    const result = await verifyRuntimeOwner(record, dataDir, 'production', {
      processIdentity: async () => null,
      fetch: fetchReturning({
        instanceId: 'someone-else',
        pid: record.pid,
        startedAt: record.startedAt,
        buildId: record.buildId,
        dataDir,
        port: record.port
      })
    })
    expect(result).toBe('unknown')
  })

  it('returns unknown when cross-verification times out', async () => {
    const record = runtimeRecord()
    const result = await verifyRuntimeOwner(record, dataDir, 'production', {
      processIdentity: async () => null,
      fetch: vi.fn(async () => {
        throw new Error('timeout')
      }) as unknown as typeof fetch
    })
    expect(result).toBe('unknown')
  })
})

describe('verifyManagerOwner', () => {
  it('returns verified_owner when OS identity matches', async () => {
    const record = managerRecord()
    const result = await verifyManagerOwner(record, {
      processIdentity: async () => matchingIdentity(record.pid, 'kun-service-manager'),
      fetch: fetchReturning({})
    })
    expect(result).toBe('verified_owner')
  })

  it('cross-verifies via /v1/manager/status when identity is unreadable', async () => {
    const record = managerRecord()
    const result = await verifyManagerOwner(record, {
      processIdentity: async () => null,
      fetch: fetchReturning({
        instanceId: record.instanceId,
        pid: record.pid,
        startedAt: record.startedAt
      })
    })
    expect(result).toBe('verified_owner')
  })

  it('returns unknown when manager status fields mismatch', async () => {
    const record = managerRecord()
    const result = await verifyManagerOwner(record, {
      processIdentity: async () => null,
      fetch: fetchReturning({ instanceId: 'other', startedAt: record.startedAt })
    })
    expect(result).toBe('unknown')
  })
})
