import { readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import semver from 'semver'
import { runtimeProcessIsAlive, type RuntimeProcessIsAlive } from '../server/runtime-process-identity.js'
import {
  clearTuiUpdateTransaction,
  parseLockOwner,
  parseTuiUpdateResult,
  parseTuiUpdateTransaction,
  parseTuiUpdateUpdater,
  tuiUpdateLockPath,
  tuiUpdateResultPath,
  tuiUpdateTransactionPath,
  tuiUpdateUpdaterPath,
  writeTuiUpdateResult,
  type TuiUpdateReconcileReport,
  type TuiUpdateTransaction
} from './self-update-transaction.js'
import {
  garbageCollectReleases,
  TUI_RELEASE_METADATA_FILENAME,
  writeStandaloneReleasePointer
} from './self-update-layout.js'

type ReconcileOptions = {
  processIsAlive?: RuntimeProcessIsAlive
}

type StagedRelease = { version: string; buildId: string }

const UPDATE_LOG_HINT =
  ' Details: check update.log in the hidden update directory next to the install.'

async function readStagedRelease(stagingRoot: string): Promise<StagedRelease | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(stagingRoot, 'kun', TUI_RELEASE_METADATA_FILENAME), 'utf8')
    ) as { version?: unknown; buildId?: unknown }
    if (typeof parsed.version !== 'string' || typeof parsed.buildId !== 'string') return null
    return { version: parsed.version, buildId: parsed.buildId }
  } catch {
    return null
  }
}

async function readInstalledRelease(installRoot: string): Promise<StagedRelease | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(installRoot, TUI_RELEASE_METADATA_FILENAME), 'utf8')
    ) as { version?: unknown; buildId?: unknown }
    if (typeof parsed.version !== 'string' || typeof parsed.buildId !== 'string') return null
    return { version: parsed.version, buildId: parsed.buildId }
  } catch {
    return null
  }
}

/**
 * Complete a legacy replacement whose detached script never finished. The staged
 * tree already passed size/hash/entry validation plus a version smoke test, so
 * finishing the same rename swap in-process is safe.
 */
async function rollForwardTuiUpdate(transaction: TuiUpdateTransaction): Promise<void> {
  const { installRoot, stagingRoot, backupRoot } = transaction
  const nextRoot = join(stagingRoot, 'kun')
  const currentExists = await stat(installRoot).then(() => true).catch(() => false)
  const backupExists = await stat(backupRoot).then(() => true).catch(() => false)
  // Only clear an existing backup while the current install is healthy: when
  // the install root is gone, the backup is the only copy of the previous
  // release and must survive a failed activation below.
  if (currentExists && backupExists) {
    await rm(backupRoot, { recursive: true, force: true })
  }
  if (currentExists) await rename(installRoot, backupRoot)
  try {
    await rename(nextRoot, installRoot)
  } catch (error) {
    if (currentExists) await rename(backupRoot, installRoot).catch(() => undefined)
    throw error
  }
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
}

type InstallRecovery = 'present' | 'restored' | 'gone' | 'restore-failed'

/**
 * Ensure the install root exists before a failed legacy update is reported. The
 * backup is only promoted back into place when the install root is missing; it
 * is never deleted here, so a failed recovery can be retried on the next launch
 * without losing the only copy of the previous release.
 */
async function restoreMissingInstall(
  transaction: TuiUpdateTransaction,
  canonical: string
): Promise<InstallRecovery> {
  const installExists = await stat(canonical).then(() => true).catch(() => false)
  if (installExists) return 'present'
  const backupExists = await stat(transaction.backupRoot).then(() => true).catch(() => false)
  if (!backupExists) return 'gone'
  try {
    await rename(transaction.backupRoot, canonical)
    return 'restored'
  } catch {
    return 'restore-failed'
  }
}

function installRecoveryMessage(recovery: InstallRecovery): string {
  if (recovery === 'present') {
    return 'The previous installation was kept; run `kun update --yes` to retry.'
  }
  if (recovery === 'restored') {
    return 'The previous installation was restored from its backup; run `kun update --yes` to retry.'
  }
  if (recovery === 'gone') {
    return 'No usable installation remains; reinstall Kun.'
  }
  return (
    'The previous installation could not be restored; its backup is still in ' +
    'place and recovery will be retried on the next launch.'
  )
}

function isPointerTransaction(transaction: TuiUpdateTransaction): boolean {
  return Boolean(transaction.fromReleaseDir && transaction.toReleaseDir && transaction.pointerPath)
}

async function releaseDirMatches(dir: string, buildId: string, version: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(
      await readFile(join(dir, TUI_RELEASE_METADATA_FILENAME), 'utf8')
    ) as { version?: unknown; buildId?: unknown }
    return parsed.version === version && parsed.buildId === buildId
  } catch {
    return false
  }
}

/** Finish a pointer-layout update: switch the `current` pointer atomically and GC. */
async function reconcilePointerTuiUpdate(
  transaction: TuiUpdateTransaction,
  canonical: string
): Promise<TuiUpdateReconcileReport> {
  const base = dirname(transaction.pointerPath as string)
  const toBuildId = basename(transaction.toReleaseDir as string)
  const fromBuildId = basename(transaction.fromReleaseDir as string)
  const toComplete = await releaseDirMatches(
    transaction.toReleaseDir as string,
    transaction.buildId,
    transaction.targetVersion
  )
  if (toComplete) {
    await writeStandaloneReleasePointer(base, toBuildId)
    await writeTuiUpdateResult(canonical, {
      status: 'succeeded',
      previousVersion: transaction.previousVersion,
      targetVersion: transaction.targetVersion
    })
    await clearTuiUpdateTransaction(canonical)
    await rm(transaction.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    await garbageCollectReleases(base, [toBuildId, fromBuildId]).catch(() => undefined)
    return {
      kind: 'activated',
      previousVersion: transaction.previousVersion,
      targetVersion: transaction.targetVersion
    }
  }
  await writeTuiUpdateResult(canonical, {
    status: 'failed',
    stage: 'replace',
    error: 'the staged release is missing or does not match the target version',
    previousVersion: transaction.previousVersion,
    targetVersion: transaction.targetVersion
  }).catch(() => undefined)
  await clearTuiUpdateTransaction(canonical)
  await rm(transaction.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  return {
    kind: 'failed',
    stage: 'replace',
    message:
      `the staged update to Kun ${transaction.targetVersion} could not be activated; ` +
      'the previous installation was kept. Run `kun update --yes` to retry.'
  }
}

/**
 * Inspect a pending self-update transaction at launch and reconcile it:
 * report a recorded outcome, finish a staged replacement whose detached
 * script died, or restore the previous install. Returns null when there is
 * nothing pending, and `busy` while a live process still owns the update.
 */
export async function reconcilePendingTuiUpdate(
  installRoot: string,
  options: ReconcileOptions = {}
): Promise<TuiUpdateReconcileReport | null> {
  const canonical = resolve(installRoot)
  const processIsAlive = options.processIsAlive ?? runtimeProcessIsAlive
  let transaction: TuiUpdateTransaction | null = null
  try {
    transaction = parseTuiUpdateTransaction(
      await readFile(tuiUpdateTransactionPath(canonical), 'utf8')
    )
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null
    throw error
  }
  if (!transaction) {
    // Corrupt transaction metadata: never touch the install automatically.
    await clearTuiUpdateTransaction(canonical)
    return {
      kind: 'failed',
      stage: 'transaction',
      message: 'the pending update record was unreadable; the installation was left unchanged'
    }
  }
  const resultRaw = await readFile(tuiUpdateResultPath(canonical), 'utf8')
    .catch((error: unknown) => {
      if (isErrno(error, 'ENOENT')) return null
      throw error
    })
  if (resultRaw !== null) {
    const result = parseTuiUpdateResult(resultRaw)
    if (!result) {
      await clearTuiUpdateTransaction(canonical)
      return {
        kind: 'failed',
        stage: 'result',
        message: 'the update result record was unreadable; check update.log next to the install'
      }
    }
    if (result.status === 'succeeded') {
      await clearTuiUpdateTransaction(canonical)
      await rm(transaction.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      return {
        kind: 'activated',
        previousVersion: result.previousVersion,
        targetVersion: result.targetVersion
      }
    }
    if (isPointerTransaction(transaction)) {
      return reconcilePointerTuiUpdate(transaction, canonical)
    }
    const recovery = await restoreMissingInstall(transaction, canonical)
    if (recovery === 'restore-failed') {
      return {
        kind: 'failed',
        stage: result.stage,
        message:
          `the staged update to Kun ${result.targetVersion} failed` +
          `${result.stage ? ` during ${result.stage}` : ''}` +
          `${result.error ? `: ${result.error}` : ''}. ` +
          installRecoveryMessage(recovery) +
          UPDATE_LOG_HINT
      }
    }
    await clearTuiUpdateTransaction(canonical)
    return {
      kind: 'failed',
      stage: result.stage,
      message:
        `the staged update to Kun ${result.targetVersion} failed` +
        `${result.stage ? ` during ${result.stage}` : ''}` +
        `${result.error ? `: ${result.error}` : ''}. ` +
        installRecoveryMessage(recovery) +
        UPDATE_LOG_HINT
    }
  }
  // No result yet: either the replacement is still running or it died.
  const lockOwner = parseLockOwner(
    await readFile(tuiUpdateLockPath(canonical), 'utf8').catch(() => '')
  )
  if (lockOwner && processIsAlive(lockOwner.pid, lockOwner)) {
    return { kind: 'busy', pid: lockOwner.pid }
  }
  const updater = parseTuiUpdateUpdater(
    await readFile(tuiUpdateUpdaterPath(canonical), 'utf8').catch(() => '')
  )
  if (updater && processIsAlive(updater.pid, updater)) {
    return { kind: 'busy', pid: updater.pid }
  }
  if (isPointerTransaction(transaction)) {
    return reconcilePointerTuiUpdate(transaction, canonical)
  }
  // A detached legacy swap may have completed but lost its result write (for
  // example a torn write after a successful activation). If the installed
  // release already matches the transaction, report the activation instead of
  // an interruption.
  const installed = await readInstalledRelease(canonical)
  if (
    installed &&
    installed.version === transaction.targetVersion &&
    installed.buildId === transaction.buildId
  ) {
    await clearTuiUpdateTransaction(canonical)
    await rm(transaction.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    return {
      kind: 'activated',
      previousVersion: transaction.previousVersion,
      targetVersion: transaction.targetVersion
    }
  }
  const staged = await readStagedRelease(transaction.stagingRoot)
  if (
    staged &&
    staged.version === transaction.targetVersion &&
    staged.buildId === transaction.buildId
  ) {
    try {
      await rollForwardTuiUpdate(transaction)
      await writeTuiUpdateResult(canonical, {
        status: 'succeeded',
        previousVersion: transaction.previousVersion,
        targetVersion: transaction.targetVersion
      })
      await clearTuiUpdateTransaction(canonical)
      return {
        kind: 'activated',
        previousVersion: transaction.previousVersion,
        targetVersion: transaction.targetVersion
      }
    } catch (error) {
      const recovery = await restoreMissingInstall(transaction, canonical)
      if (recovery === 'restore-failed') {
        return {
          kind: 'failed',
          stage: 'replace',
          message:
            `the staged update to Kun ${transaction.targetVersion} could not be activated ` +
            `(${error instanceof Error ? error.message : String(error)}). ` +
            installRecoveryMessage(recovery)
        }
      }
      await writeTuiUpdateResult(canonical, {
        status: 'failed',
        stage: 'replace',
        error: 'could not move the staged release into place',
        previousVersion: transaction.previousVersion,
        targetVersion: transaction.targetVersion
      }).catch(() => undefined)
      await clearTuiUpdateTransaction(canonical)
      return {
        kind: 'failed',
        stage: 'replace',
        message:
          `the staged update to Kun ${transaction.targetVersion} could not be activated ` +
          `(${error instanceof Error ? error.message : String(error)}). ` +
          installRecoveryMessage(recovery)
      }
    }
  }
  // Staging is gone or does not match: restore the backup when the install root
  // itself is missing, then report the failure.
  const recovery = await restoreMissingInstall(transaction, canonical)
  if (recovery === 'restore-failed') {
    return {
      kind: 'failed',
      stage: 'staging',
      message:
        `the staged update to Kun ${transaction.targetVersion} was interrupted before it could run. ` +
        installRecoveryMessage(recovery)
    }
  }
  await clearTuiUpdateTransaction(canonical)
  const stagingMessage =
    recovery === 'restored'
      ? 'The previous installation was restored from its backup. '
      : recovery === 'present'
        ? 'The current installation was left unchanged. '
        : 'No usable installation remains; reinstall Kun. '
  return {
    kind: 'failed',
    stage: 'staging',
    message:
      `the staged update to Kun ${transaction.targetVersion} was interrupted before it could run. ` +
      stagingMessage +
      'Run `kun update --yes` to retry.'
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}
