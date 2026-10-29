import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperReaderHost } from './reader/paper-reader-host'
import type { PendingPaperSelection } from './reader/use-paper-selection'
import type { PaperReaderLayoutPreset } from '../../paper/paper-reader-layout'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { PapersReader, type PapersReaderProps } from './PapersReader'

type PdfProps = {
  filePath: string
  dataBase64: string
  size: number
  mtimeMs: number
  workspaceRoot: string
  unitDirAbs: string
}

const capture = vi.hoisted(() => ({
  host: null as PaperReaderHost | null,
  pdf: [] as PdfProps[],
  notes: [] as { draftKey: string }[]
}))

vi.mock('./reader/PaperUnitPdfReader', async () => {
  const React = await import('react')
  const { usePaperReaderHost } = await import('./reader/paper-reader-host')
  return {
    PaperUnitPdfReader: (props: PdfProps) => {
      capture.pdf.push(props)
      capture.host = usePaperReaderHost()
      return React.createElement('div', { 'data-pdf': props.filePath })
    }
  }
})

vi.mock('./reader/PapersNotesPane', async () => {
  const React = await import('react')
  const { usePaperReaderHost } = await import('./reader/paper-reader-host')
  return {
    PapersNotesPane: (props: { draftKey: string }) => {
      capture.notes.push(props)
      capture.host = usePaperReaderHost()
      return React.createElement('aside', { 'data-notes': props.draftKey })
    }
  }
})

vi.mock('./library/PaperMetaEditDialog', () => ({ PaperMetaEditDialog: () => null }))

const layout = vi.hoisted(() => ({ read: vi.fn((): PaperReaderLayoutPreset => 'read'), store: vi.fn() }))
vi.mock('../../paper/paper-reader-layout', () => ({
  readPaperReaderLayout: layout.read,
  storePaperReaderLayout: layout.store
}))

const notesApi = vi.hoisted(() => ({
  error: null as string | null,
  load: vi.fn(async (_workspaceRoot: string, _unitDir: string) => undefined),
  prepare: vi.fn(async () => true),
  save: vi.fn(async (_key: string) => true)
}))
vi.mock('../../paper/paper-notes-draft', () => ({
  loadPaperNotesDraft: notesApi.load,
  preparePaperNotesForNavigation: notesApi.prepare,
  savePaperNotesDraft: notesApi.save,
  usePaperNotesDraftStore: (select: (state: { drafts: Record<string, { error: string | null }> }) => unknown) => select({ drafts: {
    ['/library-a\0papers/a']: { error: notesApi.error }
  } })
}))
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }))

// Source keys only need to be distinct per (root, unit); the real helper also
// normalizes separators, which no assertion here depends on.
vi.mock('../../paper/paper-space-store', () => ({
  paperSpaceItemKey: (workspaceRoot: string, unitDir: string) => `${workspaceRoot}\0${unitDir}`
}))
vi.mock('../../paper/paper-space', () => ({ refreshPaperSpace: vi.fn(async () => undefined) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { page?: number }) =>
      key === 'paperSpaceSelectionPage' ? `page ${String(options?.page)}` : key
  })
}))

const readWorkspacePdf = vi.hoisted(() => vi.fn())
const readWorkspaceFile = vi.hoisted(() => vi.fn())

let tree: ReactTestRenderer | undefined

function entry(overrides: Partial<PaperLibraryEntry> = {}): PaperLibraryEntry {
  const hasPdf = overrides.hasPdf !== false
  const base: PaperLibraryEntry = {
    unitDir: 'papers/a',
    meta: {
      version: 2, slug: 'a', title: 'Paper A', authors: [], importedAt: 'now', abstract: 'Abstract A',
      ...(hasPdf ? { pdfFile: 'paper.pdf' } : {})
    },
    hasPdf,
    hasNotes: false,
    interpretationCount: 0,
    group: ''
  }
  return { ...base, ...overrides, meta: { ...base.meta, ...overrides.meta } }
}

function pdfResult(path: string) {
  return { ok: true as const, path, dataBase64: 'cGRm', size: 3, mtimeMs: 1 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function selection(text = 'quoted line', page = 3): PendingPaperSelection {
  return {
    workspaceRoot: '/library-a', unitDir: 'papers/a', text, page,
    rects: [], localRects: [], anchor: { x: 0, y: 0 }
  }
}

async function flush(): Promise<void> {
  await act(async () => undefined)
}

async function render(props: PapersReaderProps): Promise<ReactTestRenderer> {
  let created!: ReactTestRenderer
  await act(async () => { created = create(createElement(PapersReader, props)) })
  // Let the immediate readWorkspacePdf/listNotes promises settle so the
  // captured host reflects the source-scoped render, not the first paint.
  await flush()
  return created
}

function nodeText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('')
}

function findButton(target: ReactTestRenderer, label: string): ReactTestInstance {
  return target.root.find((node) => node.type === 'button' && nodeText(node).includes(label))
}

async function click(target: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => { findButton(target, label).props.onClick() })
}

function promptTextareas(target: ReactTestRenderer): ReactTestInstance[] {
  return target.root.findAllByProps({ 'aria-label': 'paperSpaceAskPaper' })
}

function notesPanes(target: ReactTestRenderer): ReactTestInstance[] {
  return target.root.findAll((node) => node.type === 'aside' && Boolean(node.props['data-notes']))
}

function promptTextareaValue(target: ReactTestRenderer): string {
  return String(promptTextareas(target)[0]?.props.value)
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  capture.host = null
  capture.pdf.length = 0
  capture.notes.length = 0
  layout.read.mockReturnValue('read')
  notesApi.error = null
  notesApi.load.mockResolvedValue(undefined)
  notesApi.prepare.mockResolvedValue(true)
  readWorkspacePdf.mockImplementation(async ({ path }: { path: string }) => pdfResult(path))
  readWorkspaceFile.mockResolvedValue({ ok: true, content: 'translated' })
  vi.stubGlobal('window', {
    kunGui: { readWorkspacePdf, readWorkspaceFile },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }
  })
})

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
})

describe('PapersReader source scoping', () => {
  it('renders metadata and notes for a unit without a PDF', async () => {
    const onlyNotes = entry({ hasPdf: false })
    tree = await render({ workspaceRoot: '/library-a', entry: onlyNotes, onBack: vi.fn() })

    const metadata = tree.root.find((node) => node.type === 'div' && node.props.className === 'papers-reader-metadata')
    expect(nodeText(metadata)).toContain('writePaperMissingPdf')
    expect(nodeText(metadata)).toContain('Abstract A')
    expect(readWorkspacePdf).not.toHaveBeenCalled()
    expect(capture.pdf).toHaveLength(0)
    expect(new Set(capture.notes.map((pane) => pane.draftKey))).toEqual(new Set(['/library-a\0papers/a']))
    expect(notesApi.load).toHaveBeenCalledWith('/library-a', 'papers/a')
    expect(capture.host?.entry).toBe(onlyNotes)
  })

  it('drops a late PDF response from the previous root for the same unitDir', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    readWorkspacePdf
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    tree = await render({ workspaceRoot: '/library-a', entry: entry(), onBack: vi.fn() })
    expect(readWorkspacePdf).toHaveBeenCalledWith({ workspaceRoot: '/library-a', path: '/library-a/papers/a/paper.pdf' })

    await act(async () => {
      tree!.update(createElement(PapersReader, { workspaceRoot: '/library-b', entry: entry(), onBack: vi.fn() }))
    })
    expect(readWorkspacePdf).toHaveBeenLastCalledWith({ workspaceRoot: '/library-b', path: '/library-b/papers/a/paper.pdf' })

    await act(async () => { second.resolve(pdfResult('/library-b/papers/a/paper.pdf')) })
    await flush()
    const freshPaths = capture.pdf.map((props) => props.filePath)
    expect(freshPaths.length).toBeGreaterThan(0)
    expect(new Set(freshPaths)).toEqual(new Set(['/library-b/papers/a/paper.pdf']))

    await act(async () => { first.resolve(pdfResult('/library-a/papers/a/paper.pdf')) })
    await flush()
    expect(capture.pdf.map((props) => props.filePath)).not.toContain('/library-a/papers/a/paper.pdf')
    expect(capture.pdf[capture.pdf.length - 1]?.workspaceRoot).toBe('/library-b')
    expect(tree.root.findAll((node) => node.props.role === 'alert')).toHaveLength(0)
  })
})

describe('PapersReader navigation and layout', () => {
  it('shows a notes save error even when the assistant pane hides notes', async () => {
    notesApi.error = 'Read-only paper source'
    layout.read.mockReturnValue('assistant')
    const onBack = vi.fn()
    notesApi.prepare.mockResolvedValue(false)
    tree = await render({ workspaceRoot: '/library-a', entry: entry(), onBack })
    expect(tree.root.findAll((node) => node.props.role === 'alert').map(nodeText)).toContain('Read-only paper sourcepaperSpaceNotes')
    expect(notesPanes(tree)).toHaveLength(0)
    await act(async () => { capture.host!.onBack() })
    expect(onBack).not.toHaveBeenCalled()
  })

  it('does not persist a layout change from a translated file response after unmount', async () => {
    const pending = deferred<unknown>()
    readWorkspaceFile.mockImplementationOnce(() => pending.promise)
    tree = await render({ workspaceRoot: '/library-a', entry: entry({ hasPdf: false }), onBack: vi.fn() })
    await act(async () => { capture.host!.onOpenTranslated!('translated.md') })
    await act(async () => { tree!.unmount() })
    tree = undefined
    layout.store.mockClear()
    await act(async () => { pending.resolve({ ok: true, content: 'late translation' }) })
    expect(layout.store).not.toHaveBeenCalled()
  })
  it('keeps the reader open when the notes guard refuses to leave', async () => {
    const onBack = vi.fn()
    tree = await render({ workspaceRoot: '/library-a', entry: entry({ hasPdf: false }), onBack })

    notesApi.prepare.mockResolvedValueOnce(false)
    await act(async () => { capture.host!.onBack() })
    expect(notesApi.prepare).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()

    notesApi.prepare.mockResolvedValueOnce(true)
    await act(async () => { capture.host!.onBack() })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('switches reader-local notes and assistant layouts without touching Work layout state', async () => {
    readWorkspacePdf.mockImplementation(() => new Promise(() => undefined))
    const work = useWriteWorkspaceStore.getState()
    const setAssistantOpen = vi.spyOn(work, 'setAssistantOpen')
    const openFile = vi.spyOn(work, 'openFile')
    const setSplitRatio = vi.spyOn(work, 'setSplitRatio')

    tree = await render({ workspaceRoot: '/library-a', entry: entry(), onBack: vi.fn() })
    expect(notesPanes(tree)).toHaveLength(0)

    await click(tree, 'paperSpaceNotes')
    expect(layout.store).toHaveBeenLastCalledWith('notes')
    expect(notesPanes(tree)).toHaveLength(1)
    expect(promptTextareas(tree)).toHaveLength(0)

    await click(tree, 'paperSpaceAssistant')
    expect(layout.store).toHaveBeenLastCalledWith('assistant')
    expect(promptTextareas(tree)).toHaveLength(1)
    expect(notesPanes(tree)).toHaveLength(0)

    expect(setAssistantOpen).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
    expect(setSplitRatio).not.toHaveBeenCalled()
    setAssistantOpen.mockRestore()
    openFile.mockRestore()
    setSplitRatio.mockRestore()
  })
})

describe('PapersReader reader assistant', () => {
  it('stages a quoted passage in its own prompt without sending a model request', async () => {
    const onSubmitPrompt = vi.fn()
    const work = useWriteWorkspaceStore.getState()
    const setSelection = vi.spyOn(work, 'setSelection')
    tree = await render({ workspaceRoot: '/library-a', entry: entry({ hasPdf: false }), onBack: vi.fn(), onSubmitPrompt })

    await act(async () => { capture.host!.onQuoteSelection!(selection('line one\nline two', 3)) })

    expect(promptTextareaValue(tree)).toBe('page 3\n> line one\n> line two')
    expect(layout.store).toHaveBeenLastCalledWith('assistant')
    expect(notesApi.save).not.toHaveBeenCalled()
    expect(onSubmitPrompt).not.toHaveBeenCalled()
    expect(setSelection).not.toHaveBeenCalled()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(readWorkspacePdf).not.toHaveBeenCalled()
    setSelection.mockRestore()
  })

  it('clears staged image attachments when the reader source changes', async () => {
    const onSubmitPrompt = vi.fn()
    // Notes-only unit keeps the captured host deterministic: the assistant
    // exists without waiting on a PDF read.
    tree = await render({ workspaceRoot: '/library-a', entry: entry({ hasPdf: false }), onBack: vi.fn(), onSubmitPrompt })

    const image = { dataBase64: 'aW1hZ2U=', name: 'figure.png' }
    await act(async () => { expect(await capture.host!.onAttachImage!(image)).toBe(true) })
    expect(onSubmitPrompt).not.toHaveBeenCalled()

    await act(async () => { capture.host!.onAskSelection!('why?', selection('quoted line', 2)) })
    expect(onSubmitPrompt).toHaveBeenLastCalledWith('why?\n\npage 2\n> quoted line', [image])

    await act(async () => { expect(await capture.host!.onAttachImage!(image)).toBe(true) })
    await act(async () => {
      tree!.update(createElement(PapersReader, { workspaceRoot: '/library-b', entry: entry({ hasPdf: false }), onBack: vi.fn(), onSubmitPrompt }))
    })
    await flush()
    await act(async () => { capture.host!.onAskSelection!('why again?', selection('quoted line', 2)) })

    expect(onSubmitPrompt).toHaveBeenLastCalledWith('why again?\n\npage 2\n> quoted line', [])
  })
})
