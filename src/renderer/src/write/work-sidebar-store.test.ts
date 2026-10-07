import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applicableWorkSessionPin,
  beginWorkSessionTransition,
  readWorkSidebarView,
  useWorkSidebarStore,
  workDocumentKey,
  writeHasDocumentContext
} from './work-sidebar-store'

const ROOT = '/Users/me/Work'
const README = workDocumentKey({ workSurface: 'docs', activeFilePath: `${ROOT}/README.md`, activeWhiteboardId: null })
const NOTES = workDocumentKey({ workSurface: 'docs', activeFilePath: `${ROOT}/notes.md`, activeWhiteboardId: null })

describe('work sidebar store', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    })
    useWorkSidebarStore.setState({ view: 'sessions', pin: null, transitions: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to the sessions view and remembers the choice', () => {
    expect(readWorkSidebarView()).toBe('sessions')
    useWorkSidebarStore.getState().setView('files')
    expect(readWorkSidebarView()).toBe('files')
    useWorkSidebarStore.getState().setView('sessions')
    expect(readWorkSidebarView()).toBe('sessions')
  })

  it('applies the pin in the sessions view whatever is open', () => {
    const pin = { workspaceRoot: ROOT, threadId: 'thr_1', documentKey: README }
    expect(applicableWorkSessionPin({ view: 'sessions', pin, workspaceRoot: ROOT, documentContext: true, documentKey: NOTES }))
      .toEqual(pin)
    expect(applicableWorkSessionPin({ view: 'sessions', pin, workspaceRoot: '/Users/me/Other', documentContext: false }))
      .toBeNull()
  })

  it('keeps the pin in the files view only while the same document is open', () => {
    const pin = { workspaceRoot: ROOT, threadId: 'thr_1', documentKey: README }
    expect(applicableWorkSessionPin({ view: 'files', pin, workspaceRoot: ROOT, documentContext: true, documentKey: README }))
      .toEqual(pin)
    expect(applicableWorkSessionPin({ view: 'files', pin, workspaceRoot: ROOT, documentContext: true, documentKey: NOTES }))
      .toBeNull()
    expect(applicableWorkSessionPin({ view: 'files', pin, workspaceRoot: ROOT, documentContext: false }))
      .toEqual(pin)
  })

  it('adopts the open document when switching to the files view', () => {
    useWorkSidebarStore.getState().pinSession(ROOT, 'thr_1', README)
    useWorkSidebarStore.getState().setView('files', NOTES)
    expect(useWorkSidebarStore.getState().pin?.documentKey).toBe(NOTES)
    useWorkSidebarStore.getState().setView('sessions', README)
    expect(useWorkSidebarStore.getState().pin?.documentKey).toBe(NOTES)
  })

  it('keeps drafts and pins per space', () => {
    useWorkSidebarStore.getState().startDraft(ROOT, README)
    expect(useWorkSidebarStore.getState().pin).toEqual({ workspaceRoot: ROOT, threadId: '', documentKey: README })
    useWorkSidebarStore.getState().pinSession(ROOT, ' thr_2 ')
    expect(useWorkSidebarStore.getState().pin).toEqual({ workspaceRoot: ROOT, threadId: 'thr_2', documentKey: '' })
    useWorkSidebarStore.getState().clearPin()
    expect(useWorkSidebarStore.getState().pin).toBeNull()
  })

  it('counts nested thread transitions and ends each once', () => {
    const first = beginWorkSessionTransition()
    const second = beginWorkSessionTransition()
    expect(useWorkSidebarStore.getState().transitions).toBe(2)
    first()
    first()
    expect(useWorkSidebarStore.getState().transitions).toBe(1)
    second()
    expect(useWorkSidebarStore.getState().transitions).toBe(0)
  })

  it('treats any open file, whiteboard or paper view as a document', () => {
    expect(writeHasDocumentContext({ workSurface: 'docs', activeFilePath: null, activeWhiteboardId: null })).toBe(false)
    expect(writeHasDocumentContext({ workSurface: 'docs', activeFilePath: '/a.md', activeWhiteboardId: null })).toBe(true)
    expect(writeHasDocumentContext({ workSurface: 'docs', activeFilePath: null, activeWhiteboardId: 'b' })).toBe(true)
    expect(writeHasDocumentContext({ workSurface: 'papers', activeFilePath: null, activeWhiteboardId: null })).toBe(true)
    expect(README).not.toBe(NOTES)
  })
})
