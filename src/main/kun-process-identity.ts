import { resolve } from 'node:path'
import type { RuntimeFlavor } from '../../kun/src/contracts/runtime-flavor.js'
import type { ManagerHandoffDiscoveryRecord } from '../../kun/src/manager/manager-discovery.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../kun/src/server/runtime-discovery.js'
import type { ProcessIdentity } from './kun-process-ports'

export const MAX_RUNTIME_STARTED_AT_DIFFERENCE_MS = 60_000

export function identityMatchesExpectedRuntime(
  identity: ProcessIdentity | null,
  discovery: RuntimeHandoffDiscoveryRecord,
  dataDir: string,
  flavor: RuntimeFlavor,
  expectedServeEntryPath?: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!identity || identity.pid !== discovery.pid) return false
  if (!commandLooksLikeExpectedServe(identity.commandLine, dataDir, flavor, expectedServeEntryPath)) {
    return false
  }
  if (platform === 'win32' && !looksLikeRuntimeExecutable(identity.executablePath)) return false
  const discoveryStartedAtMs = Date.parse(discovery.startedAt)
  return Number.isFinite(discoveryStartedAtMs) && identity.startedAtMs !== null &&
    Math.abs(identity.startedAtMs - discoveryStartedAtMs) <= MAX_RUNTIME_STARTED_AT_DIFFERENCE_MS
}

export function identityMatchesExpectedManager(
  identity: ProcessIdentity | null,
  discovery: ManagerHandoffDiscoveryRecord,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!identity || identity.pid !== discovery.pid) return false
  if (!commandLooksLikeExpectedManager(identity.commandLine)) return false
  if (platform === 'win32' && !looksLikeRuntimeExecutable(identity.executablePath)) return false
  const discoveryStartedAtMs = Date.parse(discovery.startedAt)
  return Number.isFinite(discoveryStartedAtMs) && identity.startedAtMs !== null &&
    Math.abs(identity.startedAtMs - discoveryStartedAtMs) <= MAX_RUNTIME_STARTED_AT_DIFFERENCE_MS
}

export function commandLooksLikeExpectedManager(command: string): boolean {
  const normalized = command.trim()
  const normalizedTitle = normalized.toLocaleLowerCase('en-US')
  if (normalizedTitle === 'kun-service-manager' || normalizedTitle.startsWith('kun-service-manager ')) {
    return true
  }
  return splitCommandLine(normalized).some((token) =>
    !token.startsWith('-') && /(?:^|[/\\])manager-entry\.js$/iu.test(token)
  )
}

export function commandLooksLikeExpectedServe(
  command: string,
  dataDir: string,
  flavor: RuntimeFlavor,
  expectedServeEntryPath?: string
): boolean {
  const normalized = command.trim()
  const expectedTitle = flavor === 'development' ? 'kun-dv-runtime' : 'kun-runtime'
  if (normalized === expectedTitle || normalized.startsWith(`${expectedTitle} `)) return true
  const tokens = splitCommandLine(normalized)
  if (!tokens.some((token) => isServeEntry(token, expectedServeEntryPath))) return false
  return tokens.includes('--data-dir') && tokens.some((token) =>
    normalizeCommandPath(token) === normalizeCommandPath(resolve(dataDir))
  )
}

export function looksLikeRuntimeExecutable(executablePath: string | null): boolean {
  return Boolean(executablePath && /(?:^|[/\\])(?:node|electron|kun[^/\\]*)\.exe$/iu.test(executablePath))
}

export function sameRuntimeOwner(
  expected: RuntimeHandoffDiscoveryRecord,
  current: RuntimeHandoffDiscoveryRecord | null
): boolean {
  return Boolean(current && current.instanceId === expected.instanceId &&
    current.pid === expected.pid && current.startedAt === expected.startedAt &&
    current.baseUrl === expected.baseUrl && current.port === expected.port &&
    current.runtimeToken === expected.runtimeToken)
}

function isServeEntry(token: string, expectedPath?: string): boolean {
  if (expectedPath) return normalizeCommandPath(token) === normalizeCommandPath(resolve(expectedPath))
  return /(?:^|[/\\])serve(?:-entry)?\.(?:cjs|mjs|js)$/iu.test(token)
}

function splitCommandLine(command: string): string[] {
  const tokens: string[] = []
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/gu)) {
    const token = match[1] ?? match[2] ?? match[3]
    if (token) tokens.push(token)
  }
  return tokens
}

function normalizeCommandPath(value: string): string {
  const normalized = value.replace(/\\/gu, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
