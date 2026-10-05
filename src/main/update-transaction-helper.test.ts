import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeUpdateTransactionAndCleanup } from './update-transaction-helper'

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ access: vi.fn(), readFile }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./gui-updater-pending', () => ({ clearGuiUpdateRecovery: vi.fn(), clearPendingUpdate: vi.fn(),
  clearPendingUpdateResult: vi.fn(), cleanupPendingUpdateBackup: vi.fn() }))

const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
const input = { environment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\transaction.json' }, backupDir: 'backup' }
const runHelper = vi.fn(async () => undefined)
const cleanupBackup = vi.fn(async () => undefined)
const clearRecords = vi.fn(async () => undefined)
const deps = { platform: 'win32' as const, runHelper, cleanupBackup, clearRecords }

beforeEach(() => { vi.resetAllMocks() })

describe('confirmed update finalization', () => {
  it.each(['{bad json', '{}', '{"Phase":17}', '{"Phase":"unknown"}', 'null'])('retains recovery for invalid transaction %s', async (raw) => {
    readFile.mockResolvedValue(raw)
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toMatchObject({ kind: 'unconfirmed' })
    expect(runHelper).not.toHaveBeenCalled()
    expect(clearRecords).not.toHaveBeenCalled()
    expect(cleanupBackup).not.toHaveBeenCalled()
  })

  it.each(['EACCES', 'EPERM', 'EIO'])('retains recovery for %s reads', async (code) => {
    readFile.mockRejectedValue(Object.assign(new Error('read failed'), { code }))
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toMatchObject({ kind: 'unconfirmed' })
    expect(clearRecords).not.toHaveBeenCalled()
    expect(cleanupBackup).not.toHaveBeenCalled()
  })

  it('only converges an absent transaction when reading reports ENOENT', async () => {
    readFile.mockRejectedValue(missing())
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toEqual({ kind: 'already-finalized', phase: 'missing' })
    expect(clearRecords).toHaveBeenCalledOnce()
  })

  it('retains recovery without a configured transaction path', async () => {
    expect(await finalizeUpdateTransactionAndCleanup({ environment: {} }, deps)).toMatchObject({ kind: 'unconfirmed' })
    expect(runHelper).not.toHaveBeenCalled()
    expect(clearRecords).not.toHaveBeenCalled()
  })

  it.each(['committed', 'finalizing', 'rolled_back'])('finishes cleanup for %s including Windows UTF-8 BOMs', async (phase) => {
    readFile.mockResolvedValueOnce(`\uFEFF${JSON.stringify({ Phase: phase })}`).mockRejectedValueOnce(missing())
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toEqual({ kind: 'finalized', phase: 'finalized' })
    expect(runHelper).toHaveBeenCalledWith('FinalizeUpdateTransaction', input.environment)
    expect(cleanupBackup).toHaveBeenCalledWith('backup')
    expect(clearRecords).toHaveBeenCalledOnce()
  })

  it('resumes finalizing after a cleanup crash and retains GUI state on a second failure', async () => {
    readFile.mockResolvedValue('{"Phase":"finalizing"}')
    runHelper.mockRejectedValue(new Error('half the assets remain locked'))
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toEqual({ kind: 'unconfirmed', reason: 'half the assets remain locked' })
    expect(runHelper).toHaveBeenCalledOnce()
    expect(clearRecords).not.toHaveBeenCalled()
    expect(cleanupBackup).not.toHaveBeenCalled()
  })

  it.each(['{"Phase":"committed"}', '{"Phase":"finalizing"}', 'corrupt', '{}'])('requires terminal proof after a successful helper: %s', async (after) => {
    readFile.mockResolvedValueOnce('{"Phase":"committed"}').mockResolvedValueOnce(after)
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toMatchObject({ kind: 'unconfirmed' })
    expect(clearRecords).not.toHaveBeenCalled()
    expect(cleanupBackup).not.toHaveBeenCalled()
  })

  it('retains recovery when the helper returned but the confirmation read is denied', async () => {
    readFile.mockResolvedValueOnce('{"Phase":"committed"}').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect(await finalizeUpdateTransactionAndCleanup(input, deps)).toMatchObject({ kind: 'unconfirmed' })
    expect(clearRecords).not.toHaveBeenCalled()
    expect(cleanupBackup).not.toHaveBeenCalled()
  })
})
