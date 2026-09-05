import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireTuiUpdateLock,
  clearTuiUpdateTransaction,
  parseTuiUpdateUpdater,
  recordTuiUpdateUpdater,
  tuiUpdateLockPath,
  tuiUpdateLogPath,
  tuiUpdateResultPath,
  tuiUpdateTransactionDir,
  tuiUpdateTransactionPath,
  tuiUpdateUpdaterPath,
  writeTuiUpdateResult,
  writeTuiUpdateTransaction,
  type TuiUpdateTransaction
} from './self-update-transaction.js'
import { reconcilePendingTuiUpdate } from './self-update-reconcile.js'

const renameFailure = vi.hoisted(() => ({
  source: '' as string,
  destination: '' as string
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (
      from: Parameters<typeof actual.rename>[0],
      to: Parameters<typeof actual.rename>[1]
    ): Promise<void> => {
      const sourceMatches =
        renameFailure.source !== '' && resolve(String(from)) === renameFailure.source
      const destinationMatches =
        renameFailure.destination !== '' && resolve(String(to)) === renameFailure.destination
      if (sourceMatches || destinationMatches) {
        throw new Error('simulated rename failure')
      }
      return actual.rename(from, to)
    }
  }
})

const roots: string[] = []
const BUILD_ID = 'a'.repeat(64)

afterEach(async () => {
  renameFailure.source = ''
  renameFailure.destination = ''
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function installRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'kun-update-tx-test-'))
  roots.push(parent)
  const root = join(parent, 'kun')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'release.json'), '{"version":"1.2.3"}\n', 'utf8')
  return root
}

function transactionInput(root: string) {
  return {
    previousVersion: '1.2.3',
    targetVersion: '1.2.4',
    buildId: BUILD_ID,
    stagingRoot: join(root, '..', '.kun-update-staged'),
    backupRoot: `${root}.previous`
  }
}

async function stagedRelease(transaction: TuiUpdateTransaction): Promise<void> {
  const nextRoot = join(transaction.stagingRoot, 'kun')
  await mkdir(nextRoot, { recursive: true })
  await writeFile(
    join(nextRoot, 'release.json'),
    JSON.stringify({ version: transaction.targetVersion, buildId: transaction.buildId }),
    'utf8'
  )
}

describe('TUI update lock', () => {
  it('rejects a second acquisition while the holder is alive', async () => {
    const root = await installRoot()
    const first = await acquireTuiUpdateLock(root)
    await expect(acquireTuiUpdateLock(root)).rejects.toThrow(/already running in process/)
    await first.release()
    const second = await acquireTuiUpdateLock(root)
    await second.release()
  })

  it('reclaims the lock after the holder released it', async () => {
    const root = await installRoot()
    const first = await acquireTuiUpdateLock(root)
    await first.release()
    const second = await acquireTuiUpdateLock(root)
    await second.release()
    await expect(stat(tuiUpdateLockPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reclaims a lock whose recorded owner is dead', async () => {
    const root = await installRoot()
    const first = await acquireTuiUpdateLock(root, { processIsAlive: () => true })
    // Simulate owner death without releasing: a new contender observes a dead
    // owner through its own liveness probe and reclaims the file.
    const second = await acquireTuiUpdateLock(root, { processIsAlive: () => false })
    await first.release().catch(() => undefined)
    await second.release()
  })
})

describe('pending TUI update reconciliation', () => {
  it('returns null when nothing is pending', async () => {
    const root = await installRoot()
    await expect(reconcilePendingTuiUpdate(root)).resolves.toBeNull()
  })

  it('reports a recorded success and cleans the transaction', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await writeTuiUpdateResult(root, {
      status: 'succeeded',
      previousVersion: '1.2.3',
      targetVersion: '1.2.4'
    })
    await writeFile(tuiUpdateLogPath(root), 'log line\n', 'utf8')
    const report = await reconcilePendingTuiUpdate(root)
    expect(report).toEqual({ kind: 'activated', previousVersion: '1.2.3', targetVersion: '1.2.4' })
    // Log kept for diagnostics; metadata removed.
    expect((await readFile(tuiUpdateLogPath(root), 'utf8'))).toContain('log line')
    await expect(stat(tuiUpdateResultPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(transaction.installRoot).toBe(root)
  })

  it('reports a recorded failure and keeps the log', async () => {
    const root = await installRoot()
    await writeTuiUpdateTransaction(root, transactionInput(root))
    await writeTuiUpdateResult(root, {
      status: 'failed',
      stage: 'swap',
      error: 'IOException: <install> is locked',
      previousVersion: '1.2.3',
      targetVersion: '1.2.4'
    })
    const report = await reconcilePendingTuiUpdate(root)
    expect(report?.kind).toBe('failed')
    const message = report && 'message' in report ? report.message : ''
    expect(message).toContain('during swap')
    expect(message).toContain('kun update --yes')
    expect(message).toContain('update.log')
    expect(message).not.toContain(root)
  })

  it('stays silent while a live process owns the pending update', async () => {
    const root = await installRoot()
    await writeTuiUpdateTransaction(root, transactionInput(root))
    await acquireTuiUpdateLock(root)
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => true })
    expect(report).toEqual({ kind: 'busy', pid: process.pid })
  })

  it('rolls forward a staged replacement whose detached script died', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await stagedRelease(transaction)
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report).toEqual({ kind: 'activated', previousVersion: '1.2.3', targetVersion: '1.2.4' })
    const installed = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'))
    expect(installed).toMatchObject({ version: '1.2.4', buildId: BUILD_ID })
    const backup = JSON.parse(await readFile(`${root}.previous/release.json`, 'utf8'))
    expect(backup).toMatchObject({ version: '1.2.3' })
    await expect(stat(transaction.stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recognizes an already-activated install when the result write was lost', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    // Simulate a successful swap whose result record was never written: the
    // installed release already matches the transaction target + buildId.
    await writeFile(
      join(root, 'release.json'),
      JSON.stringify({ version: '1.2.4', buildId: BUILD_ID }),
      'utf8'
    )
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report).toEqual({ kind: 'activated', previousVersion: '1.2.3', targetVersion: '1.2.4' })
    await expect(stat(tuiUpdateTransactionPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores the backup when the install root vanished and staging is unusable', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    // Simulate a half-finished swap: current moved to backup, staged tree gone.
    const { rename } = await import('node:fs/promises')
    await rename(root, transaction.backupRoot)
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain('restored from its backup')
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
  })

  it('leaves a valid install untouched when staging is unusable', async () => {
    const root = await installRoot()
    await writeTuiUpdateTransaction(root, transactionInput(root))
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain('left unchanged')
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
  })

  it('fails safely on corrupt transaction metadata', async () => {
    const root = await installRoot()
    const dir = tuiUpdateTransactionDir(root)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'transaction.json'), 'not json', 'utf8')
    const report = await reconcilePendingTuiUpdate(root)
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain('unreadable')
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
  })
})

describe('recovery preserves the only available backup', () => {
  it('finishes a half-swapped update and keeps the preserved backup', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await stagedRelease(transaction)
    // Simulate a crash between moving the old install to backup and moving the
    // staged release into place: install root gone, backup and staging present.
    const { rename } = await import('node:fs/promises')
    await rename(root, transaction.backupRoot)
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report).toEqual({ kind: 'activated', previousVersion: '1.2.3', targetVersion: '1.2.4' })
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.4', buildId: BUILD_ID })
    // The backup must survive activation when the install root was missing.
    expect(JSON.parse(await readFile(`${root}.previous/release.json`, 'utf8')))
      .toMatchObject({ version: '1.2.3' })
  })

  it('restores the backup when activating the staged release fails after a half-swap', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await stagedRelease(transaction)
    const { rename } = await import('node:fs/promises')
    await rename(root, transaction.backupRoot)
    renameFailure.source = resolve(join(transaction.stagingRoot, 'kun'))
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain('restored from its backup')
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
    await expect(stat(tuiUpdateTransactionPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the transaction for retry when the backup cannot be restored', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await stagedRelease(transaction)
    const { rename } = await import('node:fs/promises')
    await rename(root, transaction.backupRoot)
    renameFailure.destination = resolve(root)
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain('still in place')
    expect(report && 'message' in report && report.message).toContain('retried on the next launch')
    // Recovery failed, so the transaction is retained for the next launch and
    // the backup is left intact.
    expect(JSON.parse(await readFile(tuiUpdateTransactionPath(root), 'utf8')))
      .toMatchObject({ previousVersion: '1.2.3' })
    expect(JSON.parse(await readFile(`${root}.previous/release.json`, 'utf8')))
      .toMatchObject({ version: '1.2.3' })
  })

  it('restores the backup from a recorded failure when the install root is gone', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await writeTuiUpdateResult(root, {
      status: 'failed',
      stage: 'swap',
      error: 'IOException: <install> is locked',
      previousVersion: '1.2.3',
      targetVersion: '1.2.4'
    })
    const { rename } = await import('node:fs/promises')
    await rename(root, transaction.backupRoot)
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain('restored from its backup')
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
    await expect(stat(tuiUpdateTransactionPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a complete loss when no backup remains and activation fails', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await stagedRelease(transaction)
    // Remove the install entirely without leaving a backup behind.
    await rm(root, { recursive: true, force: true })
    renameFailure.source = resolve(join(transaction.stagingRoot, 'kun'))
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report?.kind).toBe('failed')
    expect(report && 'message' in report && report.message).toContain(
      'No usable installation remains; reinstall Kun.'
    )
    await expect(stat(tuiUpdateTransactionPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('TUI update updater record', () => {
  it('round-trips the updater record and rejects malformed data', async () => {
    const root = await installRoot()
    await recordTuiUpdateUpdater(root, {
      schemaVersion: 1,
      pid: process.pid,
      token: 'tok',
      startedAt: '2026-09-03T00:00:00.000Z',
      processIdentity: 'win32-v1:2026-09-03T00:00:00.0000000Z'
    })
    const parsed = parseTuiUpdateUpdater(await readFile(tuiUpdateUpdaterPath(root), 'utf8'))
    expect(parsed).toMatchObject({
      pid: process.pid,
      token: 'tok',
      processIdentity: 'win32-v1:2026-09-03T00:00:00.0000000Z'
    })
    expect(parseTuiUpdateUpdater('not json')).toBeNull()
    expect(parseTuiUpdateUpdater(JSON.stringify({
      schemaVersion: 2,
      pid: 1,
      token: 't',
      startedAt: 'x'
    }))).toBeNull()
    expect(parseTuiUpdateUpdater(JSON.stringify({
      schemaVersion: 1,
      pid: 0,
      token: 't',
      startedAt: 'x'
    }))).toBeNull()
    expect(parseTuiUpdateUpdater(JSON.stringify({
      schemaVersion: 1,
      pid: 1,
      token: '',
      startedAt: 'x'
    }))).toBeNull()
  })

  it('stays busy while the recorded updater process is alive even without the lock', async () => {
    const root = await installRoot()
    await writeTuiUpdateTransaction(root, transactionInput(root))
    await recordTuiUpdateUpdater(root, {
      schemaVersion: 1,
      pid: 424242,
      token: 'tok',
      startedAt: '2026-09-03T00:00:00.000Z'
    })
    const report = await reconcilePendingTuiUpdate(root, {
      processIsAlive: (pid) => pid === 424242
    })
    expect(report).toEqual({ kind: 'busy', pid: 424242 })
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
  })

  it('removes the updater record when clearing the transaction', async () => {
    const root = await installRoot()
    await writeTuiUpdateTransaction(root, transactionInput(root))
    await recordTuiUpdateUpdater(root, {
      schemaVersion: 1,
      pid: 1,
      token: 'tok',
      startedAt: '2026-09-03T00:00:00.000Z'
    })
    await clearTuiUpdateTransaction(root)
    await expect(stat(tuiUpdateUpdaterPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls forward when the recorded updater process is dead and the lock is gone', async () => {
    const root = await installRoot()
    const transaction = await writeTuiUpdateTransaction(root, transactionInput(root))
    await stagedRelease(transaction)
    await recordTuiUpdateUpdater(root, {
      schemaVersion: 1,
      pid: 424242,
      token: 'tok',
      startedAt: '2026-09-03T00:00:00.000Z'
    })
    const report = await reconcilePendingTuiUpdate(root, { processIsAlive: () => false })
    expect(report).toEqual({ kind: 'activated', previousVersion: '1.2.3', targetVersion: '1.2.4' })
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.4', buildId: BUILD_ID })
  })
})
