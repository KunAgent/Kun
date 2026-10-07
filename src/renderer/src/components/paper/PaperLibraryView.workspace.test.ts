/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperLibraryView } from './PaperLibraryView'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { emptyPaperLibraryFilter, usePaperModeStore } from '../../paper/paper-mode-store'

vi.mock('./PaperWorkspaceHeader', () => ({ PaperWorkspaceHeader: () => createElement('div', { 'data-testid': 'header' }) }))
vi.mock('./library/PaperLibraryToolbar', () => ({
  PaperLibraryToolbar: ({ onRefresh }: { onRefresh: () => void }) => createElement('button', { onClick: onRefresh }, 'refresh')
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

const FIRST = '/papers/first'
const SECOND = '/papers/second'
let root: Root
let host: HTMLDivElement
let list: ReturnType<typeof vi.fn>

async function render(): Promise<void> {
  await act(async () => root.render(createElement(PaperLibraryView)))
}

function result() {
  return { ok: true, entries: [], groups: ['Old workspace folder'], tags: [], counts: { total: 0, unread: 0, reading: 0, read: 0, missingPdf: 0 } }
}

describe('PaperLibraryView workspace boundaries', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    list = vi.fn()
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { paperLibraryList: list } })
    useWriteWorkspaceStore.setState({ workspaceRoot: FIRST })
    usePaperModeStore.setState({ entries: [], entriesLoading: false, entriesError: null, filter: emptyPaperLibraryFilter(), selection: new Set(), groups: [], tags: [] })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('does not replace the new library with a late refresh from the previous root', async () => {
    let settle!: (value: ReturnType<typeof result>) => void
    list.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    await render()
    await act(async () => host.querySelector('button')!.click())
    expect(list).toHaveBeenCalledOnce()
    await act(async () => {
      useWriteWorkspaceStore.setState({ workspaceRoot: SECOND })
      usePaperModeStore.setState({ groups: ['New workspace folder'], entriesLoading: false })
    })
    await act(async () => settle(result()))
    expect(usePaperModeStore.getState().groups).toEqual(['New workspace folder'])
    expect(usePaperModeStore.getState().entriesError).toBeNull()
  })

  it('ignores a late refresh error after the library changes', async () => {
    let reject!: (reason: Error) => void
    list.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    await render()
    await act(async () => host.querySelector('button')!.click())
    await act(async () => {
      useWriteWorkspaceStore.setState({ workspaceRoot: SECOND })
      usePaperModeStore.setState({ entriesLoading: false })
    })
    await act(async () => reject(new Error('Old library unavailable')))
    expect(usePaperModeStore.getState().entriesError).toBeNull()
  })

  it('offers retry for a failed index without presenting the library as empty', async () => {
    usePaperModeStore.setState({ entriesError: 'ENOENT: folder unavailable' })
    await render()
    expect(host.querySelector('[data-testid="paper-library-empty"]')).toBeNull()
    expect(host.textContent).toContain('paperWorkspaceUnavailableHint')
    expect(host.textContent).toContain('paperWorkspaceRetry')
    expect(host.querySelector('[data-testid="paper-open-matrix"]')).not.toBeNull()
    expect(host.textContent).toContain('paperReadingLocalControls')
  })
})
