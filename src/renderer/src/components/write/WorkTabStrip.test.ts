/** @vitest-environment jsdom */
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkTabStrip } from './WorkTabStrip'
import { paperSpaceItemKey, usePaperSpaceStore, type PaperSpaceItem } from '../../paper/paper-space-store'
import { useChatStore } from '../../store/chat-store'
import { useArtifactLibraryStore } from '../../artifacts/artifact-library-store'
import { useWorkViewStore } from '../../write/work-view-store'
import { useWorkSlotsStore } from '../../write/work-slots-store'
import { useWorkSessionStore } from '../../write/work-session-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { emptyWriteEditorLayout } from '../../write/write-editor-layout'
import { writeWorkspaceKey } from '../../write/write-thread-registry'

const notes = vi.hoisted(() => ({ prepare: vi.fn(async () => true) }))
const sessions = vi.hoisted(() => ({ open: vi.fn(async () => undefined), start: vi.fn(async () => undefined) }))
vi.mock('./WorkTabContextMenu', async () => {
  const { createElement } = await import('react')
  return { WorkTabContextMenu: (props: object) => createElement('div', { ...props, 'data-probe': 'tab-menu' }) }
})
vi.mock('../../paper/paper-notes-draft', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../paper/paper-notes-draft')>(),
  preparePaperNotesForNavigation: notes.prepare
}))
vi.mock('../../write/work-session-actions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../write/work-session-actions')>(),
  openWorkSession: sessions.open,
  startWorkSession: sessions.start
}))

const rootPath = '/work'
const sessionKey = writeWorkspaceKey(rootPath)
let renderer: ReactTestRenderer
const activateTab = vi.fn()
const closeTab = vi.fn(async () => true)

function library(tab: 'papers' | 'artifacts'): ReactTestInstance {
  return renderer.root.findByProps({ 'data-library': tab })
}
function clickTab(tab: ReactTestInstance): void {
  act(() => tab.findByProps({ role: 'tab' }).props.onClick())
}
async function closeLibrary(tab: 'papers' | 'artifacts'): Promise<void> {
  await act(async () => { library(tab).findByProps({ className: 'work-tab-close' }).props.onClick() })
}
function selectRoute(route: 'papers' | 'artifacts' | 'write'): void {
  act(() => useChatStore.getState().setRoute(route))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notes.prepare.mockReset().mockResolvedValue(true)
usePaperSpaceStore.setState(usePaperSpaceStore.getInitialState(), true)
  sessions.open.mockClear()
  sessions.start.mockClear()
  activateTab.mockClear()
  closeTab.mockClear()
  const layout = emptyWriteEditorLayout()
  layout.groups[0] = { id: 'primary', activePath: 'notes.md', tabs: [{ kind: 'file', path: 'notes.md', viewMode: 'rich' }] }
  useWriteWorkspaceStore.setState({ workspaceRoot: rootPath, editorLayout: layout, activateTab, closeTab })
  useWorkViewStore.setState({ sessionTabs: { [sessionKey]: ['thread-a'] }, libraryTabs: [], split: false, peek: false })
  useWorkSlotsStore.setState({ assistantMain: true })
  useWorkSessionStore.setState({ current: { [sessionKey]: 'thread-a' }, titles: { 'thread-a': 'Session A' } })
  useChatStore.setState({ route: 'write', activeThreadId: 'thread-a', busy: false })
  useArtifactLibraryStore.setState({ source: 'work', workRoot: rootPath, openId: null })
  act(() => { renderer = create(createElement(WorkTabStrip)) })
})

afterEach(() => {
  act(() => renderer.unmount())
  vi.unstubAllGlobals()
})

describe('Work library tabs', () => {
  it('keeps sessions, files and both libraries in one strip when switching', async () => {
    selectRoute('papers')
    selectRoute('artifacts')
    expect(useWorkViewStore.getState().libraryTabs).toEqual(['papers', 'artifacts'])
    expect(renderer.root.findAllByProps({ role: 'tab' })).toHaveLength(4)
    expect(library('artifacts').findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
    expect(library('papers').findByProps({ role: 'tab' }).props['aria-selected']).toBe(false)
    expect(renderer.root.findByProps({ title: 'notes.md', role: 'tab' }).props['aria-selected']).toBe(false)

    await act(async () => clickTab(library('papers')))
    expect(useChatStore.getState().route).toBe('papers')
    expect(library('papers').findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
    act(() => renderer.root.findByProps({ title: 'Session A', role: 'tab' }).props.onClick())
    expect(useChatStore.getState().route).toBe('write')
    expect(useWorkViewStore.getState().libraryTabs).toEqual(['papers', 'artifacts'])
    expect(sessions.open).not.toHaveBeenCalled()
    act(() => renderer.root.findByProps({ title: 'notes.md', role: 'tab' }).props.onClick())
    expect(activateTab).toHaveBeenCalledWith('primary', 'notes.md')
    expect(useWorkSlotsStore.getState().assistantMain).toBe(false)
  })

  it('restores the artifact viewer and scopes it to the currently selected Work space', async () => {
    selectRoute('artifacts')
    useArtifactLibraryStore.setState({ openId: 'artifact-a' })
    selectRoute('papers')
    await act(async () => clickTab(library('artifacts')))
    expect(useArtifactLibraryStore.getState()).toMatchObject({ source: 'work', workRoot: rootPath, openId: 'artifact-a' })
    act(() => useWriteWorkspaceStore.setState({ workspaceRoot: '/other' }))
    expect(useArtifactLibraryStore.getState()).toMatchObject({ source: 'work', workRoot: '/other', openId: null })
  })

  it('does not close paper tabs when unsaved notes are not cleared', async () => {
    selectRoute('papers')
    selectRoute('artifacts')
    notes.prepare.mockResolvedValueOnce(false)
    await closeLibrary('papers')
    expect(library('papers')).toBeTruthy()
    expect(useChatStore.getState().route).toBe('artifacts')
    notes.prepare.mockResolvedValueOnce(true)
    await closeLibrary('papers')
    expect(useWorkViewStore.getState().libraryTabs).toEqual(['artifacts'])
    expect(useChatStore.getState().route).toBe('artifacts')
  })

  it('switches to another open library, then back to Work when closing the active tabs', async () => {
    selectRoute('papers')
    selectRoute('artifacts')
    await closeLibrary('artifacts')
    expect(useChatStore.getState().route).toBe('papers')
    await closeLibrary('papers')
    expect(useChatStore.getState().route).toBe('write')
    expect(useWorkViewStore.getState().libraryTabs).toEqual([])
  })

  it('opens the newly selected session when returning after closing a background session', async () => {
    act(() => {
      useWorkViewStore.setState({ sessionTabs: { [sessionKey]: ['thread-a', 'thread-b'] } })
      useWorkSessionStore.setState({ titles: { 'thread-a': 'Session A', 'thread-b': 'Session B' } })
    })
    selectRoute('papers')
    const session = renderer.root.findByProps({ title: 'Session A', role: 'tab' }).parent!
    await act(async () => { session.findByProps({ className: 'work-tab-close' }).props.onClick() })
    expect(useChatStore.getState().route).toBe('papers')
    expect(useWorkSessionStore.getState().current[sessionKey]).toBe('thread-b')
    await closeLibrary('papers')
    expect(useChatStore.getState().route).toBe('write')
    expect(sessions.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'thread-b' }), undefined, { restoreWorkbench: false })
  })

  it('shows the global paper tab even before a Work space exists', async () => {
    act(() => {
      useWriteWorkspaceStore.setState({ workspaceRoot: '', editorLayout: emptyWriteEditorLayout() })
      useChatStore.getState().setRoute('papers')
    })
    expect(library('papers').findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
    expect(renderer.root.findAllByProps({ 'data-kind': 'session' })).toHaveLength(0)
    await closeLibrary('papers')
    expect(useChatStore.getState().route).toBe('write')
  })
})

function paper(root: string, name: string): PaperSpaceItem {
const unitDir = `papers/${name}`
return { key: paperSpaceItemKey(root, unitDir), libraryRoot: root, entry: {
unitDir, meta: { version: 2, slug: name, title: `Paper ${name}`, pdfFile: `${name}.pdf`, authors: [], importedAt: 'now' },
hasPdf: true, hasNotes: false, interpretationCount: 0, group: ''
} }
}
function readerTab(item: PaperSpaceItem): ReactTestInstance {
return renderer.root.findByProps({ 'data-reader-key': item.key })
}
function showReaders(items: PaperSpaceItem[], active = items[0]): void {
selectRoute('papers')
act(() => usePaperSpaceStore.setState({ items, openReaderKeys: items.map((item) => item.key), readerKey: active.key }))
}
async function closeReader(item: PaperSpaceItem): Promise<void> {
await act(async () => { readerTab(item).findByProps({ className: 'work-tab-close' }).props.onClick() })
}

describe('independent paper PDF tabs', () => {
it('keeps the library and two PDFs at the top level, with one selected tab', async () => {
const a = paper('/source', 'a'), b = paper('/legacy', 'b')
showReaders([a, b])
expect(library('papers').findByProps({ role: 'tab' }).props['aria-selected']).toBe(false)
expect(readerTab(a).findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
expect(readerTab(b).findByProps({ role: 'tab' }).props['aria-selected']).toBe(false)
await act(async () => clickTab(readerTab(b)))
expect(usePaperSpaceStore.getState().readerKey).toBe(b.key)
await act(async () => clickTab(library('papers')))
expect(usePaperSpaceStore.getState().readerKey).toBeNull()
expect(usePaperSpaceStore.getState().openReaderKeys).toEqual([a.key, b.key])
await act(async () => clickTab(readerTab(a)))
expect(useChatStore.getState().route).toBe('papers')
expect(usePaperSpaceStore.getState().readerKey).toBe(a.key)
expect(activateTab).not.toHaveBeenCalled()
expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe(rootPath)
})

it('closes a background PDF without moving the active reader, then falls back to the library', async () => {
const a = paper('/source', 'a'), b = paper('/source', 'b')
showReaders([a, b])
await closeReader(b)
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: a.key, openReaderKeys: [a.key] })
await closeReader(a)
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: null, openReaderKeys: [] })
expect(useChatStore.getState().route).toBe('papers')
expect(library('papers').findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
})

it('selects the next PDF when the active one closes', async () => {
const a = paper('/source', 'a'), b = paper('/source', 'b')
showReaders([a, b])
await closeReader(a)
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: b.key, openReaderKeys: [b.key] })
expect(readerTab(b).findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
})

it('can close the library without closing or replacing an active PDF', async () => {
const a = paper('/source', 'a')
showReaders([a])
await closeLibrary('papers')
expect(useWorkViewStore.getState().libraryTabs).not.toContain('papers')
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: a.key, openReaderKeys: [a.key] })
expect(useChatStore.getState().route).toBe('papers')
expect(readerTab(a).findByProps({ role: 'tab' }).props['aria-selected']).toBe(true)
})

it('honors notes cancellation before closing or switching PDF tabs', async () => {
const a = paper('/source', 'a'), b = paper('/legacy', 'a')
showReaders([a, b])
notes.prepare.mockResolvedValue(false)
await closeReader(a)
await act(async () => clickTab(readerTab(b)))
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: a.key, openReaderKeys: [a.key, b.key] })
expect(readerTab(a)).toBeTruthy()
expect(readerTab(b)).toBeTruthy()
})
})


async function paperMenuAction(item: PaperSpaceItem, action: string): Promise<void> {
act(() => readerTab(item).props.onContextMenu({ preventDefault: () => undefined, clientX: 10, clientY: 10 }))
await act(async () => renderer.root.findByProps({ 'data-probe': 'tab-menu' }).props.onAction(action))
}

describe('paper PDF tab bulk closing', () => {
it('closes other tabs while retaining the chosen PDF and its source', async () => {
const a = paper('/source', 'a'), b = paper('/legacy', 'b')
showReaders([a, b])
await paperMenuAction(b, 'closeOthers')
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: b.key, openReaderKeys: [b.key] })
expect(useWorkViewStore.getState().libraryTabs).not.toContain('papers')
expect(useChatStore.getState().route).toBe('papers')
expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe(rootPath)
})
it('closes PDFs to the right without closing the library or left PDF', async () => {
const a = paper('/source', 'a'), b = paper('/source', 'b'), c = paper('/legacy', 'c')
showReaders([a, b, c])
await paperMenuAction(a, 'closeRight')
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: a.key, openReaderKeys: [a.key] })
expect(useWorkViewStore.getState().libraryTabs).toContain('papers')
})
it('closes all tabs without reviving the library and returns to the Work draft', async () => {
const a = paper('/source', 'a'), b = paper('/source', 'b')
showReaders([a, b], b)
await paperMenuAction(b, 'closeAll')
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: null, openReaderKeys: [] })
expect(useWorkViewStore.getState().libraryTabs).toEqual([])
expect(useChatStore.getState().route).toBe('write')
expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe(rootPath)
})
it('cancels the whole bulk close before any library, session or PDF disappears', async () => {
const a = paper('/source', 'a'), b = paper('/source', 'b')
showReaders([a, b])
notes.prepare.mockResolvedValue(false)
await paperMenuAction(b, 'closeAll')
expect(usePaperSpaceStore.getState()).toMatchObject({ readerKey: a.key, openReaderKeys: [a.key, b.key] })
expect(useWorkViewStore.getState().libraryTabs).toContain('papers')
expect(useChatStore.getState().route).toBe('papers')
expect(useWorkViewStore.getState().sessionTabs[sessionKey]).toEqual(['thread-a'])
})
})
