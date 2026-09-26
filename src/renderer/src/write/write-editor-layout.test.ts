import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WriteEditorLayoutV1 } from './write-workspace-store-types'
import {
  addEditorItemToGroup,
  addTabToGroup,
  createWriteDocumentSession,
  emptyWriteEditorLayout,
  isWriteEditorLayoutSplit,
  persistWriteEditorLayout,
  projectFocusedDocument,
  readWriteEditorLayout,
  layoutStorageKey,
  writeEditorGroupFlex
} from './write-editor-layout'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

afterEach(() => vi.unstubAllGlobals())

describe('write editor layout', () => {
  it('defaults to one full-size group and ignores the remembered ratio visually', () => {
    const layout = { ...emptyWriteEditorLayout(), ratio: 0.5 }
    expect(layout).toMatchObject({ orientation: 'single', focusedGroupId: 'primary' })
    expect(layout.groups).toHaveLength(1)
    expect(isWriteEditorLayoutSplit(layout)).toBe(false)
    expect(writeEditorGroupFlex(layout, 0)).toBe('1 1 100%')
  })

  it('applies the ratio only after a second editor group exists', () => {
    const layout = {
      ...emptyWriteEditorLayout(),
      orientation: 'horizontal' as const,
      ratio: 0.4,
      groups: [
        { id: 'primary' as const, tabs: [], activePath: null },
        { id: 'secondary' as const, tabs: [], activePath: null }
      ]
    }
    expect(isWriteEditorLayoutSplit(layout)).toBe(true)
    expect(writeEditorGroupFlex(layout, 0)).toBe('0.4 1 0%')
    expect(writeEditorGroupFlex(layout, 1)).toBe('0.6 1 0%')
  })

  it('deduplicates tabs inside one group while allowing per-group occurrences', () => {
    let layout = addTabToGroup(emptyWriteEditorLayout(), 'primary', '/work/a.md', 'rich')
    layout = addTabToGroup(layout, 'primary', '/work/a.md', 'plain')
    expect(layout.groups[0].tabs).toEqual([{ path: '/work/a.md', viewMode: 'rich' }])
    expect(layout.groups[0].activePath).toBe('/work/a.md')
  })

  it('projects the focused group document and its occurrence view mode', () => {
    const layout = addTabToGroup(emptyWriteEditorLayout(), 'primary', '/work/a.md', 'plain')
    const document = createWriteDocumentSession({
      path: '/work/a.md',
      kind: 'text',
      fileContent: 'draft',
      persistedContent: 'saved',
      saveStatus: 'dirty'
    })
    expect(projectFocusedDocument(layout, { '/work/a.md': document })).toMatchObject({
      activeFilePath: '/work/a.md',
      fileContent: 'draft',
      saveStatus: 'dirty',
      previewMode: 'plain'
    })
  })

  it('projects a typed whiteboard item without treating its key as a file path', () => {
    const layout = addEditorItemToGroup(emptyWriteEditorLayout(), 'primary', {
      kind: 'whiteboard',
      boardId: 'board-1',
      viewMode: 'rich'
    })

    expect(layout.groups[0]).toMatchObject({
      activePath: 'whiteboard:board-1',
      tabs: [{ kind: 'whiteboard', boardId: 'board-1' }]
    })
    expect(projectFocusedDocument(layout, {})).toMatchObject({
      activeFilePath: null,
      activeFileKind: null,
      activeWhiteboardId: 'board-1',
      fileLoading: false,
      saveStatus: 'saved'
    })
  })

  it('restores layout metadata but rejects paths outside the workspace', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    const layout = {
      ...emptyWriteEditorLayout(),
      groups: [{
        id: 'primary' as const,
        activePath: '/work/a.md',
        tabs: [
          { path: '/work/a.md', viewMode: 'live' },
          { path: '/other/secret.md', viewMode: 'source' }
        ]
      }]
    } as unknown as WriteEditorLayoutV1
    persistWriteEditorLayout('/work', layout)
    expect(readWriteEditorLayout('/work')?.groups[0]).toEqual({
      id: 'primary',
      activePath: '/work/a.md',
      tabs: [{ path: '/work/a.md', viewMode: 'rich' }]
    })
  })

  it('restores mixed legacy file and typed whiteboard tabs', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    persistWriteEditorLayout('/work', {
      ...emptyWriteEditorLayout(),
      groups: [{
        id: 'primary',
        activePath: 'whiteboard:board-1',
        tabs: [
          { path: '/work/a.md', viewMode: 'live' },
          { kind: 'whiteboard', boardId: 'board-1', viewMode: 'rich' }
        ]
      }]
    } as unknown as WriteEditorLayoutV1)

    expect(readWriteEditorLayout('/work')?.groups[0]).toEqual({
      id: 'primary',
      activePath: 'whiteboard:board-1',
      tabs: [
        { path: '/work/a.md', viewMode: 'rich' },
        { kind: 'whiteboard', boardId: 'board-1', viewMode: 'rich' }
      ]
    })
  })

  it('drops malformed whiteboard identities during layout normalization', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    storage.setItem(layoutStorageKey('/work'), JSON.stringify({
      version: 1,
      orientation: 'single',
      ratio: 0.5,
      focusedGroupId: 'primary',
      groups: [{
        id: 'primary',
        activePath: 'whiteboard:../escape',
        tabs: [
          { kind: 'whiteboard', boardId: '../escape', viewMode: 'rich' },
          { path: '/work/a.md', viewMode: 'live' }
        ]
      }]
    }))

    expect(readWriteEditorLayout('/work')?.groups[0]).toEqual({
      id: 'primary',
      activePath: '/work/a.md',
      tabs: [{ path: '/work/a.md', viewMode: 'rich' }]
    })
  })

  it('does not infer a split from malformed or legacy two-group records', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    storage.setItem(layoutStorageKey('/work'), JSON.stringify({
      version: 1,
      orientation: 'single',
      ratio: 0.5,
      focusedGroupId: 'secondary',
      groups: [
        { id: 'primary', activePath: '/work/a.md', tabs: [{ path: '/work/a.md', viewMode: 'live' }] },
        { id: 'secondary', activePath: '/work/b.md', tabs: [{ path: '/work/b.md', viewMode: 'preview' }] }
      ]
    }))

    expect(readWriteEditorLayout('/work')).toMatchObject({
      orientation: 'single',
      focusedGroupId: 'primary',
      groups: [{ id: 'primary', activePath: '/work/a.md' }]
    })
  })

  it('requires two structurally valid groups to restore an explicit split', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    storage.setItem(layoutStorageKey('/work'), JSON.stringify({
      version: 1,
      orientation: 'horizontal',
      ratio: 0.5,
      focusedGroupId: 'secondary',
      groups: [{ id: 'primary', activePath: null, tabs: [] }, null]
    }))

    expect(readWriteEditorLayout('/work')).toMatchObject({
      orientation: 'single',
      focusedGroupId: 'primary',
      groups: [{ id: 'primary' }]
    })
  })

  it('restores a valid split that was explicitly persisted', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    persistWriteEditorLayout('/work', {
      version: 1,
      orientation: 'vertical',
      ratio: 0.6,
      focusedGroupId: 'secondary',
      groups: [
        { id: 'primary', activePath: '/work/a.md', tabs: [{ path: '/work/a.md', viewMode: 'live' }] },
        { id: 'secondary', activePath: '/work/b.md', tabs: [{ path: '/work/b.md', viewMode: 'preview' }] }
      ]
    } as unknown as WriteEditorLayoutV1)

    expect(readWriteEditorLayout('/work')).toMatchObject({
      orientation: 'vertical',
      ratio: 0.6,
      focusedGroupId: 'secondary',
      groups: [{ id: 'primary' }, { id: 'secondary' }]
    })
  })
})
