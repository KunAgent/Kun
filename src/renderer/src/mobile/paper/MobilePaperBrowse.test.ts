// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { MobilePaperBrowse } from './MobilePaperBrowse'

let host: HTMLDivElement
let root: Root
const original = useWriteWorkspaceStore.getState()
const arxiv = vi.fn()
const feed = vi.fn()
const catalog = vi.fn()
const venue = vi.fn()
const importPaper = vi.fn()
const imported = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useWriteWorkspaceStore.setState({ paperMode: { ...original.paperMode, libraries: ['/library'],
    activeLibrary: '/library', discover: { ...original.paperMode.discover,
      arxivCategories: ['cs.CL'], feeds: [{ id: 'f1', title: 'My feed', url: 'https://example.org/rss' }] } } })
  arxiv.mockResolvedValue({ ok: true, date: '2026-09-28', fromCache: false,
    items: [{ arxivId: '2609.01234', title: 'Verified paper', authors: ['A'], categories: ['cs.CL'], relevance: 0 }] })
  feed.mockResolvedValue({ ok: true, title: 'My feed', items: [{ title: 'Feed paper', url: 'https://example.org/paper' }] })
  catalog.mockResolvedValue({ ok: true, venues: [{ id: 'ICLR.2025', series: 'ICLR', year: '2025', groups: [] }] })
  venue.mockImplementation(async ({ skip }: { skip: number }) => ({ ok: true, venue: 'ICLR.2025', group: '',
    skip, total: 51, items: [{ coolId: `cool-${skip}`, title: `Venue paper ${skip}`, authors: [] }] }))
  importPaper.mockResolvedValue({ ok: true, unitDir: 'papers/verified' })
  ;(window as unknown as { kunGui: unknown }).kunGui = {
    paperArxivToday: arxiv, paperFetchFeed: feed, paperVenueCatalog: catalog, paperListVenue: venue,
    paperImport: importPaper,
    onPaperProgress: () => () => undefined, paperCancel: vi.fn(async () => undefined)
  }
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  useWriteWorkspaceStore.setState({ paperMode: original.paperMode })
  arxiv.mockReset(); feed.mockReset(); catalog.mockReset(); venue.mockReset(); importPaper.mockReset(); imported.mockReset()
})
async function mount() {
  await act(async () => root.render(createElement(MobilePaperBrowse, {
    root: '/library', papersDir: 'papers', onBusyChange: vi.fn(), onImported: imported
  })))
}
function button(label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label) as HTMLButtonElement
}

describe('mobile paper discovery sources', () => {
  it('loads configured arXiv categories and imports into the selected paper library', async () => {
    await mount()
    await act(async () => button('Load papers').click())
    expect(arxiv).toHaveBeenCalledWith({ categories: ['cs.CL'] })
    expect(host.textContent).toContain('Verified paper')
    await act(async () => button('Import to library').click())
    expect(importPaper).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: '/library',
      input: '2609.01234', parentDir: 'papers' }))
    expect(imported).toHaveBeenCalledTimes(1)
  })

  it('fetches only the chosen configured subscription', async () => {
    await mount()
    await act(async () => button('Subscriptions').click())
    const select = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      select.value = 'f1'; select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button('Load papers').click())
    expect(feed).toHaveBeenCalledWith({ url: 'https://example.org/rss' })
    expect(host.textContent).toContain('Feed paper')
  })

  it('loads conference editions and uses the provider page size for the next page', async () => {
    await mount()
    await act(async () => button('Conferences').click())
    await act(async () => button('Load conference catalog').click())
    await act(async () => button('Load papers').click())
    expect(venue).toHaveBeenCalledWith({ venue: 'ICLR.2025', skip: 0 })
    expect(host.textContent).toContain('Venue paper 0')
    await act(async () => button('Next').click())
    expect(host.textContent).not.toContain('Venue paper 0')
    await act(async () => button('Load papers').click())
    expect(venue).toHaveBeenCalledWith({ venue: 'ICLR.2025', skip: 50 })
    expect(host.textContent).toContain('Venue paper 50')
  })
})
