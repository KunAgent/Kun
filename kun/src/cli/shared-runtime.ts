import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { RuntimeInfoResponse, type RuntimeInfoResponse as RuntimeInfo } from '../contracts/runtime-info.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import {
  createRuntimeDiscoveryRecord,
  type RuntimeDiscoveryRecord,
  readRuntimeDiscovery,
  removeRuntimeDiscovery,
  withRuntimeStartLock
} from '../server/runtime-discovery.js'
import {
  hasUnpublishedGuiRuntime,
  readGuiSharedSettings,
  syncGuiProviderCatalogToConfig
} from './gui-settings-bridge.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import { DEFAULT_FRESH_SERVE_PERMISSIONS } from './cli-options.js'
import type { RuntimeFlavor, RuntimeRegistration } from '../contracts/runtime-flavor.js'
import { defaultKunControlDir } from '../manager/manager-discovery.js'
import {
  readManagerRuntime,
  resolveServiceManager,
  unregisterRuntimeWithManager,
  type ServiceManagerConnection
} from '../manager/manager-client.js'
import { sameCanonicalPath } from '../manager/canonical-path.js'
import {
  resolveCliRuntimeFlavor,
  runtimeBuildIdForFlavor,
  runtimeDisplayName
} from './runtime-flavor.js'
import {
  withRuntimeDataDirAncillaryWriter,
  withRuntimeDataDirConfigWriter
} from '../server/runtime-data-dir-lease.js'
import { requestExactRuntimeShutdown } from './runtime-shutdown-client.js'

const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 15_000
const POLL_MS = 100

export type SharedRuntimeConnection = {
  discovery: RuntimeDiscoveryRecord
  info: RuntimeInfo
  activeTurnCount?: number
  managerProtocolVersion?: number
}

export type SharedRuntimeInspection = {
  discovery: RuntimeDiscoveryRecord
  connection: SharedRuntimeConnection | null
}

export type SharedRuntimeScope = {
  runtimeFlavor?: RuntimeFlavor
  controlDir?: string
  manager?: ServiceManagerConnection
}

export async function runRuntimeCommand(
  argv: readonly string[],
  io: {
    stdout: { write(chunk: string): unknown }
    stderr: { write(chunk: string): unknown }
    env?: Record<string, string | undefined>
    fetch?: typeof fetch
  }
): Promise<number> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    io.stdout.write('kun runtime <status|stop|restart> [--data-dir <path>]\n')
    return 0
  }
  if (command !== 'status' && command !== 'stop' && command !== 'restart') {
    io.stderr.write(`kun runtime: unknown command: ${command}\n`)
    return 64
  }
  const environment = io.env ?? {}
  const runtimeFlavor = resolveCliRuntimeFlavor({ env: environment })
  const runtimeLabel = runtimeDisplayName(runtimeFlavor)
  const dataDirResult = runtimeDataDir(argv.slice(1), environment)
  if (!dataDirResult.ok) {
    io.stderr.write(`kun runtime: ${dataDirResult.message}\n`)
    return 64
  }
  let dataDir = dataDirResult.dataDir
  const guiSettings = await readGuiSharedSettings({ env: environment })
  if (dataDirResult.source === 'default' && guiSettings) dataDir = guiSettings.dataDir
  const fetchImpl = io.fetch ?? fetch
  const controlDir = environment.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  const resolvedManager = await resolveServiceManager(controlDir, fetchImpl).catch(() => null)
  const manager = resolvedManager && sameCanonicalPath(resolvedManager.discovery.dataDir, dataDir)
    ? resolvedManager
    : undefined
  const scope: SharedRuntimeScope = {
    runtimeFlavor,
    controlDir,
    ...(manager ? { manager } : {})
  }
  const unpublishedGuiRuntime = guiSettings && dataDir === guiSettings.dataDir
    ? await hasUnpublishedGuiRuntime(guiSettings, fetchImpl)
    : false
  try {
    if (command === 'status') {
      if (unpublishedGuiRuntime) {
        io.stdout.write(
          `Kun runtime: older GUI runtime active (shared discovery unavailable)\nData directory: ${dataDir}\n`
        )
        return 0
      }
      const connection = await resolveSharedRuntime(dataDir, fetchImpl, scope)
      if (!connection) {
        io.stdout.write(`${runtimeLabel}: stopped\nData directory: ${dataDir}\n`)
        return 0
      }
      const record = connection.discovery
      io.stdout.write([
        `${runtimeLabel}: healthy`,
        `Version: ${record.serviceVersion}`,
        `PID: ${record.pid}`,
        `URL: ${record.baseUrl}`,
        `Started: ${record.startedAt}`,
        `Mode: ${record.launchMode}`,
        `Logs: ${record.logPath ?? '(foreground process)'}`,
        ''
      ].join('\n'))
      return 0
    }
    if (unpublishedGuiRuntime) {
      throw new Error('an older GUI runtime is using this data directory; close or update the GUI before stop/restart')
    }
    if (command === 'stop') {
      const stopped = await stopSharedRuntime(dataDir, fetchImpl, scope)
      io.stdout.write(stopped ? `${runtimeLabel} stopped.\n` : `${runtimeLabel} is not running.\n`)
      return 0
    }
    await stopSharedRuntime(dataDir, fetchImpl, scope)
    // A managed Runtime's registry is already Manager-owned, and this CLI
    // process does not hold the Manager's writer authority. Never borrow that
    // cross-process lease for a legacy config-file rewrite. Unmanaged restart
    // has just stopped its sole Runtime owner, so the sync can take a bounded
    // config claim before the replacement Runtime starts.
    if (guiSettings && !manager) {
      await syncGuiProviderCatalogToConfig(dataDir, guiSettings)
    }
    const restarted = await ensureSharedRuntime({
      dataDir,
      env: io.env,
      fetch: fetchImpl,
      runtimeFlavor,
      controlDir,
      ...(manager ? { manager } : {})
    })
    io.stdout.write(`${runtimeLabel} restarted at ${restarted.discovery.baseUrl}.\n`)
    return 0
  } catch (error) {
    io.stderr.write(`kun runtime: ${error instanceof Error ? error.message : String(error)}\n`)
    return 70
  }
}

export async function probeRuntimeDiscovery(
  record: RuntimeDiscoveryRecord,
  fetchImpl: typeof fetch = fetch
): Promise<SharedRuntimeConnection | null> {
  if (!safeDiscoveryUrl(record)) return null
  if (!processAlive(record.pid)) return null
  try {
    const response = await fetchImpl(`${record.baseUrl.replace(/\/$/u, '')}/v1/runtime/info`, {
      headers: record.runtimeToken
        ? { authorization: `Bearer ${record.runtimeToken}` }
        : {},
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return null
    const info = RuntimeInfoResponse.parse(await response.json())
    if (
      info.instanceId !== record.instanceId ||
      info.pid !== record.pid ||
      info.startedAt !== record.startedAt ||
      info.serviceVersion !== record.serviceVersion ||
      info.buildId !== record.buildId
    ) return null
    const activeTurnCount = parseActiveTurnCount(
      response.headers.get('x-kun-active-turn-count')
    )
    const managerProtocolVersion = parsePositiveIntegerHeader(
      response.headers.get('x-kun-manager-protocol-version')
    )
    return {
      discovery: record,
      info,
      ...(activeTurnCount !== undefined ? { activeTurnCount } : {}),
      ...(managerProtocolVersion !== undefined ? { managerProtocolVersion } : {})
    }
  } catch {
    return null
  }
}

export async function resolveSharedRuntime(
  dataDir: string,
  fetchImpl: typeof fetch = fetch,
  scope: SharedRuntimeScope = {}
): Promise<SharedRuntimeConnection | null> {
  return (await inspectSharedRuntime(dataDir, fetchImpl, scope))?.connection ?? null
}

/**
 * Resolve the discovery owner separately from HTTP health. A live process can
 * temporarily miss HTTP deadlines after system wake or during a synchronous
 * step; callers must not erase its record and elect a second data-dir writer.
 */
export async function inspectSharedRuntime(
  dataDir: string,
  fetchImpl: typeof fetch = fetch,
  scope: SharedRuntimeScope = {}
): Promise<SharedRuntimeInspection | null> {
  const flavor = scope.runtimeFlavor ?? 'production'
  if (scope.manager) {
    const managed = await inspectManagerRuntime(
      dataDir,
      scope.manager,
      flavor,
      fetchImpl
    )
    if (managed) return managed
  }
  const discoveryDir = runtimeDiscoveryDirectory(dataDir, flavor, scope.controlDir)
  const discovery = await readRuntimeDiscovery(discoveryDir, flavor).catch(() => null)
  if (!discovery || !safeDiscoveryUrl(discovery) || !processAlive(discovery.pid)) {
    return null
  }
  return {
    discovery,
    connection: await probeRuntimeDiscovery(discovery, fetchImpl)
  }
}

export async function ensureSharedRuntime(input: {
  dataDir: string
  runtimeFlavor?: RuntimeFlavor
  controlDir?: string
  manager?: ServiceManagerConnection
  expectedBuildId?: string
  /**
   * An explicit user or installer handoff must not reuse a compatible owner.
   * This intentionally permits replacement of an active turn, unlike the
   * ordinary ensure path that preserves it across a build handoff.
   */
  forceReplace?: boolean
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  timeoutMs?: number
  launch?: {
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
    runAsNode?: boolean
  }
}): Promise<SharedRuntimeConnection> {
  const fetchImpl = input.fetch ?? fetch
  const runtimeFlavor = input.runtimeFlavor ?? resolveCliRuntimeFlavor({ env: input.env ?? process.env })
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const discoveryDir = runtimeDiscoveryDirectory(input.dataDir, runtimeFlavor, controlDir)
  const scope = { runtimeFlavor, controlDir, ...(input.manager ? { manager: input.manager } : {}) }
  const sourceBuildId = input.expectedBuildId ?? await readRuntimeBuildIdForEntry(import.meta.url)
  const expectedBuildId = runtimeBuildIdForFlavor(
    sourceBuildId,
    runtimeFlavor
  )
  const existing = await inspectSharedRuntime(input.dataDir, fetchImpl, scope)
  const reusable = input.forceReplace
    ? null
    : reusableRuntimeConnection(existing, expectedBuildId)
  if (reusable) return reusable
  assertRuntimeCanBeReplaced(existing)
  const launch = () => withRuntimeStartLock(discoveryDir, async () => {
    const elected = await inspectSharedRuntime(input.dataDir, fetchImpl, scope)
    const electedReusable = input.forceReplace
      ? null
      : reusableRuntimeConnection(elected, expectedBuildId)
    if (electedReusable) return electedReusable
    assertRuntimeCanBeReplaced(elected)
    if (elected?.connection) {
      await stopInspectedSharedRuntime(input.dataDir, elected, fetchImpl, scope)
    }
    const stale = await readRuntimeDiscovery(discoveryDir, runtimeFlavor).catch(() => null)
    if (stale) {
      await removeSharedRuntimeDiscovery(
        input.dataDir,
        discoveryDir,
        stale.instanceId,
        runtimeFlavor
      )
    }
    // An unmanaged launch has no owner between handover and process start, so
    // every config read/compare/write gets its own bounded writer claim. A
    // managed launch is already Manager-authoritative and must not manufacture
    // a second cross-process claim; Runtime defaults cover a missing config.
    if (!input.manager) {
      await withRuntimeDataDirConfigWriter(
        input.dataDir,
        () => prepareFreshSharedRuntimeCapabilities(input.dataDir)
      )
    }

    const prepareLog = async (): Promise<{ logPath: string; logFd: number }> => {
      const logsDir = join(input.dataDir, 'logs')
      await mkdir(logsDir, { recursive: true, mode: 0o700 })
      const logPath = join(
        logsDir,
        runtimeFlavor === 'development' ? 'runtime.development.log' : 'runtime.log'
      )
      await rotateLog(logPath)
      return { logPath, logFd: openSync(logPath, 'a', 0o600) }
    }
    const { logPath, logFd } = await prepareLog()
    const runtimeToken = randomBytes(32).toString('base64url')
    const entry = fileURLToPath(new URL('./serve-entry.js', import.meta.url))
    const packagedRuntimeExecutable = input.launch
      ? undefined
      : process.env.KUN_PACKAGED_RUNTIME_EXECUTABLE?.trim()
    const command = input.launch?.command ?? packagedRuntimeExecutable ?? process.execPath
    const args = input.launch?.args ?? [
      entry,
      'serve',
      '--host', '127.0.0.1',
      '--port', '0',
      '--data-dir', input.dataDir
    ]
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(input.env ?? {}),
      ...(input.launch?.env ?? {}),
      KUN_RUNTIME_TOKEN: runtimeToken,
      KUN_RUNTIME_LAUNCH_MODE: 'shared',
      KUN_RUNTIME_FLAVOR: runtimeFlavor,
      KUN_RUNTIME_DISCOVERY_DIR: discoveryDir,
      KUN_RUNTIME_LOG_PATH: logPath,
      ...(input.manager
        ? {
            KUN_MANAGER_CONTROL_DIR: controlDir,
            KUN_MANAGER_BASE_URL: input.manager.discovery.baseUrl,
            KUN_MANAGER_INSTANCE_ID: input.manager.discovery.instanceId,
            KUN_MANAGER_TOKEN: input.manager.discovery.managerToken,
            KUN_MANAGER_DATA_DIR: input.manager.discovery.dataDir,
            KUN_MANAGER_SETTINGS_PATH: input.manager.discovery.settingsPath
          }
        : {}),
      ...(sourceBuildId ? { KUN_RUNTIME_BUILD_ID: sourceBuildId } : {})
    }
    const runAsNode = input.launch?.runAsNode ?? Boolean(
      packagedRuntimeExecutable || process.versions.electron
    )
    if (runAsNode) env.ELECTRON_RUN_AS_NODE = '1'
    else delete env.ELECTRON_RUN_AS_NODE
    let child
    try {
      child = spawn(command, args, {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
        env
      })
      child.unref()
    } finally {
      closeSync(logFd)
    }

    const deadline = Date.now() + (input.timeoutMs ?? START_TIMEOUT_MS)
    while (Date.now() < deadline) {
      const connection = await resolveSharedRuntime(input.dataDir, fetchImpl, scope)
      if (connection && runtimeMatchesExpectedBuild(connection, expectedBuildId)) {
        return connection
      }
      if (child.exitCode !== null) break
      await delay(POLL_MS)
    }
    throw new Error(`Kun shared runtime did not become ready; inspect ${logPath}`)
  }, runtimeFlavor)
  return input.manager
    ? launch()
    : withRuntimeDataDirAncillaryWriter(input.dataDir, launch)
}

function reusableRuntimeConnection(
  inspected: SharedRuntimeInspection | null,
  expectedBuildId: string | undefined
): SharedRuntimeConnection | null {
  const connection = inspected?.connection
  if (!connection) return null
  if (runtimeMatchesExpectedBuild(connection, expectedBuildId)) return connection
  // A build produced while a turn is running must not replace that turn's
  // process. The next ensure after the runtime becomes idle performs the
  // normal graceful build handover.
  return (connection.activeTurnCount ?? 0) > 0 ? connection : null
}

function parseActiveTurnCount(value: string | null): number | undefined {
  return parseNonnegativeIntegerHeader(value)
}

function parsePositiveIntegerHeader(value: string | null): number | undefined {
  const parsed = parseNonnegativeIntegerHeader(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function parseNonnegativeIntegerHeader(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function assertRuntimeCanBeReplaced(
  inspected: SharedRuntimeInspection | null
): void {
  if (!inspected || inspected.connection) return
  throw new Error(
    `Kun shared runtime process ${inspected.discovery.pid} is still alive but is not responding; preserving its discovery record instead of starting a second runtime`
  )
}

export function runtimeMatchesExpectedBuild(
  connection: SharedRuntimeConnection,
  expectedBuildId: string | undefined
): boolean {
  if (!expectedBuildId) return true
  return connection.discovery.buildId === expectedBuildId &&
    connection.info.buildId === expectedBuildId
}

async function prepareFreshSharedRuntimeCapabilities(dataDir: string): Promise<void> {
  const target = join(dataDir, 'config.json')
  let current: Record<string, unknown> = {}
  let newProfile = false
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as unknown
    if (!isRecord(parsed)) return
    current = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      current = {}
      newProfile = true
    } else {
      // Let the normal config loader report malformed or unreadable files.
      return
    }
  }
  const capabilities = isRecord(current.capabilities) ? current.capabilities : {}
  const defaults: Record<string, unknown> = {
    skills: { enabled: true, projectConfigEnabled: true },
    instructions: { enabled: true },
    attachments: { enabled: true },
    memory: { enabled: true },
    subagents: { enabled: true }
  }
  let changed = false
  const nextCapabilities = { ...capabilities }
  for (const [id, value] of Object.entries(defaults)) {
    if (Object.prototype.hasOwnProperty.call(nextCapabilities, id)) continue
    nextCapabilities[id] = value
    changed = true
  }
  if (!changed) return
  const next = {
    ...current,
    ...(newProfile
      ? {
          serve: {
            approvalPolicy: DEFAULT_FRESH_SERVE_PERMISSIONS.approvalPolicy,
            sandboxMode: DEFAULT_FRESH_SERVE_PERMISSIONS.sandboxMode,
            approvalReviewer: DEFAULT_FRESH_SERVE_PERMISSIONS.approvalReviewer
          }
        }
      : {}),
    capabilities: nextCapabilities
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}.shared.tmp`
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(temporary, 0o600).catch(() => undefined)
  await rename(temporary, target)
  await chmod(target, 0o600).catch(() => undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function removeSharedRuntimeDiscovery(
  dataDir: string,
  discoveryDir: string,
  instanceId: string,
  runtimeFlavor: RuntimeFlavor
): Promise<boolean> {
  const remove = () => removeRuntimeDiscovery(
    discoveryDir,
    instanceId,
    runtimeFlavor
  ).catch(() => false)
  return runtimeFlavor === 'production'
    ? withRuntimeDataDirAncillaryWriter(dataDir, remove)
    : remove()
}

export async function stopSharedRuntime(
  dataDir: string,
  fetchImpl: typeof fetch = fetch,
  scope: SharedRuntimeScope = {}
): Promise<boolean> {
  const runtimeFlavor = scope.runtimeFlavor ?? 'production'
  const discoveryDir = runtimeDiscoveryDirectory(dataDir, runtimeFlavor, scope.controlDir)
  const inspected = await inspectSharedRuntime(dataDir, fetchImpl, scope)
  if (!inspected) {
    const stale = await readRuntimeDiscovery(discoveryDir, runtimeFlavor).catch(() => null)
    if (stale && !processAlive(stale.pid)) {
      await removeSharedRuntimeDiscovery(
        dataDir,
        discoveryDir,
        stale.instanceId,
        runtimeFlavor
      )
    }
    return false
  }
  return stopInspectedSharedRuntime(dataDir, inspected, fetchImpl, scope)
}

async function stopInspectedSharedRuntime(
  dataDir: string,
  inspected: SharedRuntimeInspection,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope
): Promise<boolean> {
  const runtimeFlavor = scope.runtimeFlavor ?? 'production'
  const discoveryDir = runtimeDiscoveryDirectory(dataDir, runtimeFlavor, scope.controlDir)
  const record = inspected.discovery
  const live = inspected.connection
  try {
    await requestExactRuntimeShutdown(record, fetchImpl)
  } catch (error) {
    if (live) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Kun shared runtime process ${record.pid} did not accept its authenticated shutdown request; ` +
      `its discovery record was preserved: ${detail}`
    )
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!processAlive(record.pid)) {
      await removeSharedRuntimeDiscovery(
        dataDir,
        discoveryDir,
        record.instanceId,
        runtimeFlavor
      )
      if (scope.manager) {
        await unregisterRuntimeWithManager({
          manager: scope.manager,
          flavor: runtimeFlavor,
          instanceId: record.instanceId,
          fetch: fetchImpl
        })
      }
      return true
    }
    await delay(POLL_MS)
  }
  throw new Error(`timed out waiting for Kun runtime process ${record.pid} to exit`)
}

async function inspectManagerRuntime(
  dataDir: string,
  manager: ServiceManagerConnection,
  flavor: RuntimeFlavor,
  fetchImpl: typeof fetch
): Promise<SharedRuntimeInspection | null> {
  const registration = await readManagerRuntime(manager, flavor, fetchImpl)
  if (!registration) return null
  if (!processAlive(registration.pid)) {
    await unregisterRuntimeWithManager({
      manager,
      flavor,
      instanceId: registration.instanceId,
      fetch: fetchImpl
    })
    return null
  }
  const fallback = discoveryFromManagerRegistration(registration)
  return {
    discovery: fallback,
    connection: await probeManagerRuntimeRegistration(
      dataDir,
      registration,
      fetchImpl
    )
  }
}

async function probeManagerRuntimeRegistration(
  dataDir: string,
  registration: RuntimeRegistration,
  fetchImpl: typeof fetch
): Promise<SharedRuntimeConnection | null> {
  const fallback = discoveryFromManagerRegistration(registration)
  if (!safeDiscoveryUrl(fallback) || !processAlive(registration.pid)) return null
  try {
    const response = await fetchImpl(`${registration.baseUrl.replace(/\/$/u, '')}/v1/runtime/info`, {
      headers: registration.runtimeToken
        ? { authorization: `Bearer ${registration.runtimeToken}` }
        : {},
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return null
    const info = RuntimeInfoResponse.parse(await response.json())
    if (
      info.instanceId !== registration.instanceId ||
      info.pid !== registration.pid ||
      info.startedAt !== registration.startedAt ||
      info.buildId !== registration.buildId ||
      !sameCanonicalPath(info.dataDir, dataDir)
    ) return null
    const discovery = discoveryFromManagerRegistration(registration, info)
    const activeTurnCount = parseActiveTurnCount(
      response.headers.get('x-kun-active-turn-count')
    )
    const managerProtocolVersion = parsePositiveIntegerHeader(
      response.headers.get('x-kun-manager-protocol-version')
    )
    return {
      discovery,
      info,
      ...(activeTurnCount !== undefined ? { activeTurnCount } : {}),
      ...(managerProtocolVersion !== undefined ? { managerProtocolVersion } : {})
    }
  } catch {
    return null
  }
}

import {
  delay,
  discoveryFromManagerRegistration,
  processAlive,
  rotateLog,
  runtimeDataDir,
  runtimeDiscoveryDirectory,
  safeDiscoveryUrl
} from './shared-runtime-support.js'
export { runtimeDiscoveryDirectory } from './shared-runtime-support.js'
