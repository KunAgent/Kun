// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { paperResourceKey } from './paper-resource-key'

vi.mock('../sheets/MobileSheet', () => ({ MobileSheet: ({ open, children }: { open: boolean; children: unknown }) =>
  open ? createElement('div', null, children as never) : null }))
vi.mock('./MobilePaperPdf', () => ({ MobilePaperPdf: () => null }))
vi.mock('./MobilePaperNotes', () => ({ MobilePaperNotes: () => null }))
vi.mock('./MobilePaperAssistant', () => ({ MobilePaperAssistant: () => null }))
import { MobilePaperReader } from './MobilePaperReader'

let host: HTMLDivElement
let root: Root
const original = useWriteWorkspaceStore.getState()
const writeMarks = vi.fn()
const onUnsavedChange = vi.fn()
const reference = vi.fn()
const highlight = { id: 'h1', kind: 'highlight', page: 2, color: 'yellow', quote: 'Original quote',
  rects: [[.1, .2, .3, .4]], createdAt: '2026-01-01', updatedAt: '2026-01-01' }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  window.sessionStorage.clear()
  useWriteWorkspaceStore.setState({ paperMode: { ...original.paperMode, libraries: ['/library'], activeLibrary: '/library' } })
  writeMarks.mockResolvedValue({ ok: true })
  reference.mockResolvedValue({ ok: true, items: [{ n: 1, title: 'Cited paper', authors: ['Researcher'], year: '2024' }] })
  ;(window as unknown as { kunGui: unknown }).kunGui = {
    paperLibraryList: vi.fn(async () => ({ ok: true, entries: [{ unitDir: 'papers/unit', meta: {
      version: 2, slug: 'unit', title: 'Paper', authors: [], importedAt: '' }, hasPdf: false,
      group: '', hasNotes: false, interpretationCount: 0 }],
      counts: { total: 1, unread: 1, reading: 0, read: 0, missingPdf: 1 }, tags: [], groups: [] })),
    paperReadUnit: vi.fn(async () => ({ ok: true, meta: {
      version: 2, slug: 'unit', title: 'Paper', authors: [], importedAt: '' } })),
    paperMarksRead: vi.fn(async () => ({ ok: true, items: [highlight] })),
    paperMarksWrite: writeMarks, paperLocalStateWrite: vi.fn(async () => undefined),
    paperFetchReferences: reference
  }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); window.sessionStorage.clear()
  useWriteWorkspaceStore.setState({ paperMode: original.paperMode })
  vi.restoreAllMocks(); writeMarks.mockReset(); reference.mockReset(); onUnsavedChange.mockReset()
})
async function mount() {
  await act(async () => root.render(createElement(MobilePaperReader, {
    paperKey: paperResourceKey('/library', 'papers/unit'), view: 'info',
    onView: vi.fn(), onBack: vi.fn(), onSettings: vi.fn(), onUnsavedChange
  })))
}
function button(text: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) as HTMLButtonElement
}

describe('mobile paper reader annotations and references', () => {
  it('sends removed highlight ids to the host rather than dropping them locally', async () => {
    await mount()
    await act(async () => button('Annotations and highlights').click())
    await act(async () => button('Delete').click())
    expect(writeMarks).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/library', unitDir: 'papers/unit', removedIds: ['h1'], items: []
    }))
  })
  it('keeps the unsaved guard when an annotation delete fails', async () => {
    writeMarks.mockResolvedValue({ ok: false, message: 'Host write failed' })
    await mount()
    await act(async () => button('Annotations and highlights').click())
    await act(async () => button('Delete').click())
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
    expect(host.textContent).toContain('Host write failed')
  })
  it('fetches references only after the user asks', async () => {
    await mount()
    expect(reference).not.toHaveBeenCalled()
    await act(async () => button('Show references').click())
    expect(reference).toHaveBeenCalledWith({ workspaceRoot: '/library', unitDir: 'papers/unit' })
    expect(host.textContent).toContain('Cited paper')
  })
})
