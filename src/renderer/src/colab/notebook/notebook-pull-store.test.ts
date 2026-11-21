import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOTEBOOK_IMPORT_MAX_BYTES,
  type ColabDriveNotebookEntry,
  type ColabDriveNotebooksListResult,
  type NotebookPullImportResult
} from '@shared/colab/colab-notebook-types'
import { useColabNotebookStore } from './colab-notebook-store'
import { useNotebookPullStore } from './notebook-pull-store'

const root = '/tmp/project'
const drive = { kind: 'drive', connectionId: 'research', label: 'Research' } as const
const jupyter = { kind: 'jupyter', serverId: 'server1', label: 'Research Lab' } as const
const notebook = (remotePath: string, sizeBytes = 100): ColabDriveNotebookEntry => ({
  remotePath, relativePath: remotePath, name: remotePath.split('/').at(-1)!, sizeBytes, modifiedAtMs: 0
})
const alpha = notebook('baselines/train.ipynb')
const beta = notebook('experiments/train.ipynb')
const tooLarge = notebook('experiments/large.ipynb', NOTEBOOK_IMPORT_MAX_BYTES + 1)
const list: ColabDriveNotebooksListResult = { ok: true, status: 'ready', entries: [alpha, beta, tooLarge] }

const bridge = {
  colabDriveStartPull: vi.fn<typeof window.kunGui.colabDriveStartPull>(),
  colabDriveCompleteAuth: vi.fn<typeof window.kunGui.colabDriveCompleteAuth>(),
  colabDriveListNotebooks: vi.fn<typeof window.kunGui.colabDriveListNotebooks>(),
  colabDriveImportNotebook: vi.fn<typeof window.kunGui.colabDriveImportNotebook>(),
  colabDriveClosePull: vi.fn<typeof window.kunGui.colabDriveClosePull>(),
  jupyterListNotebooks: vi.fn<typeof window.kunGui.jupyterListNotebooks>(),
  jupyterImportNotebook: vi.fn<typeof window.kunGui.jupyterImportNotebook>(),
  jupyterConnect: vi.fn(),
  colabStopSession: vi.fn(),
  listWorkspaceFiles: vi.fn(async () => ({ ok: true, files: ['active.ipynb', 'train (Colab).ipynb'] }))
}
const pull = useNotebookPullStore.getState

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.stubGlobal('window', { kunGui: bridge })
  useColabNotebookStore.setState({ workspaceRoot: root, activePath: 'active.ipynb', runtimeBackend: 'jupyter' })
  bridge.colabDriveClosePull.mockResolvedValue({ ok: true, stoppedTemporary: false })
  bridge.colabDriveListNotebooks.mockResolvedValue(list)
  bridge.jupyterListNotebooks.mockResolvedValue(list)
})

afterEach(async () => {
  bridge.colabDriveClosePull.mockResolvedValue({ ok: true, stoppedTemporary: false })
  await pull().close()
  useNotebookPullStore.setState({ task: null, visible: false, otherSourceRequested: false })
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('Notebook pull state', () => {
  it('separates Drive preparation from authorization and retries only the failed copy', async () => {
    const auth = { ok: true, status: 'needs_auth', authUrl: 'https://accounts.google.com/example', expiresAt: Date.now() + 60_000 } as const
    bridge.colabDriveStartPull.mockResolvedValue(auth)
    bridge.colabDriveCompleteAuth.mockResolvedValue(list)
    bridge.colabDriveImportNotebook
      .mockResolvedValueOnce({ ok: true, file: { remotePath: alpha.remotePath, relativePath: 'train (Colab).ipynb', disposition: 'renamed' } })
      .mockResolvedValueOnce({ ok: false, message: 'try again' })
      .mockResolvedValueOnce({ ok: true, file: { remotePath: beta.remotePath, relativePath: 'train (Colab 2).ipynb', disposition: 'renamed' } })

    pull().open(drive, root)
    expect(pull().task?.phase).toBe('prepare')
    expect(bridge.colabDriveStartPull).not.toHaveBeenCalled()
    await pull().startDrive({ sessionId: 'existing-runtime' })
    const pullId = pull().task!.access!.id
    expect(bridge.colabDriveStartPull).toHaveBeenCalledWith({ pullId, workspaceRoot: root, connectionId: 'research', runtime: { sessionId: 'existing-runtime' } })
    expect(pull().task?.phase).toBe('auth')
    expect(bridge.colabDriveCompleteAuth).not.toHaveBeenCalled()
    await pull().completeAuth()
    expect(bridge.colabDriveCompleteAuth).toHaveBeenCalledWith({ pullId })
    pull().setQuery('experiments/TRAIN')
    pull().setPicked([alpha.remotePath, beta.remotePath, tooLarge.remotePath, 'not-listed.ipynb'], true)
    pull().hide()
    pull().open(drive, root)
    expect(pull().task).toMatchObject({ query: 'experiments/TRAIN', picked: [alpha.remotePath, beta.remotePath] })
    await pull().pullPicked()
    expect(pull().task?.failed.map(({ entry }) => entry.remotePath)).toEqual([beta.remotePath])
    expect(pull().task?.saved[0].relativePath).toBe('train (Colab).ipynb')
    expect(bridge.colabDriveClosePull).not.toHaveBeenCalled()
    await pull().retryFailed()
    expect(bridge.colabDriveImportNotebook.mock.calls.map(([request]) => request.remotePath))
      .toEqual([alpha.remotePath, beta.remotePath, beta.remotePath])
    expect(pull().task).toMatchObject({ phase: 'result', failed: [], saved: expect.arrayContaining([expect.objectContaining({ relativePath: 'train (Colab 2).ipynb' })]) })
    expect(bridge.colabDriveClosePull).toHaveBeenCalledExactlyOnceWith({ pullId })
    expect(bridge.colabStopSession).not.toHaveBeenCalled()
    expect(useColabNotebookStore.getState()).toMatchObject({ activePath: 'active.ipynb', runtimeBackend: 'jupyter' })
  })

  it('expires Drive authorization and retains an unconfirmed temporary CPU for a cleanup retry', async () => {
    vi.useFakeTimers()
    bridge.colabDriveStartPull.mockResolvedValue({
      ok: true, status: 'needs_auth', authUrl: 'https://accounts.google.com/example', expiresAt: Date.now() + 1_000
    })
    bridge.colabDriveClosePull
      .mockResolvedValueOnce({ ok: false, message: 'status unknown' })
      .mockResolvedValueOnce({ ok: true, stoppedTemporary: true })

    pull().open(drive, root)
    await pull().startDrive({ temporaryCpu: true })
    const access = pull().task!.access!
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pull().task).toMatchObject({ phase: 'error', error: { kind: 'auth_expired' }, cleanup: 'failed', access })
    expect(pull().task?.auth).toBeUndefined()
    await pull().startDrive({ temporaryCpu: true })
    expect(bridge.colabDriveStartPull).toHaveBeenCalledTimes(1)
    await pull().close()
    expect(bridge.colabDriveClosePull.mock.calls).toEqual([[{ pullId: access.id }], [{ pullId: access.id }]])
    expect(pull().task).toBeNull()
  })

  it('discards a late Drive reply when the user cancels during preparation', async () => {
    const pending = deferred<ColabDriveNotebooksListResult>()
    bridge.colabDriveStartPull.mockReturnValue(pending.promise)
    pull().open(drive, root)
    const starting = pull().startDrive({ temporaryCpu: true })
    const pullId = pull().task!.access!.id
    await pull().close()
    pending.resolve(list)
    await starting
    expect(bridge.colabDriveClosePull).toHaveBeenCalledExactlyOnceWith({ pullId })
    expect(pull()).toMatchObject({ task: null, visible: false })
    expect(bridge.colabDriveImportNotebook).not.toHaveBeenCalled()
  })

  it('stops scheduling Jupyter copies when the project changes without starting a kernel', async () => {
    const pending = deferred<NotebookPullImportResult>()
    bridge.jupyterImportNotebook.mockReturnValueOnce(pending.promise)
    pull().open(jupyter, root)
    await vi.waitFor(() => expect(pull().task?.phase).toBe('select'))
    pull().setPicked([alpha.remotePath, beta.remotePath], true)
    const importing = pull().pullPicked()
    await vi.waitFor(() => expect(bridge.jupyterImportNotebook).toHaveBeenCalledExactlyOnceWith({
      workspaceRoot: root, serverId: 'server1', remotePath: alpha.remotePath
    }))
    useColabNotebookStore.setState({ workspaceRoot: '/tmp/other', activePath: 'other.ipynb' })
    pull().workspaceChanged('/tmp/other')
    pending.resolve({ ok: true, file: { remotePath: alpha.remotePath, relativePath: 'train.ipynb', disposition: 'created' } })
    await importing
    await vi.waitFor(() => expect(pull().task).toBeNull())
    expect(bridge.jupyterImportNotebook).toHaveBeenCalledTimes(1)
    expect(bridge.jupyterConnect).not.toHaveBeenCalled()
    expect(bridge.listWorkspaceFiles).not.toHaveBeenCalled()
    expect(useColabNotebookStore.getState().activePath).toBe('other.ipynb')
  })
})
