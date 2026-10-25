import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitTurnUndoPreflight } from '@shared/git-turn-undo'
import {
  closeTurnUndoDialog,
  confirmTurnUndo,
  openTurnUndoDialog,
  reapplyTurnUndo,
  useTurnUndoStore,
  type TurnUndoTarget
} from './turn-undo-store'

const target: TurnUndoTarget = {
  checkpointId: 'gcp_1',
  threadId: 'thr_1',
  workspaceRoot: '/repo',
  files: [{ path: '/repo/a.ts', afterSha256: 'a'.repeat(64) }],
  shellCommandsRan: false
}

function preflight(overrides: Partial<GitTurnUndoPreflight> = {}): GitTurnUndoPreflight {
  return {
    checkpointId: 'gcp_1',
    repositoryRoot: '/repo',
    safe: [{ path: 'a.ts', action: 'restore' }],
    unsafe: [],
    ignored: [],
    ignoredOverflow: 0,
    canUndo: true,
    ...overrides
  }
}

beforeEach(() => {
  useTurnUndoStore.setState({ dialog: null, statusByCheckpoint: {}, pendingCheckpointId: null, hostOwner: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('turn undo store', () => {
  it('runs the preflight, undoes on confirm and remembers the undo for Reapply', async () => {
    const undoTurnFiles = vi.fn(async () => ({ ok: true, undoId: 'tu_1', restored: ['a.ts'], deleted: [], preflight: preflight() }))
    vi.stubGlobal('window', {
      kunGui: {
        preflightTurnUndo: vi.fn(async () => ({ ok: true, preflight: preflight() })),
        undoTurnFiles
      }
    })

    await openTurnUndoDialog(target)
    expect(useTurnUndoStore.getState().dialog).toMatchObject({ kind: 'undo', phase: 'ready', error: null })

    await confirmTurnUndo()
    expect(undoTurnFiles).toHaveBeenCalledWith({
      checkpointId: 'gcp_1',
      expectedThreadId: 'thr_1',
      expectedWorkspaceRoot: '/repo',
      files: target.files,
      shellCommandsRan: false,
      scope: 'turn'
    })
    expect(useTurnUndoStore.getState().dialog).toBeNull()
    expect(useTurnUndoStore.getState().statusByCheckpoint.gcp_1).toMatchObject({ state: 'undone', undoId: 'tu_1', fileCount: 1 })
  })

  it('does not undo while any file is unsafe', async () => {
    const undoTurnFiles = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        preflightTurnUndo: vi.fn(async () => ({
          ok: true,
          preflight: preflight({ unsafe: [{ path: 'b.ts', reason: 'modified_after_turn' }], canUndo: false })
        })),
        undoTurnFiles
      }
    })

    await openTurnUndoDialog(target)
    await confirmTurnUndo()
    expect(undoTurnFiles).not.toHaveBeenCalled()
    expect(useTurnUndoStore.getState().dialog).toMatchObject({ kind: 'undo', phase: 'ready' })
    closeTurnUndoDialog()
    expect(useTurnUndoStore.getState().dialog).toBeNull()
  })

  it('keeps the dialog open with the refreshed preflight when undo is refused', async () => {
    const refreshed = preflight({ unsafe: [{ path: 'a.ts', reason: 'modified_after_turn' }], safe: [], canUndo: false })
    vi.stubGlobal('window', {
      kunGui: {
        preflightTurnUndo: vi.fn(async () => ({ ok: true, preflight: preflight() })),
        undoTurnFiles: vi.fn(async () => ({ ok: false, reason: 'unsafe', message: 'changed', preflight: refreshed }))
      }
    })
    await openTurnUndoDialog(target)
    await confirmTurnUndo()
    expect(useTurnUndoStore.getState().dialog).toMatchObject({ kind: 'undo', preflight: refreshed, error: 'changed' })
  })

  it('shows conflicts when Reapply is refused and clears the undo once reapplied', async () => {
    const reapplyTurnFiles = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'unsafe', message: 'changed', conflicts: [{ path: 'a.ts', reason: 'modified_after_undo' }] })
      .mockResolvedValueOnce({ ok: true, restored: ['a.ts'], deleted: [] })
    vi.stubGlobal('window', { kunGui: { preflightTurnUndo: vi.fn(), reapplyTurnFiles } })
    useTurnUndoStore.setState({
      statusByCheckpoint: { gcp_1: { state: 'undone', undoId: 'tu_1', undoneAt: '2026-10-20T00:00:00Z', fileCount: 1 } }
    })

    expect(await reapplyTurnUndo({ checkpointId: 'gcp_1', threadId: 'thr_1', workspaceRoot: '/repo' })).toBeNull()
    expect(useTurnUndoStore.getState().dialog).toMatchObject({ kind: 'reapply-blocked', conflicts: [{ path: 'a.ts' }] })

    await reapplyTurnUndo({ checkpointId: 'gcp_1', threadId: 'thr_1', workspaceRoot: '/repo' })
    expect(reapplyTurnFiles).toHaveBeenLastCalledWith({
      checkpointId: 'gcp_1',
      undoId: 'tu_1',
      expectedThreadId: 'thr_1',
      expectedWorkspaceRoot: '/repo'
    })
    expect(useTurnUndoStore.getState().statusByCheckpoint.gcp_1).toEqual({ state: 'none' })
  })
})
