import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneratedDocumentFilesPanel } from './GeneratedDocumentFilesPanel'
import type { GeneratedDocumentArtifact } from './generated-document-artifacts'

const actionMocks = vi.hoisted(() => ({
  open: vi.fn(),
  reveal: vi.fn()
}))

vi.mock('../../lib/open-workspace-path', () => ({
  openWorkspaceFileWithSystemDefault: actionMocks.open,
  revealWorkspaceFileInFileManager: actionMocks.reveal
}))

vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    generatedDocumentFilesTitle: 'Generated files',
    generatedDocumentKindWord: 'Word document',
    generatedDocumentKindSpreadsheet: 'Spreadsheet',
    generatedDocumentKindPdf: 'PDF document',
    generatedDocumentKindKunPpt: 'Kun presentation',
    generatedDocumentKindPresentation: 'Presentation',
    generatedDocumentPreview: 'Preview',
    generatedDocumentOpenOptions: 'Open options',
    generatedDocumentOpenSystem: 'Open with system default app',
    generatedDocumentOpenFailed: 'Open failed',
    generatedDocumentRevealFailed: 'Reveal failed',
    generatedDocumentAllFilesHint: 'Preview or download files',
    generatedDocumentView: 'View',
    fileTreeRevealInFileManager: 'Reveal in file manager'
  }
  return {
    useTranslation: () => ({
      t: (key: string, options?: { name?: string; count?: number }) => {
        if (key === 'generatedDocumentPreviewNamed') return `Preview ${options?.name ?? ''}`
        if (key === 'generatedDocumentAllFiles') return `All files (${options?.count ?? 0})`
        return labels[key] ?? key
      }
    })
  }
})

const files: GeneratedDocumentArtifact[] = [
  {
    path: 'reports/summary.docx',
    name: 'summary.docx',
    kind: 'word',
    extension: 'DOCX',
    byteSize: 35_700
  },
  {
    path: 'reports/data.xlsx',
    name: 'data.xlsx',
    kind: 'spreadsheet',
    extension: 'XLSX'
  },
  {
    path: 'reports/appendix.pdf',
    name: 'appendix.pdf',
    kind: 'pdf',
    extension: 'PDF'
  }
]

describe('GeneratedDocumentFilesPanel', () => {
  let renderer: ReactTestRenderer
  const onPreview = vi.fn()
  const onOpenAll = vi.fn()
  const logError = vi.fn(async () => undefined)

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    actionMocks.open.mockReset().mockResolvedValue({
      ok: true,
      path: '/workspace/reports/summary.docx',
      editorId: 'system'
    })
    actionMocks.reveal.mockReset().mockResolvedValue({
      ok: true,
      path: '/workspace/reports/summary.docx',
      editorId: 'file-manager'
    })
    onPreview.mockReset()
    onOpenAll.mockReset()
    logError.mockClear()
    vi.stubGlobal('window', { kunGui: { logError } })
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    await act(async () => {
      renderer = create(createElement(GeneratedDocumentFilesPanel, {
        files,
        workspaceRoot: '/workspace',
        onPreview,
        onOpenAll
      }))
    })
  })

  afterEach(async () => {
    await act(async () => renderer.unmount())
    vi.unstubAllGlobals()
  })

  it('shows only two recent files and always keeps the all-files entry', async () => {
    expect(renderer.root.findAllByProps({ 'data-generated-document-card': true })).toHaveLength(2)
    expect(renderer.root.findByProps({ children: 'summary.docx' })).toBeTruthy()
    expect(renderer.root.findByProps({ children: 'data.xlsx' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: 'appendix.pdf' })).toHaveLength(0)

    const allFiles = renderer.root.findByProps({ 'data-generated-document-all': true })
    await act(async () => allFiles.props.onClick())
    expect(onOpenAll).toHaveBeenCalledWith(files)
  })

  it('uses in-app preview as the primary file action', async () => {
    const preview = renderer.root.findByProps({ 'aria-label': 'Preview summary.docx' })
    await act(async () => preview.props.onClick())
    expect(onPreview).toHaveBeenCalledWith(files[0])
    expect(actionMocks.open).not.toHaveBeenCalled()
  })

  it('offers system open and file-manager reveal as secondary actions', async () => {
    const menuButtons = renderer.root.findAllByProps({ 'aria-label': 'Open options' })
    await act(async () => menuButtons[0].props.onClick())
    let menuItems = renderer.root.findAllByProps({ role: 'menuitem' })
    await act(async () => menuItems[0].props.onClick())
    expect(actionMocks.open).toHaveBeenCalledWith(
      'reports/summary.docx',
      '/workspace',
      undefined
    )

    await act(async () => menuButtons[0].props.onClick())
    menuItems = renderer.root.findAllByProps({ role: 'menuitem' })
    await act(async () => menuItems[1].props.onClick())
    expect(actionMocks.reveal).toHaveBeenCalledWith(
      'reports/summary.docx',
      '/workspace',
      undefined
    )
  })

  it('forwards the trusted Kun presentation digest to external actions', async () => {
    const htmlFile: GeneratedDocumentArtifact = {
      path: 'brief.kun-ppt.html',
      name: 'brief.kun-ppt.html',
      kind: 'kun-html',
      extension: 'HTML',
      contentSha256: 'a'.repeat(64)
    }
    await act(async () => renderer.update(createElement(GeneratedDocumentFilesPanel, {
      files: [htmlFile],
      workspaceRoot: '/workspace',
      onPreview,
      onOpenAll
    })))

    const menuButton = renderer.root.findByProps({ 'aria-label': 'Open options' })
    await act(async () => menuButton.props.onClick())
    const menuItems = renderer.root.findAllByProps({ role: 'menuitem' })
    await act(async () => menuItems[0].props.onClick())
    expect(actionMocks.open).toHaveBeenCalledWith(
      'brief.kun-ppt.html',
      '/workspace',
      'a'.repeat(64)
    )
  })

  it('keeps cards visible and reports bounded external-action failures', async () => {
    actionMocks.open.mockResolvedValueOnce({ ok: false, message: 'No associated application' })
    const menuButton = renderer.root.findAllByProps({ 'aria-label': 'Open options' })[0]
    await act(async () => menuButton.props.onClick())
    const menuItems = renderer.root.findAllByProps({ role: 'menuitem' })
    await act(async () => menuItems[0].props.onClick())

    expect(renderer.root.findByProps({ children: 'Open failed' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ 'data-generated-document-card': true })).toHaveLength(2)
    expect(logError).toHaveBeenCalledWith(
      'generated-document-open',
      'Failed to open generated document',
      expect.objectContaining({ action: 'open', message: 'No associated application' })
    )
  })
})
