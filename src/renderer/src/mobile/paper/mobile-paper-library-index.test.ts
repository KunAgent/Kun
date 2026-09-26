// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperLibraryEntry, PaperLibraryEntriesResult } from '@shared/paper/paper-library-types'
import { findMobilePaperResource, useMobilePaperLibraryIndex } from './mobile-paper-library-index'
import { paperResourceKey } from './paper-resource-key'
import { readMobilePaperRoute, rememberMobilePaperRoute } from './mobile-paper-route'

const entry = (title: string): PaperLibraryEntry => ({ unitDir: 'papers/unit', group: '', hasPdf: false,
  hasNotes: false, interpretationCount: 0,
  meta: { title, authors: [], version: 2, slug: 'unit', importedAt: '' } })
const listing = (title: string): PaperLibraryEntriesResult => ({ ok: true, entries: [entry(title)],
  counts: { total: 1, unread: 1, reading: 0, read: 0, missingPdf: 1 }, tags: [], groups: [] })

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); window.sessionStorage.clear() })

describe('mobile paper library ownership', () => {
  it('resolves a B-library history key while A is the phone preference', async () => {
    const list = vi.fn(async ({ workspaceRoot }: { workspaceRoot: string }) => listing(workspaceRoot))
    const found = await findMobilePaperResource(['/A', '/B'], '/A', paperResourceKey('/B', 'papers/unit'), 'papers', list)
    expect(found).toMatchObject({ root: '/B', entry: { meta: { title: '/B' } } })
    expect(list).toHaveBeenCalledTimes(2)
    expect(await findMobilePaperResource([], '/docs', paperResourceKey('/docs', 'papers/unit'), 'papers', list)).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('fails closed if another configured library cannot be checked for a matching link', async () => {
    const list = vi.fn(async ({ workspaceRoot }: { workspaceRoot: string }): Promise<PaperLibraryEntriesResult> =>
      workspaceRoot === '/A' ? { ok: false, code: 'io', message: 'A unavailable' } : listing('B'))
    await expect(findMobilePaperResource(['/A', '/B'], '/B', paperResourceKey('/B', 'papers/unit'),
      'papers', list)).rejects.toThrow('A unavailable')
  })

  it('uses a validated same-tab route without loading unrelated unavailable libraries', async () => {
    const key = rememberMobilePaperRoute('/B', 'papers/unit')
    const route = readMobilePaperRoute(key, ['/A', '/B'])
    const list = vi.fn(async ({ workspaceRoot }: { workspaceRoot: string }): Promise<PaperLibraryEntriesResult> =>
      workspaceRoot === '/A' ? { ok: false, code: 'io', message: 'A unavailable' } : listing('B'))
    const found = await findMobilePaperResource(['/A', '/B'], '/A', key, 'papers', list, route)
    expect(found).toMatchObject({ root: '/B' })
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ workspaceRoot: '/B', papersDir: 'papers' })
  })

  it('hides A rows immediately on B selection and ignores the delayed A response', async () => {
    let finishA!: (value: PaperLibraryEntriesResult) => void
    const list = vi.fn(({ workspaceRoot }: { workspaceRoot: string }) => workspaceRoot === '/A'
      ? new Promise<PaperLibraryEntriesResult>((resolve) => { finishA = resolve })
      : Promise.resolve(listing('B')))
    ;(window as unknown as { kunGui: unknown }).kunGui = { paperLibraryList: list }
    function View({ library }: { library: string }) {
      const state = useMobilePaperLibraryIndex(library, 'papers')
      return createElement('div', null, state.loading ? 'loading' : state.listing?.entries.map((item) => item.meta.title).join(',') ?? state.error)
    }
    await act(async () => root.render(createElement(View, { library: '/A' })))
    await act(async () => root.render(createElement(View, { library: '/B' })))
    expect(host.textContent).toBe('B')
    await act(async () => finishA(listing('A')))
    expect(host.textContent).toBe('B')
  })
})
