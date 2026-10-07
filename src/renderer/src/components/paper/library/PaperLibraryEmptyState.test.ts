/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperLibraryEmptyState } from './PaperLibraryEmptyState'

const openView = vi.hoisted(() => vi.fn())
vi.mock('../../../paper/paper-view', () => ({ openPaperViewTab: openView }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

let root: Root
let host: HTMLDivElement
const onImport = vi.fn()
const onClearFilters = vi.fn()

async function render(filtered: boolean): Promise<void> {
  await act(async () => root.render(createElement(PaperLibraryEmptyState, { filtered, onImport, onClearFilters })))
}

describe('PaperLibraryEmptyState', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('offers PDF import and search without starting an automatic network request', async () => {
    await render(false)
    expect(host.querySelector('h2')?.textContent).toBe('paperWorkspaceEmptyTitle')
    expect(openView).not.toHaveBeenCalled()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="paper-empty-import"]')!.click())
    expect(onImport).toHaveBeenCalledOnce()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="paper-empty-search"]')!.click())
    expect(openView).toHaveBeenCalledWith('discover:search')
  })

  it('offers filter recovery instead of first-run import when papers exist', async () => {
    await render(true)
    expect(host.querySelector('h2')?.textContent).toBe('writePaperLibraryNoMatch')
    expect(host.querySelector('[data-testid="paper-empty-import"]')).toBeNull()
    await act(async () => host.querySelector('button')!.click())
    expect(onClearFilters).toHaveBeenCalledOnce()
  })
})
