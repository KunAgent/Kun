import { createElement, createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WriteWorkspaceToolbar } from './WriteWorkspaceToolbar'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

const noop = (): void => undefined
type ToolbarProps = ComponentProps<typeof WriteWorkspaceToolbar>

function textToolbarProps(inlineCompletionEnabled: boolean): ToolbarProps {
  return {
    embedded: true,
    showSidebarToggle: false,
    activeFileIsImage: false,
    activeFileIsPdf: false,
    activeFileIsOffice: false,
    activeFileIsCode: false,
    activeFileIsText: true,
    activeFileLabel: 'brief.md',
    activeFileName: 'brief.md',
    activeFilePath: '/workspace/brief.md',
    documentStatsLabel: null,
    inlineCompletionEnabled,
    exportInFlight: false,
    exportMenuOpen: false,
    exportMenuRef: createRef<HTMLDivElement>(),
    leftSidebarCollapsed: false,
    isMarkdown: true,
    surfacePlain: false,
    onToggleSurface: noop,
    onCopyRichText: noop,
    onCopyXArticle: noop,
    onCopyXArticleImage: noop,
    xArticleImageCount: 0,
    xArticleImageIndex: 0,
    onExportFile: noop,
    onGeneratePresentation: noop,
    onSave: noop,
    onToggleInlineCompletion: noop,
    onToggleLeftSidebar: noop,
    presentationEnabled: false,
    presentationInFlight: false,
    readOnly: false,
    saveLabel: 'writeSaved',
    saveStatus: 'saved',
    setExportMenuOpen: noop
  }
}

describe('WriteWorkspaceToolbar code preview', () => {
  it('shows read-only source status without writing or export controls', () => {
    const html = renderToStaticMarkup(createElement(WriteWorkspaceToolbar, {
      embedded: true,
      showSidebarToggle: false,
      activeFileIsImage: false,
      activeFileIsPdf: false,
      activeFileIsOffice: false,
      activeFileIsCode: true,
      activeFileIsText: false,
      activeFileLabel: 'src/main.ts',
      activeFileName: 'main.ts',
      activeFilePath: '/repo/src/main.ts',
      documentStatsLabel: null,
      inlineCompletionEnabled: false,
      exportInFlight: false,
      exportMenuOpen: false,
      exportMenuRef: createRef<HTMLDivElement>(),
      leftSidebarCollapsed: false,
      isMarkdown: false,
      surfacePlain: false,
      onToggleSurface: noop,
      onCopyRichText: noop,
      onCopyXArticle: noop,
      onCopyXArticleImage: noop,
      xArticleImageCount: 0,
      xArticleImageIndex: 0,
      onExportFile: noop,
      onGeneratePresentation: noop,
      onSave: noop,
      onToggleInlineCompletion: noop,
      onToggleLeftSidebar: noop,
      presentationEnabled: false,
      presentationInFlight: false,
      readOnly: true,
      saveLabel: 'writeSaved',
      saveStatus: 'saved',
      setExportMenuOpen: noop
    }))

    expect(html).toContain('writeModeSource')
    expect(html).toContain('writeReadOnly')
    expect(html).not.toContain('writeSaveFile')
    expect(html).not.toContain('writeExport')
    expect(html).not.toContain('writeInlineCompletion')
  })

  it('renders an explicit inline-completion switch for both states', () => {
    const enabledHtml = renderToStaticMarkup(createElement(WriteWorkspaceToolbar, textToolbarProps(true)))
    const disabledHtml = renderToStaticMarkup(createElement(WriteWorkspaceToolbar, textToolbarProps(false)))

    expect(enabledHtml).toContain('data-inline-completion-state="on"')
    expect(enabledHtml).toContain('writeInlineCompletionToggle')
    expect(enabledHtml).toContain('translate-x-3')
    expect(disabledHtml).toContain('data-inline-completion-state="off"')
    expect(disabledHtml).toContain('translate-x-0.5')
  })

  it('exposes save status and a save action for editable XLSX files', () => {
    const html = renderToStaticMarkup(createElement(WriteWorkspaceToolbar, {
      ...textToolbarProps(false),
      activeFileIsOffice: true,
      activeFileIsEditableSpreadsheet: true,
      activeFileIsText: false,
      activeFileName: 'book.xlsx',
      activeFilePath: '/workspace/book.xlsx',
      saveLabel: 'writeUnsaved',
      saveStatus: 'dirty'
    }))
    expect(html).toContain('writeSpreadsheetEditable')
    expect(html).toContain('writeUnsaved')
    expect(html).toContain('title="writeUnsaved"')
    expect(html).not.toContain('writeReadOnly')
  })

  it('lists X article clipboard copy next to online-doc copy', () => {
    const html = renderToStaticMarkup(createElement(WriteWorkspaceToolbar, {
      ...textToolbarProps(false),
      exportMenuOpen: true
    }))
    expect(html).toContain('writeCopyRichText')
    expect(html).toContain('writeCopyXArticle')
    expect(html).toContain('writeCopyXArticleImageEmpty')
    expect(html).not.toContain('writeCopyXArticleTitle')
    expect(html).toMatch(/disabled/)
  })

  it('shows the next X image slot after a body copy', () => {
    const html = renderToStaticMarkup(createElement(WriteWorkspaceToolbar, {
      ...textToolbarProps(false),
      exportMenuOpen: true,
      xArticleImageCount: 3,
      xArticleImageIndex: 0
    }))
    expect(html).toContain('writeCopyXArticleImage')
    expect(html).not.toContain('writeCopyXArticleImageEmpty')
    expect(html).toMatch(/role="menuitem"(?![^>]*\bdisabled\b)[^>]*>[\s\S]*?writeCopyXArticleImage/)
  })
})
