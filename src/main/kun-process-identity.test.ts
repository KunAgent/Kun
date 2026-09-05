import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  commandLooksLikeExpectedServe,
  commandLooksLikeExpectedManager,
  identityMatchesExpectedManager,
  identityMatchesExpectedRuntime,
  looksLikeRuntimeExecutable,
  sameRuntimeOwner
} from './kun-process-identity'
import type { ManagerHandoffDiscoveryRecord } from '../../kun/src/manager/manager-discovery.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../kun/src/server/runtime-discovery.js'

const dataDir = resolve('tmp', 'kun-data')
const serveEntry = resolve('opt', 'Kun', 'resources', 'kun', 'dist', 'cli', 'serve-entry.js')
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

function managerDiscovery(
  overrides: Partial<ManagerHandoffDiscoveryRecord> = {}
): ManagerHandoffDiscoveryRecord {
  return {
    version: 7,
    protocolVersion: 3,
    instanceId: 'manager-1',
    pid: 8124,
    startedAt,
    host: '127.0.0.1',
    port: 18900,
    baseUrl: 'http://127.0.0.1:18900',
    managerToken: 'manager-token',
    dataDir,
    settingsPath: '/tmp/Kun/kun-settings.json',
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

  it('matches only the recorded service manager process generation', () => {
    expect(identityMatchesExpectedManager({
      pid: 8124,
      commandLine: 'node /opt/Kun/resources/kun/dist/manager/manager-entry.js',
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      startedAtMs: Date.parse(startedAt)
    }, managerDiscovery())).toBe(true)
    expect(identityMatchesExpectedManager({
      pid: 8124,
      commandLine: 'C:\\Windows\\System32\\SNAPOS64.exe',
      executablePath: 'C:\\Windows\\System32\\SNAPOS64.exe',
      startedAtMs: Date.parse(startedAt) + 120_000
    }, managerDiscovery())).toBe(false)
  })

  it('rejects a Manager PID whose start time exceeds the ownership tolerance', () => {
    expect(identityMatchesExpectedManager({
      pid: 8124,
      commandLine: 'kun-service-manager',
      executablePath: null,
      startedAtMs: Date.parse(startedAt) + 60_001
    }, managerDiscovery())).toBe(false)
  })

  it('requires a trusted executable when matching a Manager on Windows', () => {
    expect(identityMatchesExpectedManager({
      pid: 8124,
      commandLine: 'kun-service-manager',
      executablePath: 'C:\\tools\\unrelated.exe',
      startedAtMs: Date.parse(startedAt)
    }, managerDiscovery(), 'win32')).toBe(false)
    expect(identityMatchesExpectedManager({
      pid: 8124,
      commandLine: 'kun-service-manager',
      executablePath: null,
      startedAtMs: Date.parse(startedAt)
    }, managerDiscovery(), 'win32')).toBe(false)
  })

  it('rejects incomplete process identity', () => {
    expect(identityMatchesExpectedManager({
      pid: 8124,
      commandLine: 'kun-service-manager',
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      startedAtMs: null
    }, managerDiscovery(), 'win32')).toBe(false)
  })

  it('does not accept a manager-entry substring in an unrelated command', () => {
    expect(commandLooksLikeExpectedManager('node /tmp/not-manager-entry.js')).toBe(false)
    expect(commandLooksLikeExpectedManager('node --inspect=/tmp/manager-entry.js')).toBe(false)
    expect(commandLooksLikeExpectedManager('node /tmp/manager-entry.js')).toBe(true)
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
