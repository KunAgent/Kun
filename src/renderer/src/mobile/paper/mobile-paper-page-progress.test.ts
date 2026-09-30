// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readMobilePaperPage, useMobilePaperPageProgress } from './mobile-paper-page-progress'

let host: HTMLDivElement
let root: Root
const save = vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }))
const onError = vi.fn()
function View({ page }: { page: number }) {
  useMobilePaperPageProgress({ root: '/library', unitDir: 'papers/unit', page, pageCount: 100 }, onError)
  return createElement('div', null, page)
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.sessionStorage.clear(); vi.useFakeTimers()
  save.mockReset(); save.mockResolvedValue({ ok: true }); onError.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  ;(window as unknown as { kunGui: unknown }).kunGui = { paperLocalStateWrite: save }
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); save.mockClear()
  window.sessionStorage.clear(); vi.useRealTimers()
})

describe('mobile paper page position', () => {
  it('flushes the latest page on immediate navigation and keeps a local fallback', async () => {
    await act(async () => root.render(createElement(View, { page: 11 })))
    await act(async () => root.render(createElement(View, { page: 12 })))
    expect(readMobilePaperPage('/library', 'papers/unit', 11, '2020-01-01T00:00:00Z')).toBe(12)
    await act(async () => root.unmount())
    expect(save).toHaveBeenCalledWith({ libraryRoot: '/library', unitRelDir: 'papers/unit',
      patch: { lastPage: 12, pageCount: 100 } })
    root = createRoot(host)
  })
  it('does not override a more recently opened host position', async () => {
    await act(async () => root.render(createElement(View, { page: 12 })))
    expect(readMobilePaperPage('/library', 'papers/unit', 4, new Date(Date.now() + 1000).toISOString())).toBe(4)
  })
  it('reports a host write failure and retries the same position', async () => {
    save.mockResolvedValueOnce({ ok: false, message: 'disk full' })
    await act(async () => root.render(createElement(View, { page: 12 })))
    await act(async () => { await vi.runAllTimersAsync() })
    expect(onError).toHaveBeenCalledWith('disk full')
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await Promise.resolve() })
    expect(save).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenLastCalledWith('')
  })
})
