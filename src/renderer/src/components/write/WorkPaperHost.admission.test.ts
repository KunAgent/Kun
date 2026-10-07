import { createElement, type ReactNode } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkPaperHost } from './WorkPaperHost'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { usePaperReadingRequest } from '../../paper/paper-reading-request'
import { usePaperStore } from '../../write/paper/paper-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { entry, render } from '../paper/evidence/paper-evidence-test-support'

vi.mock('./write-pdf-renderer-context', () => ({ WritePdfRendererProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('../paper/reader/PaperPdfReader', () => ({ PaperPdfReader: () => null }))
vi.mock('../paper/PaperImportDialogHost', () => ({ PaperImportDialogHost: () => null }))
vi.mock('../paper/sidebar/PaperMetadataDrawer', () => ({ PaperMetadataDrawer: () => null }))
vi.mock('../paper/PaperTaskRing', () => ({ PaperTaskRing: () => null }))
vi.mock('../paper/evidence/PaperReadingDialog', () => ({ PaperReadingDialogHost: () => null }))
vi.mock('../paper/batch/PaperBatchInterpretDialog', () => ({ PaperBatchInterpretDialogHost: () => null }))

let tree: ReactTestRenderer | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: {} })
  usePaperReadingRequest.setState({ request: null })
  usePaperModeStore.setState({ entries: [], entriesLoading: true, composerBridge: null })
  usePaperStore.setState({ unitsByDir: { [entry.unitDir]: { ...entry.meta, version: 1, pdfFile: 'paper.pdf' } } })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/space', activeFilePath: '/space/papers/a/paper.pdf' })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

function host(onSubmitPrompt: (value: string) => void) {
  return createElement(WorkPaperHost, {
    leftSidebarCollapsed: false, onToggleLeftSidebar: vi.fn(), input: '', setInput: vi.fn(), onSubmitPrompt,
    conversationStage: false, rightPanel: null,
    children: (submit: ((value: string) => void) | undefined) => createElement('button', {
      'data-testid': 'nested-workspace-quick-ask', onClick: () => submit?.('Explain this selected passage')
    }, 'Ask')
  })
}

describe('Work paper host composer admission', () => {
  it('uses a bounded dialog when library metadata is present', async () => {
    usePaperModeStore.setState({ entries: [entry], entriesLoading: false })
    const onSubmitPrompt = vi.fn()
    tree = await render(host(onSubmitPrompt))
    await act(async () => usePaperModeStore.getState().composerBridge?.submit?.('Explain the selected method'))
    expect(onSubmitPrompt).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toMatchObject({ unitDir: entry.unitDir, question: 'Explain the selected method' })
  })

  it('never invokes generic submit while known paper metadata is absent from the library index', async () => {
    const onSubmitPrompt = vi.fn()
    tree = await render(host(onSubmitPrompt))
    expect(usePaperModeStore.getState().composerBridge?.submit).toBeTypeOf('function')
    await act(async () => usePaperModeStore.getState().composerBridge?.submit?.('Explain the selected method'))
    expect(onSubmitPrompt).not.toHaveBeenCalled()
  })

  it('routes the editor quick-ask through the same bounded admission boundary', async () => {
    usePaperModeStore.setState({ entries: [entry], entriesLoading: false })
    const onSubmitPrompt = vi.fn()
    tree = await render(host(onSubmitPrompt))
    await act(async () => tree!.root.findByProps({ 'data-testid': 'nested-workspace-quick-ask' }).props.onClick())
    expect(onSubmitPrompt).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toMatchObject({ unitDir: entry.unitDir })
  })

  it('lets an ordinary document quick-ask through as a normal turn', async () => {
    useWriteWorkspaceStore.setState({ activeFilePath: '/space/notes/plan.md' })
    const onSubmitPrompt = vi.fn()
    tree = await render(host(onSubmitPrompt))
    await act(async () => tree!.root.findByProps({ 'data-testid': 'nested-workspace-quick-ask' }).props.onClick())
    expect(onSubmitPrompt).toHaveBeenCalledWith('Explain this selected passage')
  })
})
