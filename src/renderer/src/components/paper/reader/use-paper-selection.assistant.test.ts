// @vitest-environment jsdom
import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaperSelection } from './use-paper-selection'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { entry, hash, render } from '../evidence/paper-evidence-test-support'

vi.mock('../../write/WritePdfPage', () => ({
  selectionFromPdf: () => ({ text: 'Selected source passage', charCount: 23, ranges: [], sourceKind: 'pdf', pageStart: 2,
    rects: [{ page: 2, x: 10, y: 20, width: 30, height: 10 }] }),
  emptyPdfSelection: () => ({ text: '', charCount: 0, ranges: [] })
}))

let tree: ReactTestRenderer | undefined
let selection: ReturnType<typeof usePaperSelection>
let root: HTMLElement
const bridge = { input: '', setInput: vi.fn(), submit: vi.fn() }
function Hook({ versionHash = hash }: { versionHash?: string }) {
  selection = usePaperSelection({ rootRef: { current: root }, workspaceRoot: '/library', unitDir: entry.unitDir,
    pdfSha256: versionHash, onSelectionChange: vi.fn() })
  return null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.clearAllMocks()
  root = document.createElement('div')
  const page = document.createElement('div')
  page.dataset.writePdfPage = '2'
  Object.defineProperties(page, { offsetWidth: { value: 100 }, offsetHeight: { value: 100 } })
  root.append(page)
  usePaperModeStore.setState({ entries: [], entriesLoading: true, composerBridge: bridge })
  usePaperMarksStore.setState({ workspaceRoot: '/library', unitDir: entry.unitDir, items: [], cards: {}, dirty: false })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/library', activeFilePath: '/library/papers/a/paper.pdf',
    quotedSelections: [], documentsByPath: {} })
})
afterEach(async () => {
  await act(async () => tree?.unmount()); tree = undefined
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('reader selections go to the Work assistant', () => {
  async function capture() {
    tree = await render(createElement(Hook, {}))
    await act(async () => { selection.captureSelectionSoon(); vi.runOnlyPendingTimers() })
    expect(selection.pending?.text).toBe('Selected source passage')
  }

  it('Add to conversation quotes the passage with its page and opens no dialog', async () => {
    await capture()
    await act(async () => selection.addToConversation())
    const quotes = useWriteWorkspaceStore.getState().quotedSelections
    expect(quotes).toHaveLength(1)
    expect(quotes[0]).toMatchObject({ text: 'Selected source passage', sourceKind: 'pdf', pageStart: 2, pageEnd: 2 })
    expect(useWriteWorkspaceStore.getState().writeRightPanel).toMatchObject({ expanded: true, activeId: 'assistant' })
    expect(bridge.submit).not.toHaveBeenCalled()
    expect(selection.pending).toBeNull()
  })

  it('a quick ask quotes the passage and sends the question as a normal turn', async () => {
    await capture()
    await act(async () => selection.submitQuickAsk('Why this qualifier?'))
    expect(useWriteWorkspaceStore.getState().quotedSelections[0]).toMatchObject({ text: 'Selected source passage', pageStart: 2 })
    expect(bridge.submit).toHaveBeenCalledWith('Why this qualifier?')
    expect(Object.values(usePaperMarksStore.getState().cards)).toEqual([
      expect.objectContaining({ kind: 'ask', page: 2, question: 'Why this qualifier?' })
    ])
  })

  it('drops a pending passage captured from older PDF bytes', async () => {
    await capture()
    await act(async () => tree!.update(createElement(Hook, { versionHash: 'b'.repeat(64) })))
    await act(async () => selection.submitQuickAsk('Explain the old selection'))
    await act(async () => selection.addToConversation())
    expect(useWriteWorkspaceStore.getState().quotedSelections).toEqual([])
    expect(bridge.submit).not.toHaveBeenCalled()
  })

  it('does not bind a pending old highlight to replacement PDF bytes', async () => {
    await capture()
    await act(async () => tree!.update(createElement(Hook, { versionHash: 'b'.repeat(64) })))
    await act(async () => selection.addHighlight('yellow'))
    expect(usePaperMarksStore.getState().items).toHaveLength(0)
  })

  it.each(['highlight', 'quick-ask'])('does not apply %s to a different library that has the same unitDir', async (action) => {
    await capture()
    usePaperMarksStore.setState({ workspaceRoot: '/other-library', items: [], cards: {}, dirty: false })
    await act(async () => {
      if (action === 'highlight') selection.addHighlight('yellow')
      else selection.submitQuickAsk('Question about the old library')
    })
    expect(usePaperMarksStore.getState().items).toEqual([])
    expect(usePaperMarksStore.getState().cards).toEqual({})
    expect(bridge.submit).not.toHaveBeenCalled()
  })
})
