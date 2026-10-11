/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererPaperList } from '../../agent/paper-list-adapter'
import { usePaperImportJobs } from '../../paper/paper-import-job'
import { usePaperImportSelection } from '../../paper/paper-import-selection'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { PaperListCard } from './PaperListCard'

const ROOT = '/Users/me/space'

const LIST: RendererPaperList = {
  version: 1,
  title: 'Fast context',
  summary: '',
  papers: [
    { id: '2401.00001', title: 'Graph Localization Agents', reason: 'Closest to the topic', priority: 'must', group: 'Localization', verified: true,
      paper: { id: '2401.00001', title: 'Graph Localization Agents', authors: ['A One', 'B Two', 'C Three'], year: 2025, sources: ['arxiv'], arxivId: '2401.00001' } },
    { id: '2401.00002', title: 'Ranking Based Localization', reason: 'Fast baseline', priority: 'should', group: 'Localization', verified: true,
      paper: { id: '2401.00002', title: 'Ranking Based Localization', authors: ['D Four'], year: 2024, sources: ['arxiv'], arxivId: '2401.00002' } },
    { id: '2401.00003', title: 'Optional Extra Reading', reason: 'Background', priority: 'optional', group: 'Background', verified: false }
  ]
} as unknown as RendererPaperList

let root: Root
let host: HTMLElement

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(PaperListCard, { list: LIST, workspaceRoot: ROOT }))
  })
}

describe('PaperListCard', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const data = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, String(value)) },
        removeItem: (key: string) => { data.delete(key) },
        clear: () => data.clear(),
        key: (index: number) => [...data.keys()][index] ?? null,
        get length() { return data.size }
      }
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    useWriteWorkspaceStore.setState({ workspaceRoot: ROOT })
    useChatStore.setState({ activeThreadId: 'thread-1', threads: [] })
    usePaperModeStore.setState({ entries: [], groups: [] })
    usePaperImportSelection.setState({ byScope: {}, seeded: {} })
    usePaperImportJobs.setState({ jobs: {} })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('preselects recommended papers and leaves optional ones unchecked', async () => {
    await render()
    const boxes = [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')]
    const states = Object.fromEntries(boxes.map((box) => [box.getAttribute('aria-label'), box.getAttribute('aria-checked')]))
    expect(states['Graph Localization Agents']).toBe('true')
    expect(states['Ranking Based Localization']).toBe('true')
    expect(states['Optional Extra Reading']).toBe('false')
    expect(host.textContent).toContain('Import 2')
    expect(host.textContent).toContain('2 selected')
  })

  it('has one import control instead of a button per row', async () => {
    await render()
    const importButtons = [...host.querySelectorAll('button')].filter((button) => /^Import \d/.test(button.textContent ?? ''))
    expect(importButtons).toHaveLength(1)
    expect(host.textContent).not.toContain('Import paper')
  })

  it('opens the import sheet with a topic-named new folder and per-direction subfolders', async () => {
    await render()
    const optional = host.querySelector<HTMLElement>('[role="checkbox"][aria-label="Optional Extra Reading"]')!
    await act(async () => optional.click())
    const importButton = [...host.querySelectorAll('button')].find((button) => /^Import 3/.test(button.textContent ?? ''))!
    await act(async () => importButton.click())
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect((dialog!.querySelector('input') as HTMLInputElement).value).toBe('Fast context')
    expect(dialog!.textContent).toContain('Import 3 papers')
    expect(dialog!.textContent).toContain('subfolder for each of the 2 recommended directions')
    expect(dialog!.textContent).toContain('Fast context')
  })

  it('shows the library folder of papers it already has', async () => {
    usePaperModeStore.setState({
      entries: [{
        unitDir: 'papers/old/graph', group: 'old', hasPdf: true, hasNotes: false, interpretationCount: 0,
        meta: { version: 2, slug: 'graph', title: 'Graph Localization Agents', authors: [], arxivId: '2401.00001', importedAt: '' }
      }] as never
    })
    await render()
    expect(host.textContent).toContain('In library')
    expect(host.textContent).toContain('old')
    // Owned papers are not preselected: 1 left to import.
    expect(host.textContent).toContain('Import 1')
  })
})
