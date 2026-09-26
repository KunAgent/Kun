import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { createWriteWorkspaceFileActions } from './write-workspace-file-actions'

type ActionParams = Parameters<typeof createWriteWorkspaceFileActions>[0]

function actionParams(overrides: Partial<ActionParams> = {}): ActionParams {
  return {
    t: ((key: string) => key) as ActionParams['t'],
    workspaceReady: true,
    workspaceRoot: '/workspace',
    rootDirectory: '/workspace',
    activeFilePath: '/workspace/brief.md',
    activeFileIsText: true,
    fileContent: '# Brief',
    presentationEnabled: true,
    presentationInFlight: false,
    runtimeConnection: 'ready',
    input: '',
    setInput: vi.fn(),
    onSubmitPrompt: vi.fn(),
    saveTimerRef: { current: null },
    addWriteWorkspace: vi.fn(async () => undefined),
    createFile: vi.fn(async () => null),
    flushSave: vi.fn(async () => true),
    setAssistantOpen: vi.fn(),
    setFileError: vi.fn(),
    ensureWriteThreadForWorkspace: vi.fn(),
    completeOnboarding: vi.fn(),
    showExportNotice: vi.fn(),
    setExportMenuOpen: vi.fn(),
    setExportingFormat: vi.fn(),
    setPresentationInFlight: vi.fn(),
    xArticleImageIndex: 0,
    setXArticleImageState: vi.fn(),
    ...overrides
  }
}

afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  vi.unstubAllGlobals()
})

describe('Write presentation action', () => {
  it('routes a new request to ppt_agent', async () => {
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/brief.md'
    })
    const flushSave = vi.fn(async () => true)
    const onSubmitPrompt = vi.fn()
    const actions = createWriteWorkspaceFileActions(actionParams({ flushSave, onSubmitPrompt }))

    await actions.generatePresentation()

    expect(flushSave).toHaveBeenCalledOnce()
    expect(onSubmitPrompt).toHaveBeenCalledOnce()
    const prompt = onSubmitPrompt.mock.calls[0][0]
    expect(prompt).toContain('`ppt_agent`（start）')
    expect(prompt).toContain('唯一内容来源 Markdown：/workspace/brief.md')
  })
})

describe('Write X article clipboard action', () => {
  it('copies with the x-articles profile and uses the body toast', async () => {
    const showExportNotice = vi.fn()
    const copyWriteDocumentAsRichText = vi.fn(async () => ({
      ok: true as const,
      copiedAt: '2026-09-20T00:00:00.000Z',
      profile: 'x-articles' as const,
      title: 'Brief',
      simplified: true,
      overLimit: false
    }))
    vi.stubGlobal('window', {
      kunGui: { copyWriteDocumentAsRichText }
    })
    const actions = createWriteWorkspaceFileActions(actionParams({ showExportNotice }))

    await actions.copyCurrentFileAsXArticle()

    expect(copyWriteDocumentAsRichText).toHaveBeenCalledWith({
      path: '/workspace/brief.md',
      workspaceRoot: '/workspace',
      content: '# Brief',
      profile: 'x-articles'
    })
    expect(showExportNotice).toHaveBeenCalledWith({
      tone: 'success',
      message: 'writeCopyXArticleSuccess'
    })
  })

  it('remembers local image count after copying the X article body', async () => {
    const showExportNotice = vi.fn()
    const setXArticleImageState = vi.fn()
    const copyWriteDocumentAsRichText = vi.fn(async () => ({
      ok: true as const,
      copiedAt: '2026-09-20T00:00:00.000Z',
      profile: 'x-articles' as const,
      title: 'Brief',
      simplified: true,
      overLimit: false,
      imageCount: 3
    }))
    vi.stubGlobal('window', {
      kunGui: { copyWriteDocumentAsRichText }
    })
    const actions = createWriteWorkspaceFileActions(
      actionParams({ showExportNotice, setXArticleImageState })
    )

    await actions.copyCurrentFileAsXArticle()

    expect(setXArticleImageState).toHaveBeenCalledWith({ count: 3, index: 0 })
    expect(showExportNotice).toHaveBeenCalledWith({
      tone: 'success',
      message: 'writeCopyXArticleSuccessWithImages'
    })
  })

  it('copies the next X article image and advances the slot', async () => {
    const showExportNotice = vi.fn()
    const setXArticleImageState = vi.fn()
    const copyWriteDocumentAsRichText = vi.fn(async () => ({
      ok: true as const,
      copiedAt: '2026-09-20T00:00:00.000Z',
      profile: 'x-articles-image' as const,
      imageIndex: 0,
      imageCount: 3
    }))
    vi.stubGlobal('window', {
      kunGui: { copyWriteDocumentAsRichText }
    })
    const actions = createWriteWorkspaceFileActions(
      actionParams({ showExportNotice, setXArticleImageState, xArticleImageIndex: 0 })
    )

    await actions.copyCurrentFileAsXArticleImage()

    expect(copyWriteDocumentAsRichText).toHaveBeenCalledWith({
      path: '/workspace/brief.md',
      workspaceRoot: '/workspace',
      content: '# Brief',
      profile: 'x-articles-image',
      imageIndex: 0
    })
    expect(setXArticleImageState).toHaveBeenCalledWith({ count: 3, index: 1 })
    expect(showExportNotice).toHaveBeenCalledWith({
      tone: 'success',
      message: 'writeCopyXArticleImageSuccess'
    })
  })

  it('maps a missing X image error to the dedicated toast', async () => {
    const showExportNotice = vi.fn()
    const copyWriteDocumentAsRichText = vi.fn(async () => ({
      ok: false as const,
      message: 'NO_X_ARTICLE_IMAGE'
    }))
    vi.stubGlobal('window', {
      kunGui: { copyWriteDocumentAsRichText }
    })
    const actions = createWriteWorkspaceFileActions(actionParams({ showExportNotice }))

    await actions.copyCurrentFileAsXArticleImage()

    expect(showExportNotice).toHaveBeenCalledWith({
      tone: 'error',
      message: 'writeCopyXArticleImageMissing'
    })
  })
})
