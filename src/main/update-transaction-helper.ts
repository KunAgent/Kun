import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { openUpdateRollbackReadiness, powershellCaptureGuiProcess, powershellRollbackReadiness, powershellWaitForGuiExit } from './update-rollback-readiness'
import { access, readFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { encodePowershellCommand, ONE_SHOT_HELPER_TIMEOUT_SECONDS, powershellHelperDeadline } from './one-shot-helper-script'
import { isUpdateTransactionState, type UpdateTransactionState } from './update-transaction-states'
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
  run: runBoundedUpdateTransaction,
  scheduleRollback: scheduleBoundedUpdateRollback
}

export function runBoundedUpdateTransaction(
  scriptPath: string,
  action: 'RecoverUpdateTransaction' | 'FinalizeUpdateTransaction',
  environment: InstallerRecoveryEnvironment,
  spawnHelper: typeof spawn = spawn
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = `${powershellHelperDeadline()}\n& '${scriptPath.replace(/'/gu, "''")}' -Action ${action}\nexit $LASTEXITCODE`
    const child = spawnHelper('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowershellCommand(command)], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: (ONE_SHOT_HELPER_TIMEOUT_SECONDS + 10) * 1_000,
      env: { ...process.env, ...environment }
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Update transaction ${action} exited with ${code}.`)))
  })
}

export async function scheduleBoundedUpdateRollback(
  scriptPath: string,
  environment: InstallerRecoveryEnvironment,
  pid: number,
  spawnHelper: typeof spawn = spawn
): Promise<void> {
  const readiness = openUpdateRollbackReadiness()
  let child: ChildProcess | undefined
  try {
    await readiness.listening
    const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64')
    const assignments = Object.entries(environment).map(([key, value]) =>
      `$env:${key}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(value)}'))`
    )
    const command = `${powershellHelperDeadline()}\n` + [
      `$script=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(scriptPath)}'))`,
      `$waitPid=${pid}`,
      "$powershell=Join-Path $PSHOME 'powershell.exe'",
      ...assignments,
      // Actions use exit, so each runs in a native child:
      // its status/output cannot terminate or bypass the coordinator.
      '& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action ValidateUpdateRollback -Bounded',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      ...powershellCaptureGuiProcess(),
      ...powershellRollbackReadiness(readiness.pipeName, readiness.token),
      powershellWaitForGuiExit(),
      '& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action RecoverUpdateTransaction -Bounded',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      '$resultPath=[IO.Path]::GetTempFileName()',
      [
        'try {',
        '  & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action ResolveRecoveryExecutable -Bounded -ResultPath $resultPath | Out-Null',
        '  if ($LASTEXITCODE -ne 0) { throw "Recovery executable resolution failed." }',
        '  $exe=[IO.File]::ReadAllText($resultPath, [Text.Encoding]::Unicode).Trim()',
        '} finally { Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue }'
      ].join('\n'),
      'if ([string]::IsNullOrWhiteSpace($exe)) { exit 1 }',
      '& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action FinalizeUpdateTransaction -Bounded',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      'Start-Process -FilePath $exe -ErrorAction Stop',
      'exit 0'
    ].join('; ')
    const encoded = encodePowershellCommand(command)
    const elevated = environment.KUN_INSTALLER_INSTALL_MODE?.toLowerCase() === 'all'
    const powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // libuv's detached flag uses DETACHED_PROCESS, which makes Windows
    // PowerShell exit before executing its command (nodejs/node#51018).
    // Start-Process supplies an independent hidden console instead. Its child
    // survives this short-lived bootstrap and the GUI; only readiness permits quit.
    const bootstrap = `${powershellHelperDeadline()}\n` + [
      `$coordinator=Start-Process -FilePath '${powershell.replace(/'/gu, "''")}'${elevated ? ' -Verb RunAs' : ''} -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}' -ErrorAction Stop`,
      '$null=$coordinator.Handle',
      '$coordinator.WaitForExit()',
      '$exitCode=$coordinator.ExitCode',
      'if ($null -eq $exitCode) { exit 1 }',
      'exit $exitCode'
    ].join('\n')
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', bootstrap]
    child = spawnHelper(powershell, args, { detached: false, stdio: 'ignore', windowsHide: true })
    child.once('error', readiness.cancel)
    child.once('exit', (code) => {
      // The bootstrap waits for the actual coordinator, including after UAC.
      // Even exit zero cannot replace that coordinator's readiness handshake.
      readiness.cancel(new Error(`Update rollback launcher exited with ${code} before readiness.`))
    })
    await readiness.ready
    child.unref()
  } catch (error) {
    readiness.cancel(error instanceof Error ? error : new Error(String(error)))
    child?.kill()
    throw error
  } finally {
    readiness.dispose()
  }
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

type TransactionRead =
  | { kind: 'missing' }
  | { kind: 'present', phase: UpdateTransactionState }
  | { kind: 'unconfirmed', reason: string }

/** Only ENOENT proves absence. Invalid or unreadable state never permits cleanup. */
async function readTransactionPhase(
  environment: InstallerRecoveryEnvironment
): Promise<TransactionRead> {
  const transactionPath = environment.KUN_INSTALLER_TRANSACTION
  if (!transactionPath) return { kind: 'unconfirmed', reason: 'Transaction path is not configured.' }
  let raw: string
  try {
    raw = await readFile(transactionPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unconfirmed', reason: `Cannot read transaction: ${String(error)}` }
  }
  try {
    // Windows PowerShell 5 writes Set-Content -Encoding UTF8 with a BOM.
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ''))
    const phase = value && typeof value === 'object' && 'Phase' in value ? value.Phase : undefined
    if (!isUpdateTransactionState(phase)) return { kind: 'unconfirmed', reason: 'Invalid transaction phase.' }
    return { kind: 'present', phase }
  } catch (error) {
    return { kind: 'unconfirmed', reason: `Cannot parse transaction: ${String(error)}` }
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
  if (before.kind === 'unconfirmed') return before
  if (before.kind === 'missing') {
    await clearRecords()
    return { kind: 'already-finalized', phase: 'missing' }
  }
  // Even rolled_back and finalizing still own cleanup work. Resume the
  // idempotent helper and keep GUI recovery until the transaction is removed.

  try {
    await runHelper('FinalizeUpdateTransaction', input.environment)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind: 'unconfirmed', reason }
  }

  // FinalizeUpdateTransaction deletes the transaction file on success, so a
  // missing file after a successful helper run is the confirmation signal.
  const after = await readTransactionPhase(input.environment)
  if (after.kind === 'unconfirmed') return after
  if (after.kind === 'present') {
    return {
      kind: 'unconfirmed',
      reason: `transaction file still reports phase ${after.phase} after finalize`
    }
  }
  await cleanupBackup(input.backupDir).catch(() => undefined)
  await clearRecords()
  return { kind: 'finalized', phase: 'finalized' }
}
