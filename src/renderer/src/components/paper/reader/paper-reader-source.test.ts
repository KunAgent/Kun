/** @vitest-environment jsdom */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { paperReaderAutoMarkReading, paperReaderRecordOpened, paperReaderRecordPage } from '../../../paper/paper-reader-actions'
import { paperSpaceItems, usePaperSpaceStore } from '../../../paper/paper-space-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperReaderPosition } from './use-paper-reader-position'
import { findPaperReferenceEntry, usePaperReferenceLibrary } from './use-paper-reference-library'
import { PaperReaderHostContext, type PaperReaderHost } from './paper-reader-host'

const calls = vi.hoisted(() => ({ open: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), legacyOpen: vi.fn(async () => undefined) }))
vi.mock('../../../paper/paper-space', () => ({ openPaperSpaceItem: calls.open, refreshPaperSpace: calls.refresh }))
vi.mock('../../../paper/paper-library-actions', () => ({ openLibraryEntry: calls.legacyOpen }))
const write = vi.fn()
const read = vi.fn()
const update = vi.fn()
const scroll = vi.fn()
const document = {} as PDFDocumentProxy
const makeEntry = (title: string): PaperLibraryEntry => ({
  unitDir: 'papers/a', group: '', hasPdf: true, hasNotes: false, interpretationCount: 0,
  meta: { version: 2, slug: 'a', title, authors: [], doi: '10.1234/test', arxivId: '2401.12345v2', importedAt: '2026-01-01', status: 'unread' }
})
let tree: ReactTestRenderer | undefined
let references: ReturnType<typeof usePaperReferenceLibrary>
function ReferenceProbe({ root }: { root: string }) { references = usePaperReferenceLibrary(root); return null }
function PositionProbe({ root }: { root: string }) {
  usePaperReaderPosition({ pdfDocument: document, unitDir: 'papers/a', workspaceRoot: root,
    libraryEntry: undefined, currentPage: 2, pageCount: 10, scrollToPage: scroll, publishContext: false })
  return null
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.clearAllMocks()
  usePaperSpaceStore.setState(usePaperSpaceStore.getInitialState(), true)
  const entriesByRoot = { '/legacy': [makeEntry('Legacy')], '/other': [makeEntry('Other')] }
  usePaperSpaceStore.setState({ entriesByRoot, items: paperSpaceItems(entriesByRoot) })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/work', paperMode: { ...useWriteWorkspaceStore.getState().paperMode, autoMarkReading: true } })
  usePaperModeStore.setState({ entries: [makeEntry('Work')], readerPage: { unitDir: 'work/paper', page: 7, pageCount: 10 } })
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue({ units: {} })
  update.mockReset().mockImplementation(async ({ workspaceRoot, patch }) => ({ ok: true, meta: { ...makeEntry(workspaceRoot).meta, ...patch } }))
  Object.assign(window, { kunGui: { paperLocalStateWrite: write, paperLocalStateRead: read, paperUpdateMeta: update } })
})
afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as unknown as { kunGui?: unknown }).kunGui
})

describe('reader source boundaries', () => {
  it('records open/page/status on the supplied source and leaves a same-path Work unit unchanged', async () => {
    const entry = usePaperSpaceStore.getState().entriesByRoot['/legacy'][0]
    await paperReaderRecordOpened(entry.unitDir, '/legacy')
    await paperReaderRecordPage(entry.unitDir, 4, 10, '/legacy')
    await paperReaderAutoMarkReading(entry, '/legacy')
    expect(write.mock.calls.map(([payload]) => payload.libraryRoot)).toEqual(['/legacy', '/legacy'])
    expect(update).toHaveBeenCalledWith({ workspaceRoot: '/legacy', unitDir: 'papers/a', patch: { status: 'reading' } })
    expect(usePaperModeStore.getState().entries[0].meta).toMatchObject({ title: 'Work', status: 'unread' })
    expect(usePaperSpaceStore.getState().entriesByRoot['/legacy'][0]).toMatchObject({ lastPage: 4, meta: { status: 'reading' } })
    expect(usePaperSpaceStore.getState().entriesByRoot['/other'][0].meta.status).toBe('unread')
  })

  it('cancels old page restore and debounce callbacks when the source changes, without publishing Work context', async () => {
    let finish!: (value: unknown) => void
    read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    read.mockResolvedValueOnce({ units: { 'papers/a': { lastPage: 3 } } })
    await act(async () => { tree = create(createElement(PositionProbe, { root: '/legacy' })) })
    await act(async () => { tree!.update(createElement(PositionProbe, { root: '/other' })) })
    expect(scroll).toHaveBeenCalledWith(3)
    await act(async () => { finish({ units: { 'papers/a': { lastPage: 8 } } }) })
    await act(async () => { vi.advanceTimersByTime(1300) })
    expect(scroll).not.toHaveBeenCalledWith(8)
    expect(write.mock.calls.filter(([payload]) => payload.patch.lastPage).map(([payload]) => payload.libraryRoot)).toEqual(['/other'])
    expect(usePaperModeStore.getState().readerPage?.unitDir).toBe('work/paper')
  })

  it('looks up all global sources, preferring the reader source and opening its original item', async () => {
    await act(async () => { tree = create(createElement(PaperReaderHostContext.Provider, { value: {} as PaperReaderHost }, createElement(ReferenceProbe, { root: '/legacy' }))) })
    const match = findPaperReferenceEntry(references.entries, { n: 1, arxivId: '2401.12345' })!
    expect(match.meta.title).toBe('Legacy')
    await references.openEntry(match)
    expect(calls.open).toHaveBeenCalledWith(expect.objectContaining({ libraryRoot: '/legacy', entry: match }))
    expect(calls.legacyOpen).not.toHaveBeenCalled()
    await references.refresh()
    expect(calls.refresh).toHaveBeenCalledTimes(1)
  })

  it('retains an explicit source for legacy reader references', async () => {
    await act(async () => { tree = create(createElement(ReferenceProbe, { root: '/work' })) })
    expect(references.entries.map((entry) => entry.meta.title)).toEqual(['Work'])
    await references.openEntry(references.entries[0])
    expect(calls.legacyOpen).toHaveBeenCalledWith(references.entries[0], '/work')
    expect(calls.open).not.toHaveBeenCalled()
  })
})
