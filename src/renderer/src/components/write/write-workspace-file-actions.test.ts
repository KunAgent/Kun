import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { createWriteWorkspaceFileActions } from './write-workspace-file-actions'
import { setProductCapture } from '../../product-analytics/client'

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
    input: '',
    setInput: vi.fn(),
    onSubmitPrompt: vi.fn(),
    saveTimerRef: { current: null },
    addWriteWorkspace: vi.fn(async () => undefined),
    createFile: vi.fn(async () => null),
    flushSave: vi.fn(async () => true),
    setAssistantOpen: vi.fn(),
    setFileError: vi.fn(),
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
  setProductCapture(false)
  useWriteWorkspaceStore.getState().resetWorkspace()
  vi.unstubAllGlobals()
})

describe('Work document analytics stays optional and reports confirmed operations', () => {
  const epoch = '0a937dda-cee5-462d-9fca-5abc6f514efd'
  function analyticsBridge(overrides: Record<string, unknown> = {}) {
    const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
    vi.stubGlobal('window', { kunGui: { productAnalytics: { track }, ...overrides } })
    setProductCapture(true, epoch)
    return track
  }

  it('reports export success without a task key, file path, document content or title', async () => {
    const track = analyticsBridge({ exportWriteDocument: vi.fn(async () => ({ ok: true })) })
    await createWriteWorkspaceFileActions(actionParams()).exportCurrentFile('docx')
    expect(track).toHaveBeenCalledExactlyOnceWith({ name: 'work_document_action', properties: { mode: 'work', action: 'export' } }, epoch)
  })

  it.each([{ ok: false, canceled: true }, { ok: false, message: 'private error' }])('ignores canceled or failed exports: %j', async result => {
    const track = analyticsBridge({ exportWriteDocument: vi.fn(async () => result) })
    await createWriteWorkspaceFileActions(actionParams()).exportCurrentFile('pdf')
    expect(track).not.toHaveBeenCalled()
  })

  it('retains normal export after consent is withdrawn during the save dialog', async () => {
    const track = analyticsBridge({ exportWriteDocument: vi.fn(async () => { setProductCapture(false); return { ok: true } }) })
    const showExportNotice = vi.fn()
    await createWriteWorkspaceFileActions(actionParams({ showExportNotice })).exportCurrentFile('pdf')
    expect(showExportNotice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }))
    expect(track).not.toHaveBeenCalled()
  })

  it('does not attribute a successful clipboard operation to a new account epoch', async () => {
    const track = analyticsBridge({ copyWriteDocumentAsRichText: vi.fn(async () => {
      setProductCapture(true, 'bf5bcf48-b546-4b2e-bab1-154f8fa31f56')
      return { ok: true }
    }) })
    await createWriteWorkspaceFileActions(actionParams()).copyCurrentFileAsRichText()
    expect(track).not.toHaveBeenCalled()
  })
})

describe('Write presentation action', () => {
  it('routes a new request through the slides skill', async () => {
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
    expect(prompt.startsWith('/slides ')).toBe(true)
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
