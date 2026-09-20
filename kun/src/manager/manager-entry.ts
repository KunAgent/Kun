#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import process from 'node:process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  defaultKunControlDir,
  defaultProductionSettingsPath
} from './manager-discovery.js'
import { startServiceManager } from './service-manager.js'
import { RuntimeBuildIdSchema } from '../contracts/runtime-info.js'
import { installLiveProcessLog } from '../cli/live-process-log.js'
import { appSessionOwnerFromEnvironment, KUN_APP_SESSION_RESERVATION_ENV } from '../contracts/app-session-owner.js'
import { drainManagerAfterOwnerLoss, monitorManagerOwner } from './manager-owner-channel.js'

export const KUN_MANAGER_READY_PREFIX = 'KUN_MANAGER_READY '

export function isolateManagerDataOwnerEnvironment(
  env: NodeJS.ProcessEnv = process.env
): void {
  delete env.KUN_MANAGER_BASE_URL
}

export async function main(): Promise<number> {
  // Listen before any asynchronous startup or store construction. The parent
  // grants startup only after the process is recorded in its profile reservation.
  const appOwner = appSessionOwnerFromEnvironment()
  const ownerMonitor = appOwner ? monitorManagerOwner(appOwner) : undefined
  if (ownerMonitor && !await ownerMonitor.startGranted) { ownerMonitor.dispose(); return 0 }
  // A runtime recovering from a failed manager already has client connection
  // variables in its environment. The replacement manager must never inherit
  // KUN_MANAGER_BASE_URL and route its own AtomicJsonFile access back through
  // the dead predecessor (or itself); it is the physical data owner.
  isolateManagerDataOwnerEnvironment()
  const controlDir = process.env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  const managerToken = process.env.KUN_MANAGER_TOKEN?.trim() || randomBytes(32).toString('base64url')
  const instanceId = process.env.KUN_MANAGER_INSTANCE_ID?.trim() || randomUUID()
  const startedAt = new Date().toISOString()
  const dataDir = process.env.KUN_MANAGER_DATA_DIR?.trim() || join(homedir(), '.kun', 'data')
  const settingsPath = process.env.KUN_MANAGER_SETTINGS_PATH?.trim() || defaultProductionSettingsPath()
  const buildId = RuntimeBuildIdSchema.safeParse(process.env.KUN_RUNTIME_BUILD_ID?.trim())
  const handle = await startServiceManager({
    controlDir,
    managerToken,
    instanceId,
    startedAt,
    ...(buildId.success ? { buildId: buildId.data } : {}),
    dataDir,
    settingsPath,
    ...(appOwner ? { appOwner, reservationPath: process.env[KUN_APP_SESSION_RESERVATION_ENV] } : {}),
    ...(process.env.KUN_MANAGER_LOG_PATH?.trim()
      ? { logPath: process.env.KUN_MANAGER_LOG_PATH.trim() }
      : {})
  })
  process.title = 'kun-service-manager'
  process.stdout.write(`${KUN_MANAGER_READY_PREFIX}${JSON.stringify({
    pid: process.pid,
    instanceId,
    baseUrl: handle.discovery.baseUrl,
    protocolVersion: handle.discovery.protocolVersion
  })}\n`)
  await new Promise<void>((resolve) => {
    let stopping = false
    const stop = (ownerLost = false) => {
      if (stopping) return
      stopping = true
      handle.beginDrain()
      void (async () => {
        await drainManagerAfterOwnerLoss(handle)
        await handle.close()
      })().then(resolve, (error) => {
        process.stderr.write(`kun Manager cleanup failed: ${String(error)}\n`)
        // A live consumer must not lose its writer because cleanup timed out.
        // The independent guard remains responsible for the final crash cutoff.
        if (!ownerLost) resolve()
      })
    }
    process.once('SIGTERM', () => stop(false))
    process.once('SIGINT', () => stop(false))
    void handle.shutdownRequested.then(() => stop(false))
    if (ownerMonitor) {
      void ownerMonitor.disconnected.then(() => stop(true))
      void ownerMonitor.stopRequested.then(() => stop(false))
    }
  })
  ownerMonitor?.dispose()
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const liveLog = process.env.KUN_MANAGER_LOG_PATH?.trim()
    ? installLiveProcessLog({ logPath: process.env.KUN_MANAGER_LOG_PATH.trim() })
    : undefined
  main().finally(() => liveLog?.close()).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`kun service manager: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      process.exit(70)
    }
  )
}
