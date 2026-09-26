// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { PaperLibraryEntriesResult } from '@shared/paper/paper-library-types'
import { MobilePaperHome } from './MobilePaperHome'
import i18n from '../../i18n'

let host: HTMLDivElement
let root: Root
const original = useWriteWorkspaceStore.getState()
const list = vi.fn()
const entries = (title: string): PaperLibraryEntriesResult => ({ ok: true,
  entries: [{ unitDir: 'papers/one', group: '', hasPdf: false, hasNotes: false, interpretationCount: 0,
    meta: { version: 2, slug: 'one', title, authors: [], importedAt: '' } }],
  counts: { total: 1, unread: 1, reading: 0, read: 0, missingPdf: 1 }, tags: [], groups: [] })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.sessionStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  ;(window as unknown as { kunGui: unknown }).kunGui = {
    paperLibraryList: list, onPaperProgress: () => () => undefined
  }
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); list.mockReset(); window.sessionStorage.clear()
  useWriteWorkspaceStore.setState({ paperMode: original.paperMode, paperReading: original.paperReading,
    workspaceRoot: original.workspaceRoot })
})
const render = async () => act(async () => root.render(createElement(MobilePaperHome, {
  navigate: vi.fn(), onDocuments: vi.fn(), onBusyChange: vi.fn()
})))

describe('mobile paper library home', () => {
  it('cannot import into an ordinary documents workspace without a configured paper library', async () => {
    useWriteWorkspaceStore.setState({ workspaceRoot: '/documents',
      paperMode: { ...original.paperMode, activeLibrary: '/documents', libraries: [] } })
    await render()
    expect(host.textContent).toContain('Configure a paper library in Work settings')
    const importButton = host.querySelector('header button') as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    expect(list).not.toHaveBeenCalled()
  })

  it('updates the mobile header and guidance when the locale changes', async () => {
    const oldLanguage = i18n.language
    useWriteWorkspaceStore.setState({ paperMode: { ...original.paperMode, libraries: [] } })
    try {
      await render()
      await act(async () => { await i18n.changeLanguage('zh') })
      expect(host.textContent).toContain('请先在主机 Work 设置中配置文献库')
      expect(host.querySelector('h1')?.textContent).toBe('论文库')
    } finally { await act(async () => { await i18n.changeLanguage(oldLanguage) }) }
  })

  it('does not let an old A row be opened during a pending B scan', async () => {
    let finishB!: (value: PaperLibraryEntriesResult) => void
    list.mockImplementation(({ workspaceRoot }: { workspaceRoot: string }) => workspaceRoot === '/A'
      ? Promise.resolve(entries('A-paper'))
      : new Promise<PaperLibraryEntriesResult>((resolve) => { finishB = resolve }))
    useWriteWorkspaceStore.setState({ paperMode: {
      ...original.paperMode, activeLibrary: '/A', libraries: ['/A', '/B'] } })
    await render()
    expect(host.textContent).toContain('A-paper')
    const select = host.querySelector('.kun-mobile-paper-library select') as HTMLSelectElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, '/B')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.textContent).not.toContain('A-paper')
    expect(host.querySelectorAll('.kun-mobile-paper-open')).toHaveLength(0)
    await act(async () => finishB(entries('B-paper')))
    expect(host.textContent).toContain('B-paper')
  })
})
