import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallerRecoveryEnvironment } from './gui-updater-pending'
import {
  clearGuiUpdateRecovery,
  clearPendingUpdate,
  clearPendingUpdateResult,
  cleanupPendingUpdateBackup
} from './gui-updater-pending'

export type UpdateTransactionHelperDeps = {
  platform: NodeJS.Platform
  isPackaged: () => boolean
  resourcesPath: () => string
  cwd: () => string
  run: (scriptPath: string, action: 'RecoverUpdateTransaction' | 'FinalizeUpdateTransaction', environment: InstallerRecoveryEnvironment) => Promise<void>
  scheduleRollback: (scriptPath: string, environment: InstallerRecoveryEnvironment, pid: number) => Promise<void>
}

const defaultDeps: UpdateTransactionHelperDeps = {
  platform: process.platform,
  isPackaged: () => app.isPackaged,
  resourcesPath: () => process.resourcesPath,
  cwd: () => process.cwd(),
  run: (scriptPath, action, environment) => new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', action], {
      windowsHide: true,
      env: { ...process.env, ...environment }
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Update transaction ${action} exited with ${code}.`)))
  }),
  scheduleRollback: (scriptPath, environment, pid) => new Promise((resolve, reject) => {
    const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64')
    const assignments = Object.entries(environment).map(([key, value]) =>
      `$env:${key}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(value)}'))`
    )
    const command = [
      `$script=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(scriptPath)}'))`,
      `$waitPid=${pid}`,
      ...assignments,
      'Wait-Process -Id $waitPid -ErrorAction SilentlyContinue',
      '& $script -Action RecoverUpdateTransaction',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      '$exe=((& $script -Action ResolveRecoveryExecutable | Select-Object -Last 1).Trim())',
      'if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($exe)) { exit 1 }',
      '& $script -Action FinalizeUpdateTransaction',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      'Start-Process -FilePath $exe'
    ].join('; ')
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    const elevated = environment.KUN_INSTALLER_INSTALL_MODE === 'all'
    const args = elevated
      ? ['-NoProfile', '-Command', `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`]
      : ['-NoProfile', '-EncodedCommand', encoded]
    const child = spawn('powershell.exe', args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

async function resolveScript(deps: UpdateTransactionHelperDeps): Promise<string> {
  const root = deps.isPackaged() ? join(deps.resourcesPath(), 'installer-recovery') : join(deps.cwd(), 'build')
  const script = join(root, 'windows-installer-migration.ps1')
  await access(script)
  return script
}

export async function runUpdateTransactionHelper(
  action: 'RecoverUpdateTransaction' | 'FinalizeUpdateTransaction',
  environment: InstallerRecoveryEnvironment,
  deps: UpdateTransactionHelperDeps = defaultDeps
): Promise<void> {
  if (deps.platform !== 'win32') return
  await deps.run(await resolveScript(deps), action, environment)
}

export async function scheduleUpdateRollbackAfterExit(
  environment: InstallerRecoveryEnvironment,
  pid = process.pid,
  deps: UpdateTransactionHelperDeps = defaultDeps
): Promise<void> {
  if (deps.platform !== 'win32') return
  await deps.scheduleRollback(await resolveScript(deps), environment, pid)
}

export type FinalizeUpdateTransactionOutcome =
  | { kind: 'finalized', phase: string }
  | { kind: 'already-finalized', phase: string }
  | { kind: 'unconfirmed', reason: string }

/**
 * Read the installer-owned transaction file to confirm its terminal phase.
 * Returns null when the file is missing or unreadable; callers treat that as
 * "unconfirmed" and keep every recovery artifact.
 */
async function readTransactionPhase(
  environment: InstallerRecoveryEnvironment
): Promise<string | null> {
  const transactionPath = environment.KUN_INSTALLER_TRANSACTION
  if (!transactionPath) return null
  try {
    const value = JSON.parse(await readFile(transactionPath, 'utf8')) as Record<string, unknown>
    return typeof value.Phase === 'string' ? value.Phase : null
  } catch {
    return null
  }
}

/**
 * Unified transaction termination: finalize the PowerShell transaction, then
 * clean GUI records only after the transaction file confirms a terminal state
 * that authorizes backup deletion. Any failure keeps every recovery artifact
 * so the update can still be rolled back or retried later.
 */
export async function finalizeUpdateTransactionAndCleanup(
  input: {
    environment: InstallerRecoveryEnvironment
    backupDir?: string
  },
  deps: {
    platform?: NodeJS.Platform
    runHelper?: typeof runUpdateTransactionHelper
    cleanupBackup?: (backupDir?: string) => Promise<void>
    clearRecords?: () => Promise<void>
  } = {}
): Promise<FinalizeUpdateTransactionOutcome> {
  const platform = deps.platform ?? process.platform
  const runHelper = deps.runHelper ?? runUpdateTransactionHelper
  const cleanupBackup = deps.cleanupBackup ?? cleanupPendingUpdateBackup
  const clearRecords = deps.clearRecords ?? (async () => {
    await clearPendingUpdateResult()
    await clearPendingUpdate()
    await clearGuiUpdateRecovery()
  })

  if (platform !== 'win32') {
    await clearRecords()
    return { kind: 'finalized', phase: 'skipped-non-windows' }
  }

  const before = await readTransactionPhase(input.environment)
  if (before === null && input.environment.KUN_INSTALLER_TRANSACTION) {
    // No transaction file at all: nothing the installer owns can block a new
    // update, so converging the GUI records is safe.
    await clearRecords()
    return { kind: 'already-finalized', phase: 'missing' }
  }
  if (before === 'rolled_back' || before === 'finalizing') {
    // Terminal states that no longer need a finalize round-trip. The payload
    // backup is only removed when the state authorizes it (rolled_back);
    // finalizing still owns artifacts a repeated finalize must clean up.
    if (before === 'rolled_back') {
      await cleanupBackup(input.backupDir).catch(() => undefined)
    }
    await clearRecords()
    return { kind: 'already-finalized', phase: before }
  }

  try {
    await runHelper('FinalizeUpdateTransaction', input.environment)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind: 'unconfirmed', reason }
  }

  // FinalizeUpdateTransaction deletes the transaction file on success, so a
  // missing file after a successful helper run is the confirmation signal.
  const after = await readTransactionPhase(input.environment)
  if (after !== null) {
    return {
      kind: 'unconfirmed',
      reason: `transaction file still reports phase ${after} after finalize`
    }
  }
  await cleanupBackup(input.backupDir).catch(() => undefined)
  await clearRecords()
  return { kind: 'finalized', phase: 'finalized' }
}
