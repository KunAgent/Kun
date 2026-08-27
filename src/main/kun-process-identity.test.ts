import { describe, expect, it } from 'vitest'
import {
  commandLooksLikeExpectedServe,
  identityMatchesExpectedRuntime,
  looksLikeRuntimeExecutable,
  sameRuntimeOwner
} from './kun-process-identity'
import type { RuntimeHandoffDiscoveryRecord } from '../../kun/src/server/runtime-discovery.js'

const dataDir = '/tmp/kun-data'
const serveEntry = '/opt/Kun/resources/kun/dist/cli/serve-entry.js'
const startedAt = '2026-08-25T15:00:00.000Z'

function discovery(overrides: Partial<RuntimeHandoffDiscoveryRecord> = {}): RuntimeHandoffDiscoveryRecord {
  return {
    version: 2,
    instanceId: 'instance-1',
    pid: 8123,
    startedAt,
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'runtime-token',
    insecure: false,
    serviceVersion: 'test',
    launchMode: 'shared',
    ...overrides
  }
}

describe('Kun process identity', () => {
  it('requires the exact normalized serve-entry path instead of a matching substring', () => {
    expect(commandLooksLikeExpectedServe(
      `node /tmp/other-serve-entry.js serve --data-dir ${dataDir}`,
      dataDir,
      'production',
      serveEntry
    )).toBe(false)
    expect(commandLooksLikeExpectedServe(
      `node "${serveEntry}" serve --data-dir "${dataDir}"`,
      dataDir,
      'production',
      serveEntry
    )).toBe(true)
  })

  it('rejects a PID whose start time no longer matches the ownership record', () => {
    expect(identityMatchesExpectedRuntime({
      pid: 8123,
      commandLine: `node "${serveEntry}" serve --data-dir "${dataDir}"`,
      executablePath: null,
      startedAtMs: Date.parse(startedAt) + 60_001
    }, discovery(), dataDir, 'production', serveEntry)).toBe(false)
  })

  it('compares runtime tokens as part of discovery ownership', () => {
    expect(sameRuntimeOwner(discovery(), discovery({ runtimeToken: 'different-token' }))).toBe(false)
    expect(sameRuntimeOwner(discovery(), discovery())).toBe(true)
  })

  it('recognizes only Windows runtime executables', () => {
    expect(looksLikeRuntimeExecutable('C:\\Program Files\\nodejs\\node.exe')).toBe(true)
    expect(looksLikeRuntimeExecutable('C:\\tools\\unrelated.exe')).toBe(false)
  })
})
