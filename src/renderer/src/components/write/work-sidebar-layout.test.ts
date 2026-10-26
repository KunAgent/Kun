import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('../../lib/browser-storage', () => ({
  readBrowserStorageItem: (key: string) => store.get(key) ?? null,
  writeBrowserStorageItem: (key: string, value: string) => { store.set(key, value) }
}))

const layout = await import('./work-sidebar-layout')

describe('work sidebar layout memory', () => {
  beforeEach(() => store.clear())

  it('remembers the unfolded session list per space', () => {
    expect(layout.readSessionsExpanded()).toEqual({})
    expect(layout.writeSessionsExpanded('space-a', true)).toEqual({ 'space-a': true })
    layout.writeSessionsExpanded('space-b', true)
    expect(layout.writeSessionsExpanded('space-a', false)).toEqual({ 'space-b': true })
  })

  it('clamps and remembers the files pane height per space', () => {
    expect(layout.readFilesHeight('space-a')).toBe(layout.FILES_PANE_DEFAULT)
    layout.writeFilesHeight('space-a', 20)
    expect(layout.readFilesHeight('space-a')).toBe(layout.FILES_PANE_MIN)
    layout.writeFilesHeight('space-a', 412.4)
    expect(layout.readFilesHeight('space-a')).toBe(412)
    expect(layout.readFilesHeight('space-b')).toBe(layout.FILES_PANE_DEFAULT)
    layout.writeFilesHeight('space-a', layout.FILES_PANE_DEFAULT)
    expect(JSON.parse(store.get('kun.work.filesPaneHeight.v1') ?? '{}')).toEqual({})
  })

  it('ignores malformed stored values', () => {
    store.set('kun.work.filesPaneHeight.v1', '{"space-a":"tall"}')
    store.set('kun.work.sessionsExpanded.v1', '[1]')
    expect(layout.readFilesHeight('space-a')).toBe(layout.FILES_PANE_DEFAULT)
    expect(layout.readSessionsExpanded()).toEqual({})
  })
})
