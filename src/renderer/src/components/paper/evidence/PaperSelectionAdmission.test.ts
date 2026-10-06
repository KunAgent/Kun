// @vitest-environment jsdom
import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaperSelection } from '../reader/use-paper-selection'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { usePaperReadingRequest } from '../../../paper/paper-reading-request'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { entry, hash, render } from './paper-evidence-test-support'

vi.mock('../../write/WritePdfPage', () => ({
  selectionFromPdf: () => ({ text: 'Selected source passage', charCount: 23, ranges: [], sourceKind: 'pdf', pageStart: 2,
    rects: [{ page: 2, x: 10, y: 20, width: 30, height: 10 }] }),
  emptyPdfSelection: () => ({ text: '', charCount: 0, ranges: [] })
}))

let tree: ReactTestRenderer | undefined
let selection: ReturnType<typeof usePaperSelection>
let root: HTMLElement
const bridge = { input: '', setInput: vi.fn(), submit: vi.fn() }
function Hook({ withMetadata, versionHash = hash }: { withMetadata: boolean; versionHash?: string }) {
  selection = usePaperSelection({ rootRef: { current: root }, workspaceRoot: '/library', unitDir: entry.unitDir, pdfSha256: versionHash, onSelectionChange: vi.fn(),
    paper: withMetadata ? { unitDir: entry.unitDir, meta: entry.meta, pdfSha256: versionHash } : undefined })
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
  usePaperReadingRequest.setState({ request: null })
  usePaperModeStore.setState({ entries: [], entriesLoading: true, composerBridge: bridge })
  usePaperMarksStore.setState({ workspaceRoot: '/library', unitDir: entry.unitDir, items: [], cards: {}, dirty: false })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/library', activeFilePath: '/library/papers/a/paper.pdf', workSurface: 'papers' })
})
afterEach(async () => {
  await act(async () => tree?.unmount()); tree = undefined
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('selected paper passage admission', () => {
  async function capture(withMetadata: boolean) {
    tree = await render(createElement(Hook, { withMetadata }))
    await act(async () => { selection.captureSelectionSoon(); vi.runOnlyPendingTimers() })
    expect(selection.pending?.text).toBe('Selected source passage')
  }

  it('opens a bounded selected-passage request when metadata is available', async () => {
    await capture(true)
    await act(async () => selection.submitQuickAsk('Why this qualifier?'))
    expect(bridge.submit).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toMatchObject({ unitDir: entry.unitDir,
      selection: { text: 'Selected source passage', page: 2, pdfSha256: hash }, question: 'Why this qualifier?' })
  })

  it('never sends a selected passage question through an unbounded bridge when metadata is missing', async () => {
    await capture(false)
    await act(async () => selection.submitQuickAsk('Why this qualifier?'))
    expect(bridge.submit).not.toHaveBeenCalled()
  })

  it('does not relabel a pending old passage with a replacement PDF hash when asking', async () => {
    await capture(true)
    await act(async () => tree!.update(createElement(Hook, { withMetadata: true, versionHash: 'b'.repeat(64) })))
    await act(async () => selection.submitQuickAsk('Explain the old selection'))
    expect(usePaperReadingRequest.getState().request).toBeNull()
    expect(bridge.submit).not.toHaveBeenCalled()
  })

  it('does not bind a pending old highlight to replacement PDF bytes', async () => {
    await capture(true)
    await act(async () => tree!.update(createElement(Hook, { withMetadata: true, versionHash: 'b'.repeat(64) })))
    await act(async () => selection.addHighlight('yellow'))
    expect(usePaperMarksStore.getState().items).toHaveLength(0)
  })

  it('opens Add to conversation as a bounded selected-passage dialog without creating a generic quote chip', async () => {
    const quote = vi.spyOn(useWriteWorkspaceStore.getState(), 'quoteCurrentSelection')
    try {
      await capture(true)
      await act(async () => selection.addToConversation())
      expect(quote).not.toHaveBeenCalled()
      expect(bridge.submit).not.toHaveBeenCalled()
      expect(usePaperReadingRequest.getState().request).toMatchObject({ workspaceRoot: '/library', unitDir: entry.unitDir,
        selection: { text: 'Selected source passage', page: 2, pdfSha256: hash } })
      expect(selection.pending).toBeNull()
    } finally { quote.mockRestore() }
  })

  it.each(['highlight', 'quick-ask'])('does not apply %s to a different library that has the same unitDir', async (action) => {
    await capture(true)
    usePaperMarksStore.setState({ workspaceRoot: '/other-library', items: [], cards: {}, dirty: false })
    await act(async () => {
      if (action === 'highlight') selection.addHighlight('yellow')
      else selection.submitQuickAsk('Question about the old library')
    })
    expect(usePaperMarksStore.getState().items).toEqual([])
    expect(usePaperMarksStore.getState().cards).toEqual({})
    expect(usePaperReadingRequest.getState().request).toBeNull()
  })
})
