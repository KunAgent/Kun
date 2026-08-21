import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { SidebarActionDialogState } from './SidebarProjectOverlays'

const mocks = vi.hoisted(() => ({
  runtimeRequest: vi.fn(),
  setError: vi.fn(),
  refreshThreads: vi.fn(async () => undefined),
  writeText: vi.fn(async () => undefined)
}))

vi.mock('../../agent/runtime-client', () => ({
  rendererRuntimeClient: { runtimeRequest: mocks.runtimeRequest }
}))

vi.mock('../../store/chat-store', () => ({
  useChatStore: {
    getState: () => ({ setError: mocks.setError, refreshThreads: mocks.refreshThreads }),
    setState: vi.fn()
  }
}))

vi.mock('../../agent/registry', () => ({ getProvider: () => ({}) }))

const { createSidebarProjectThreadActions } = await import('./sidebar-project-thread-actions')

const thread = { id: 'thr_1', title: 'Retry policy' } as NormalizedThread

function actionsWith(): {
  handleSummarizeThread: (thread: NormalizedThread) => Promise<void>
  handleCopyThreadId: (thread: NormalizedThread) => Promise<void>
  dialogs: SidebarActionDialogState[]
} {
  const dialogs: SidebarActionDialogState[] = []
  const actions = createSidebarProjectThreadActions({
    t: (key: string) => key,
    activeThreadId: null,
    busy: false,
    watchTurnCompletion: {},
    projectWorkspaceGroups: [],
    threadWorktrees: {},
    deletingThreadIds: {},
    actionDialog: null,
    renameThreadDialog: null,
    moveThreadDialog: null,
    setDeletingThreadIds: vi.fn(),
    setActionDialog: ((
      update: SidebarActionDialogState | null
        | ((current: SidebarActionDialogState | null) => SidebarActionDialogState | null)
    ) => {
      const next = typeof update === 'function' ? update(null) : update
      if (next) dialogs.push(next)
    }) as never,
    setRenameThreadDialog: vi.fn(),
    setMoveThreadDialog: vi.fn(),
    setThreadContextMenu: vi.fn(),
    setDragOverWorkspace: vi.fn(),
    persistSidebarFolders: vi.fn(),
    onRenameThread: vi.fn(async () => undefined),
    onPinThread: vi.fn(async () => undefined),
    onArchiveThread: vi.fn(async () => undefined),
    onDeleteThread: vi.fn(async () => undefined),
    onRestoreThread: vi.fn(async () => undefined)
  })
  return {
    handleSummarizeThread: actions.handleSummarizeThread,
    handleCopyThreadId: actions.handleCopyThreadId,
    dialogs
  }
}

beforeEach(() => {
  mocks.runtimeRequest.mockReset()
  mocks.setError.mockReset()
  mocks.refreshThreads.mockClear()
  mocks.writeText.mockClear()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: mocks.writeText } }
  })
})

describe('handleSummarizeThread (#1200)', () => {
  it('shows the generated summary instead of leaving the action silent', async () => {
    mocks.runtimeRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({ id: 'thr_1', summary: 'The user asked about retries.' })
    })
    const { handleSummarizeThread, dialogs } = actionsWith()

    await handleSummarizeThread(thread)

    expect(mocks.setError).not.toHaveBeenCalled()
    expect(mocks.refreshThreads).toHaveBeenCalledOnce()
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]).toMatchObject({
      title: 'summarizeSummaryTitle',
      detail: 'The user asked about retries.'
    })

    await dialogs[0]?.onConfirm()
    expect(mocks.writeText).toHaveBeenCalledWith('The user asked about retries.')
  })

  it('surfaces the runtime failure reason instead of one generic message', async () => {
    mocks.runtimeRequest.mockResolvedValue({
      ok: false,
      status: 502,
      body: JSON.stringify({
        code: 'provider_unavailable',
        message: 'session summary failed on model deepseek-chat: insufficient balance'
      })
    })
    const { handleSummarizeThread, dialogs } = actionsWith()

    await handleSummarizeThread(thread)

    expect(mocks.setError).toHaveBeenCalledWith(
      'summarizeFailed: session summary failed on model deepseek-chat: insufficient balance'
    )
    expect(dialogs).toHaveLength(0)
  })

  it('reconciles a ghost sidebar row when the runtime has no such thread', async () => {
    mocks.runtimeRequest.mockResolvedValue({
      ok: false,
      status: 404,
      body: JSON.stringify({ code: 'not_found', message: 'thread not found: thr_1' })
    })
    const { handleSummarizeThread } = actionsWith()

    await handleSummarizeThread(thread)

    expect(mocks.setError).toHaveBeenCalledWith('summarizeThreadMissing')
    expect(mocks.refreshThreads).toHaveBeenCalledOnce()
  })

  it('keeps a transport failure readable', async () => {
    mocks.runtimeRequest.mockRejectedValue(new Error('The operation was aborted due to timeout'))
    const { handleSummarizeThread } = actionsWith()

    await handleSummarizeThread(thread)

    expect(mocks.setError).toHaveBeenCalledWith(
      'summarizeFailed: The operation was aborted due to timeout'
    )
  })
})

describe('handleCopyThreadId', () => {
  it('copies the session id the runtime uses for this thread', async () => {
    const { handleCopyThreadId } = actionsWith()

    await handleCopyThreadId(thread)

    expect(mocks.writeText).toHaveBeenCalledWith('thr_1')
    expect(mocks.setError).not.toHaveBeenCalled()
  })

  it('reports a rejected clipboard write', async () => {
    mocks.writeText.mockRejectedValueOnce(new Error('denied'))
    const { handleCopyThreadId } = actionsWith()

    await handleCopyThreadId(thread)

    expect(mocks.setError).toHaveBeenCalledWith('copyFailed')
  })
})
