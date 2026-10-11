import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperRect } from '@shared/paper/paper-marks-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaperRegionCapture } from '../reader/use-paper-region-capture'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { deferred, entry, hash, render } from './paper-evidence-test-support'

const crop = vi.hoisted(() => vi.fn())
vi.mock('../../../paper/paper-visual-mark', () => ({ cropPageRegionPng: crop }))
const rect: PaperRect = [0.1, 0.2, 0.3, 0.4]
const image = { base64: 'aW1hZ2U=', dataUrl: 'data:image/png;base64,aW1hZ2U=' }
const mark = { id: 'visual-a', kind: 'visual', page: 2, rect, pdfSha256: hash,
  image: { path: 'marks/assets/visual-a.png' }, createdAt: 'now', updatedAt: 'now' }
let tree: ReactTestRenderer | undefined
let capture: ReturnType<typeof usePaperRegionCapture>
let save: ReturnType<typeof vi.fn>
let input: Parameters<typeof usePaperRegionCapture>[0]
const getPage = vi.fn()
function Hook(props: Parameters<typeof usePaperRegionCapture>[0]) {
  capture = usePaperRegionCapture(props)
  return null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  getPage.mockResolvedValue({})
  crop.mockResolvedValue(image)
  save = vi.fn(async () => ({ ok: true, mark }))
  vi.stubGlobal('window', { kunGui: { paperSaveVisualMark: save } })
  input = { pdfDocument: { getPage } as unknown as PDFDocumentProxy, pdfSha256: hash,
    workspaceRoot: '/library', unitDir: entry.unitDir, onNotice: vi.fn(), onComplete: vi.fn() }
  useWriteWorkspaceStore.setState({ workspaceRoot: '/library' })
  usePaperMarksStore.setState({ workspaceRoot: '/library', unitDir: entry.unitDir, items: [], cards: {}, visualMarkImages: {}, dirty: false })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('version-bound region capture admission', () => {
  it('does nothing until the document and exact viewer hash are available', async () => {
    tree = await render(createElement(Hook, { ...input, pdfSha256: undefined }))
    await act(async () => capture(2, rect))
    expect(getPage).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await act(async () => tree!.update(createElement(Hook, { ...input, pdfDocument: null })))
    await act(async () => capture(2, rect))
    expect(save).not.toHaveBeenCalled()
  })

  it('coalesces simultaneous captures and saves the exact viewer version once', async () => {
    const pending = deferred<unknown>()
    crop.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => { capture(2, rect); capture(2, rect) })
    expect(crop).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    await act(async () => pending.resolve(image))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ workspaceRoot: '/library', unitDir: entry.unitDir,
      mark: { id: expect.any(String), page: 2, rect }, pngBase64: image.base64, expectedPdfSha256: hash })
    expect(usePaperMarksStore.getState().cards[mark.id]).toMatchObject(mark)
    expect(input.onComplete).toHaveBeenCalledTimes(1)
  })

  it.each(['root', 'unit', 'hash', 'document'] as const)('does not save an old crop after %s changes', async (scope) => {
    const pending = deferred<unknown>()
    crop.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => capture(2, rect))
    const next = { ...input,
      ...(scope === 'root' ? { workspaceRoot: '/other' } : {}),
      ...(scope === 'unit' ? { unitDir: 'papers/b' } : {}),
      ...(scope === 'hash' ? { pdfSha256: 'b'.repeat(64) } : {}),
      ...(scope === 'document' ? { pdfDocument: { getPage } as unknown as PDFDocumentProxy } : {}) }
    await act(async () => tree!.update(createElement(Hook, next)))
    await act(async () => pending.resolve(image))
    expect(save).not.toHaveBeenCalled()
    expect(usePaperMarksStore.getState().cards).toEqual({})
    expect(input.onComplete).not.toHaveBeenCalled()
  })

  it('does not inject a completed old save into a newly selected paper store', async () => {
    const pending = deferred<unknown>()
    save.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => capture(2, rect))
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      usePaperMarksStore.setState({ unitDir: 'papers/b', cards: {}, visualMarkImages: {}, dirty: false })
      tree!.update(createElement(Hook, { ...input, unitDir: 'papers/b' }))
    })
    await act(async () => pending.resolve({ ok: true, mark }))
    expect(usePaperMarksStore.getState().cards).toEqual({})
    expect(input.onComplete).not.toHaveBeenCalled()
  })

  it('does not inject a saved card after another mounted viewer takes over the shared marks store', async () => {
    const pending = deferred<unknown>()
    save.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => capture(2, rect))
    usePaperMarksStore.setState({ unitDir: 'papers/b', cards: {}, visualMarkImages: {}, dirty: false })
    await act(async () => pending.resolve({ ok: true, mark }))
    expect(usePaperMarksStore.getState().cards).toEqual({})
    expect(input.onComplete).not.toHaveBeenCalled()
  })

  it('does not save an old crop after a same-unitDir switch to another library', async () => {
    const pending = deferred<unknown>()
    crop.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => capture(2, rect))
    useWriteWorkspaceStore.setState({ workspaceRoot: '/other-library' })
    usePaperMarksStore.setState({ workspaceRoot: '/other-library', unitDir: entry.unitDir, cards: {}, dirty: false })
    await act(async () => pending.resolve(image))
    expect(save).not.toHaveBeenCalled()
    expect(usePaperMarksStore.getState().cards).toEqual({})
  })

  it.each(['store', 'active-workspace'])('discards a saved card after the %s switches libraries while unitDir stays the same', async (owner) => {
    const pending = deferred<unknown>()
    save.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => capture(2, rect))
    expect(save).toHaveBeenCalledTimes(1)
    if (owner === 'store') usePaperMarksStore.setState({ workspaceRoot: '/other-library', cards: {}, dirty: false })
    else useWriteWorkspaceStore.setState({ workspaceRoot: '/other-library' })
    await act(async () => pending.resolve({ ok: true, mark }))
    expect(usePaperMarksStore.getState().cards).toEqual({})
    expect(input.onComplete).not.toHaveBeenCalled()
  })

  it('abandons an unmounted capture and suppresses its late error', async () => {
    const pending = deferred<unknown>()
    crop.mockImplementation(() => pending.promise)
    tree = await render(createElement(Hook, input))
    await act(async () => capture(2, rect))
    await act(async () => { tree!.unmount(); tree = undefined })
    await act(async () => pending.reject(new Error('Old capture failed')))
    expect(save).not.toHaveBeenCalled()
    expect(input.onNotice).not.toHaveBeenCalled()
    expect(input.onComplete).not.toHaveBeenCalled()
  })
})
