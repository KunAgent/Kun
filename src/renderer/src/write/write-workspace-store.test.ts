import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from './write-workspace-store'

function installDsGui(overrides: Partial<Window['kunGui']>): void {
  vi.stubGlobal('window', {
    kunGui: overrides
  })
}

function activateTextFile(path = '/tmp/write/draft.md'): void {
  useWriteWorkspaceStore.setState({
    activeFilePath: path,
    activeFileKind: 'text',
    fileContent: 'old content',
    fileError: null,
    fileLoading: false,
    saveStatus: 'saved'
  })
}

afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  vi.unstubAllGlobals()
})

describe('write workspace store', () => {
  it('reports read errors when syncing the active text file from disk', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async () => {
        throw new Error('read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileError: 'read failed',
      saveStatus: 'error'
    })
  })

  it('does not apply late read errors after the active text file changes', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async () => {
        useWriteWorkspaceStore.setState({ activeFilePath: '/tmp/write/next.md' })
        throw new Error('late read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      activeFilePath: '/tmp/write/next.md',
      fileError: null,
      saveStatus: 'saved'
    })
  })

  it('saves the current draft before the writing assistant reads the file', async () => {
    const writeWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-11T00:00:00.000Z'
    }))
    installDsGui({ writeWorkspaceFile })
    activateTextFile()
    useWriteWorkspaceStore.setState({
      fileContent: 'unsaved current draft',
      saveStatus: 'dirty'
    })

    await expect(
      useWriteWorkspaceStore.getState().prepareActiveFileForAssistant('/tmp/write')
    ).resolves.toBe(true)

    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: '/tmp/write/draft.md',
      workspaceRoot: '/tmp/write',
      content: 'unsaved current draft'
    })
    expect(useWriteWorkspaceStore.getState().saveStatus).toBe('saved')
  })

  it('blocks assistant context when the current draft cannot be saved', async () => {
    installDsGui({
      writeWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'disk is read-only' }))
    })
    activateTextFile()
    useWriteWorkspaceStore.setState({ fileContent: 'unsaved draft', saveStatus: 'dirty' })

    await expect(
      useWriteWorkspaceStore.getState().prepareActiveFileForAssistant('/tmp/write')
    ).resolves.toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'unsaved draft',
      saveStatus: 'error',
      fileError: 'disk is read-only'
    })
  })

  it('does not mark edits typed during a save as saved and flushes the newer draft', async () => {
    let finishFirst!: (value: {
      ok: true
      path: string
      savedAt: string
    }) => void
    const firstWrite = new Promise<{
      ok: true
      path: string
      savedAt: string
    }>((resolve) => { finishFirst = resolve })
    const writeWorkspaceFile = vi.fn()
      .mockImplementationOnce(async () => firstWrite)
      .mockResolvedValue({
        ok: true as const,
        path: '/tmp/write/draft.md',
        savedAt: '2026-07-11T00:00:01.000Z'
      })
    installDsGui({ writeWorkspaceFile })
    activateTextFile()
    useWriteWorkspaceStore.setState({ fileContent: 'first draft', saveStatus: 'dirty' })

    const preparing = useWriteWorkspaceStore.getState().prepareActiveFileForAssistant('/tmp/write')
    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledTimes(1))
    useWriteWorkspaceStore.getState().setFileContent('newer draft')
    finishFirst({
      ok: true,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-11T00:00:00.000Z'
    })

    await expect(preparing).resolves.toBe(true)
    expect(writeWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(writeWorkspaceFile.mock.calls.map(([payload]) => payload.content)).toEqual([
      'first draft',
      'newer draft'
    ])
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'newer draft',
      saveStatus: 'saved'
    })
  })

  it('coalesces concurrent saves and then persists the newest draft', async () => {
    let finishFirst!: (value: {
      ok: true
      path: string
      savedAt: string
    }) => void
    const firstWrite = new Promise<{
      ok: true
      path: string
      savedAt: string
    }>((resolve) => { finishFirst = resolve })
    const writeWorkspaceFile = vi.fn()
      .mockImplementationOnce(async () => firstWrite)
      .mockResolvedValue({
        ok: true as const,
        path: '/tmp/write/draft.md',
        savedAt: '2026-07-11T00:00:01.000Z'
      })
    installDsGui({ writeWorkspaceFile })
    activateTextFile()
    useWriteWorkspaceStore.setState({ fileContent: 'first draft', saveStatus: 'dirty' })

    const firstSave = useWriteWorkspaceStore.getState().flushSave('/tmp/write')
    useWriteWorkspaceStore.getState().setFileContent('newer draft')
    const coalescedSave = useWriteWorkspaceStore.getState().flushSave('/tmp/write')
    finishFirst({
      ok: true,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-11T00:00:00.000Z'
    })

    await expect(Promise.all([firstSave, coalescedSave])).resolves.toEqual([true, true])
    expect(writeWorkspaceFile.mock.calls.map(([payload]) => payload.content)).toEqual([
      'first draft',
      'newer draft'
    ])
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'newer draft',
      saveStatus: 'saved'
    })
  })

  it('preserves a dirty draft and queues external content for diff review', async () => {
    installDsGui({})
    activateTextFile()
    useWriteWorkspaceStore.setState({
      fileContent: 'local unsaved draft',
      saveStatus: 'dirty'
    })

    await expect(useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write', {
      path: '/tmp/write/draft.md',
      content: 'agent version on disk',
      size: 21,
      truncated: false,
      animate: true,
      reviewAsDiff: true
    })).resolves.toBe(true)

    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'local unsaved draft',
      saveStatus: 'dirty',
      reviewActive: true,
      pendingAgentReview: { nextContent: 'agent version on disk' }
    })
  })

  it('preserves a draft after a save error when external content arrives', async () => {
    installDsGui({})
    activateTextFile()
    useWriteWorkspaceStore.setState({
      fileContent: 'local draft after failed save',
      fileError: 'disk is read-only',
      saveStatus: 'error'
    })

    await expect(useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write', {
      path: '/tmp/write/draft.md',
      content: 'agent version on disk',
      size: 21,
      truncated: false,
      animate: true,
      reviewAsDiff: true
    })).resolves.toBe(true)

    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'local draft after failed save',
      saveStatus: 'error',
      reviewActive: true,
      pendingAgentReview: { nextContent: 'agent version on disk' }
    })
  })

  it('ignores the file watcher echo from an in-flight save without losing newer edits', async () => {
    let finishWrite!: (value: {
      ok: true
      path: string
      savedAt: string
    }) => void
    const write = new Promise<{
      ok: true
      path: string
      savedAt: string
    }>((resolve) => { finishWrite = resolve })
    installDsGui({ writeWorkspaceFile: vi.fn(async () => write) })
    activateTextFile()
    useWriteWorkspaceStore.setState({ fileContent: 'saving draft', saveStatus: 'dirty' })

    const saving = useWriteWorkspaceStore.getState().flushSave('/tmp/write')
    useWriteWorkspaceStore.getState().setFileContent('newer unsaved draft')

    await expect(useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write', {
      path: '/tmp/write/draft.md',
      content: 'saving draft',
      size: 12,
      truncated: false,
      animate: true,
      reviewAsDiff: true
    })).resolves.toBe(true)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'newer unsaved draft',
      saveStatus: 'dirty',
      pendingAgentReview: null
    })

    finishWrite({
      ok: true,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-11T00:00:00.000Z'
    })
    await expect(saving).resolves.toBe(true)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'newer unsaved draft',
      saveStatus: 'dirty',
      pendingAgentReview: null
    })
  })
})
