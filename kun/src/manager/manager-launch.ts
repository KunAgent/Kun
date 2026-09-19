import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { KUN_APP_SESSION_OWNER_ENV, KUN_APP_SESSION_RESERVATION_ENV, type AppSessionOwner } from '../contracts/app-session-owner.js'
import { spawnOwnedProcess } from '../process/owned-process.js'

export type ManagerLaunchOverride = {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  runAsNode?: boolean
}

export async function launchServiceManagerProcess(input: {
  controlDir: string
  dataDir: string
  settingsPath: string
  buildId?: string
  launch?: ManagerLaunchOverride
  appOwner?: AppSessionOwner
  reservationPath?: string
}): Promise<{ child: ChildProcess; logPath: string }> {
  await mkdir(input.controlDir, { recursive: true, mode: 0o700 })
  const logPath = join(input.controlDir, 'manager.log')
  const logFd = openSync(logPath, 'a', 0o600)
  const managerToken = randomBytes(32).toString('base64url')
  const instanceId = randomUUID()
  const entry = fileURLToPath(new URL('./manager-entry.js', import.meta.url))
  const command = input.launch?.command ?? process.execPath
  const args = input.launch?.args ?? [entry]
  const runAsNode = input.launch?.runAsNode ?? Boolean(process.versions.electron)
  let child: ChildProcess
  try {
    const options = {
      detached: !input.appOwner,
      windowsHide: true,
      stdio: input.appOwner ? ['ignore', logFd, logFd, 'ipc'] as const : ['ignore', logFd, logFd] as const,
      env: {
        ...process.env,
        ...(input.launch?.env ?? {}),
        ...(runAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        // A replacement Manager is the physical owner and must never proxy
        // its AtomicJsonFile operations to its predecessor (or itself).
        KUN_MANAGER_BASE_URL: '',
        KUN_MANAGER_CONTROL_DIR: input.controlDir,
        KUN_MANAGER_TOKEN: managerToken,
        KUN_MANAGER_INSTANCE_ID: instanceId,
        ...(input.buildId ? { KUN_RUNTIME_BUILD_ID: input.buildId } : {}),
        KUN_MANAGER_DATA_DIR: input.dataDir,
        KUN_MANAGER_SETTINGS_PATH: input.settingsPath,
        KUN_MANAGER_LOG_PATH: logPath,
        ...(input.appOwner ? { [KUN_APP_SESSION_OWNER_ENV]: JSON.stringify(input.appOwner) } : {}),
        ...(input.reservationPath ? { [KUN_APP_SESSION_RESERVATION_ENV]: input.reservationPath } : {})
      }
    }
    child = input.appOwner
      ? await spawnOwnedProcess(command, args, { ...options, stdio: [...options.stdio], ownerLossGraceMs: 30_000 })
      : spawn(command, args, { ...options, stdio: [...options.stdio] })
    if (!input.appOwner) child.unref()
  } finally {
    closeSync(logFd)
  }
  return { child, logPath }
}
