import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applicableWorkSessionPin,
  beginWorkSessionTransition,
  readWorkSidebarView,
  useWorkSidebarStore,
  writeHasDocumentContext
} from './work-sidebar-store'

const ROOT = '/Users/me/Work'

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

  it('applies the pin in the sessions view, and in the files view only with nothing open', () => {
    const pin = { workspaceRoot: ROOT, threadId: 'thr_1' }
    expect(applicableWorkSessionPin({ view: 'sessions', pin, workspaceRoot: ROOT, documentContext: true })).toEqual(pin)
    expect(applicableWorkSessionPin({ view: 'files', pin, workspaceRoot: ROOT, documentContext: true })).toBeNull()
    expect(applicableWorkSessionPin({ view: 'files', pin, workspaceRoot: ROOT, documentContext: false })).toEqual(pin)
    expect(applicableWorkSessionPin({ view: 'sessions', pin, workspaceRoot: '/Users/me/Other', documentContext: false }))
      .toBeNull()
  })

  it('keeps drafts and pins per space', () => {
    useWorkSidebarStore.getState().startDraft(ROOT)
    expect(useWorkSidebarStore.getState().pin).toEqual({ workspaceRoot: ROOT, threadId: '' })
    useWorkSidebarStore.getState().pinSession(ROOT, ' thr_2 ')
    expect(useWorkSidebarStore.getState().pin).toEqual({ workspaceRoot: ROOT, threadId: 'thr_2' })
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
  })
})
