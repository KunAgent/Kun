import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeUploadEvent, RuntimeUploadResult } from '@shared/colab/runtime-upload'
import { useRuntimeUploads } from './runtime-upload-store'

const unsubscribe = vi.fn()
const cancel = vi.fn()
const invoke = vi.fn()
let emit: (event: RuntimeUploadEvent) => void
const event = { sessionId: 'a', fileName: 'model.gguf', fileIndex: 1, fileCount: 1, totalBytes: 42, transferredBytes: 12 }

beforeEach(() => {
  vi.clearAllMocks()
  useRuntimeUploads.setState({ sessions: {} })
  vi.stubGlobal('window', { kunGui: {
    onColabUploadProgress: (listener: typeof emit) => { emit = listener; return unsubscribe },
    colabUploadToSession: invoke,
    colabCancelUpload: cancel
  } })
})
afterEach(() => vi.unstubAllGlobals())

describe('runtime upload UI state', () => {
  it('retains progress by session, ignores duplicate starts and keeps cancellation distinct from success', async () => {
    let finish!: (result: RuntimeUploadResult) => void
    invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const { start, cancel: cancelUpload } = useRuntimeUploads.getState()
    const upload = start('a')
    await start('a')
    emit({ ...event, sessionId: 'b' })
    expect(useRuntimeUploads.getState().sessions).toEqual({ a: { busy: true } })
    emit(event)
    expect(useRuntimeUploads.getState().sessions.a).toEqual({ busy: true, progress: event })
    await cancelUpload('a')
    expect(cancel).toHaveBeenCalledWith({ sessionId: 'a' })
    finish({ ok: false, canceled: true, uploadedCount: 0 })
    await upload
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(useRuntimeUploads.getState().sessions.a).toEqual({ busy: false, result: { ok: false, canceled: true, uploadedCount: 0 } })
  })

  it('does not send a stale notebook after a failed save or leave the upload control busy', async () => {
    await useRuntimeUploads.getState().start('a', 'active.ipynb', async () => { throw new Error('save failed') })
    expect(invoke).not.toHaveBeenCalled()
    expect(useRuntimeUploads.getState().sessions.a).toEqual({ busy: false, result: { ok: false, message: 'save failed', uploadedCount: 0 } })
  })

  it('keeps partial results and releases the subscription after IPC rejects', async () => {
    const result = { ok: false, uploadedCount: 2, message: 'disk full' }
    invoke.mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('IPC unavailable'))
    const { start } = useRuntimeUploads.getState()
    await start('a', 'active.ipynb')
    expect(invoke).toHaveBeenCalledWith({ sessionId: 'a', workspaceNotebook: 'active.ipynb' })
    expect(useRuntimeUploads.getState().sessions.a).toEqual({ busy: false, result })
    await start('b')
    expect(useRuntimeUploads.getState().sessions.b).toMatchObject({ busy: false, result: { ok: false, message: 'IPC unavailable' } })
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('forwards targetRemoteDir when uploading or saving notebooks directly into Google Drive', async () => {
    invoke.mockResolvedValueOnce({ ok: true, uploadedCount: 1 })
    await useRuntimeUploads
      .getState()
      .start('a', 'train.ipynb', undefined, '/content/drive/MyDrive/Colab Notebooks')
    expect(invoke).toHaveBeenCalledWith({
      sessionId: 'a',
      workspaceNotebook: 'train.ipynb',
      targetRemoteDir: '/content/drive/MyDrive/Colab Notebooks'
    })
    expect(useRuntimeUploads.getState().sessions.a).toEqual({
      busy: false,
      result: { ok: true, uploadedCount: 1 },
      targetRemoteDir: '/content/drive/MyDrive/Colab Notebooks'
    })
  })
})
