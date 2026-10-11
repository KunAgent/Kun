/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAPER_IMPORT_DRAG_TYPE, usePaperImportDrag } from '../../../paper/paper-import-drag'
import { usePaperFreshFolders } from '../../../paper/paper-import-fresh'
import { usePaperImportJobs } from '../../../paper/paper-import-job'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { PaperTree } from './PaperTree'

const ROOT = '/Users/me/space'

let root: Root
let host: HTMLElement

function dragEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [PAPER_IMPORT_DRAG_TYPE], dropEffect: 'none', getData: () => '' }
  })
  return event
}

function folderButton(name: string): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>('button[title]')].find((button) => button.title === name)!
}

describe('PaperTree import drop targets', () => {
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
    useWriteWorkspaceStore.setState({
      workspaceRoot: ROOT,
      paperReading: { ...useWriteWorkspaceStore.getState().paperReading, papersDir: 'papers' }
    })
    usePaperImportJobs.setState({ jobs: {} })
    usePaperImportDrag.getState().end()
    usePaperFreshFolders.setState({ byRoot: {}, version: 0 })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { kunGui?: unknown }).kunGui
    vi.restoreAllMocks()
  })

  async function renderTree(): Promise<void> {
    await act(async () => {
      root.render(createElement(PaperTree, { libraryRoot: ROOT, entries: [], groups: ['agents', 'rag'] }))
    })
  }

  it('highlights a folder under a paper drag and shows how many papers will land', async () => {
    await renderTree()
    usePaperImportDrag.getState().begin(
      [{ key: 'a', keys: ['a'], title: 'A', input: '2401.1' }, { key: 'b', keys: ['b'], title: 'B', input: '2401.2' }],
      'quick'
    )
    await act(async () => { folderButton('rag').dispatchEvent(dragEvent('dragover')) })
    expect(usePaperImportDrag.getState().overFolder).toBe('rag')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('2')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('rag')
  })

  it('imports the dragged papers into the folder it is dropped on', async () => {
    const bridge = {
      paperCreateGroup: vi.fn(async ({ group }: { group: string }) => ({ ok: true, group })),
      paperImportBatch: vi.fn(async ({ items, parentDir }: { items: Array<{ input: string }>; parentDir: string }) => ({
        ok: true,
        results: [{ input: items[0]!.input, ok: true, unitDir: `${parentDir}/${items[0]!.input}`, reused: false }]
      })),
      paperLibraryList: vi.fn(async () => ({ ok: true, entries: [], counts: {}, tags: [], groups: [] })),
      paperCancel: vi.fn()
    }
    ;(window as unknown as { kunGui: unknown }).kunGui = bridge
    await renderTree()
    usePaperImportDrag.getState().begin(
      [{ key: 'a', keys: ['a'], title: 'A', input: '2401.1' }, { key: 'b', keys: ['b'], title: 'B', input: '2401.2' }],
      'quick'
    )
    await act(async () => {
      folderButton('rag').dispatchEvent(dragEvent('drop'))
      await vi.waitFor(() => expect(bridge.paperImportBatch).toHaveBeenCalledTimes(2))
    })
    expect(bridge.paperImportBatch.mock.calls.map(([arg]) => arg.parentDir)).toEqual(['papers/rag', 'papers/rag'])
    await vi.waitFor(() => expect(usePaperImportJobs.getState().jobs.quick?.running).toBe(false))
    expect(usePaperFreshFolders.getState().byRoot[ROOT]).toEqual({ rag: 2 })
    expect(usePaperImportDrag.getState().candidates).toHaveLength(0)
  })
})
