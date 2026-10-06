import { createElement, type ReactNode } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperWorkspaceView } from '../PaperWorkspaceView'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperReadingRequest } from '../../../paper/paper-reading-request'
import { usePaperStore } from '../../../write/paper/paper-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { entry, render } from './paper-evidence-test-support'

vi.mock('../../write/WriteWorkspaceView', () => ({ WriteWorkspaceView: ({ onSubmitPrompt }: { onSubmitPrompt?: (value: string) => void }) =>
  createElement('button', { 'data-testid': 'nested-workspace-quick-ask', onClick: () => onSubmitPrompt?.('Explain this selected passage') }, 'Ask') }))
vi.mock('../../write/write-pdf-renderer-context', () => ({ WritePdfRendererProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('../reader/PaperPdfReader', () => ({ PaperPdfReader: () => null }))
vi.mock('../PaperImportDialogHost', () => ({ PaperImportDialogHost: () => null }))
vi.mock('../PaperLibraryOnboarding', () => ({ PaperLibraryOnboarding: () => null }))
vi.mock('../sidebar/PaperMetadataDrawer', () => ({ PaperMetadataDrawer: () => null }))
vi.mock('../PaperTaskRing', () => ({ PaperTaskRing: () => null }))
vi.mock('./PaperReadingDialog', () => ({ PaperReadingDialogHost: () => null }))

let tree: ReactTestRenderer | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: {} })
  usePaperReadingRequest.setState({ request: null })
  usePaperModeStore.setState({ entries: [], entriesLoading: true, composerBridge: null })
  usePaperStore.setState({ unitsByDir: { [entry.unitDir]: { ...entry.meta, version: 1, pdfFile: 'paper.pdf' } } })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/library', activeFilePath: '/library/papers/a/paper.pdf',
    workSurface: 'papers', paperMode: { ...useWriteWorkspaceStore.getState().paperMode, libraries: [] } })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('paper workspace composer bridge admission', () => {
  it('uses a bounded dialog when library metadata is present', async () => {
    usePaperModeStore.setState({ entries: [entry], entriesLoading: false })
    const onSubmitPrompt = vi.fn()
    tree = await render(createElement(PaperWorkspaceView, { leftSidebarCollapsed: false, onToggleLeftSidebar: vi.fn(),
      input: '', setInput: vi.fn(), onSubmitPrompt, rightPanel: null }))
    await act(async () => usePaperModeStore.getState().composerBridge?.submit?.('Explain the selected method'))
    expect(onSubmitPrompt).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toMatchObject({ unitDir: entry.unitDir, question: 'Explain the selected method' })
  })

  it('never invokes generic submit while known paper metadata is absent from the library index', async () => {
    const onSubmitPrompt = vi.fn()
    tree = await render(createElement(PaperWorkspaceView, { leftSidebarCollapsed: false, onToggleLeftSidebar: vi.fn(),
      input: '', setInput: vi.fn(), onSubmitPrompt, rightPanel: null }))
    expect(usePaperModeStore.getState().composerBridge?.submit).toBeTypeOf('function')
    await act(async () => usePaperModeStore.getState().composerBridge?.submit?.('Explain the selected method'))
    expect(onSubmitPrompt).not.toHaveBeenCalled()
  })

  it('routes nested workspace quick-ask through the same bounded admission boundary', async () => {
    usePaperModeStore.setState({ entries: [entry], entriesLoading: false })
    const originalOpen = useWriteWorkspaceStore.getState().openPaperViewTab
    useWriteWorkspaceStore.setState({ paperMode: { ...useWriteWorkspaceStore.getState().paperMode, libraries: ['/library'] },
      openPaperViewTab: vi.fn() })
    const onSubmitPrompt = vi.fn()
    try {
      tree = await render(createElement(PaperWorkspaceView, { leftSidebarCollapsed: false, onToggleLeftSidebar: vi.fn(),
        input: '', setInput: vi.fn(), onSubmitPrompt, rightPanel: null }))
      await act(async () => tree!.root.findByProps({ 'data-testid': 'nested-workspace-quick-ask' }).props.onClick())
      expect(onSubmitPrompt).not.toHaveBeenCalled()
    } finally { await act(async () => useWriteWorkspaceStore.setState({ openPaperViewTab: originalOpen })) }
  })
})
