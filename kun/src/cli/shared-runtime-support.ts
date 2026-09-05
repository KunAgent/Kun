import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
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
import { maintainLiveProcessLog } from './live-process-log.js'

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

export function discoveryFromManagerRegistration(
  registration: RuntimeRegistration,
  info?: RuntimeInfo
): RuntimeDiscoveryRecord {
  return createRuntimeDiscoveryRecord({
    instanceId: registration.instanceId,
    pid: registration.pid,
    startedAt: registration.startedAt,
    host: registration.host,
    port: registration.port,
    baseUrl: registration.baseUrl,
    runtimeToken: registration.runtimeToken,
    ...(registration.clientOwnerKind ? { clientOwnerKind: registration.clientOwnerKind } : {}),
    insecure: info?.insecure ?? false,
    ...(info ? { serviceVersion: info.serviceVersion } : {}),
    flavor: registration.flavor,
    ...(registration.buildId ? { buildId: registration.buildId } : {}),
    launchMode: info?.launchMode ?? 'shared',
    ...(registration.logPath ? { logPath: registration.logPath } : {})
  })
}

export function runtimeDiscoveryDirectory(
  dataDir: string,
  flavor: RuntimeFlavor,
  controlDir = defaultKunControlDir()
): string {
  return flavor === 'production' ? dataDir : controlDir
}

export function safeDiscoveryUrl(record: RuntimeDiscoveryRecord): boolean {
  try {
    const url = new URL(record.baseUrl)
    return url.protocol === 'http:' &&
      isLoopbackHost(url.hostname) &&
      (url.pathname === '/' || url.pathname === '') &&
      url.username === '' &&
      url.password === '' &&
      Number(url.port || '80') === record.port &&
      isLoopbackHost(record.host)
  } catch {
    return false
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return String((error as { code?: unknown })?.code ?? '') === 'EPERM'
  }
}

export async function rotateLog(logPath: string): Promise<void> {
  maintainLiveProcessLog(logPath)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function runtimeDataDir(
  argv: readonly string[],
  env: Record<string, string | undefined>
): { ok: true; dataDir: string; source: 'argument' | 'environment' | 'default' } | { ok: false; message: string } {
  const environmentDataDir = env.KUN_DATA_DIR?.trim()
  let dataDir = environmentDataDir || join(homedir(), '.kun', 'data')
  let source: 'argument' | 'environment' | 'default' = environmentDataDir ? 'environment' : 'default'
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--data-dir') return { ok: false, message: `unknown option: ${argv[index]}` }
    const value = argv[++index]?.trim()
    if (!value) return { ok: false, message: 'missing value for --data-dir' }
    dataDir = value
    source = 'argument'
  }
  return { ok: true, dataDir, source }
}
