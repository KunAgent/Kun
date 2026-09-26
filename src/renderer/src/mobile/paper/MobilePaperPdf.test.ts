// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../components/write/use-write-pdf-document', () => ({
  useWritePdfDocument: () => ({ pdfDocument: null, loading: true, error: '', pageCount: 0,
    updatePageText: () => undefined })
}))
import { MobilePaperPdf } from './MobilePaperPdf'

let root: Root
let host: HTMLDivElement
const open = vi.fn()
const release = vi.fn(async () => ({ ok: true }))
const read = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  open.mockResolvedValue({ ok: true, url: '/remote/file-preview?path=paper.pdf', leaseId: 'lease-1' })
  ;(window as unknown as { kunGui: unknown }).kunGui = {
    openWorkspacePreviewResource: open, releaseWorkspacePreviewResource: release, readWorkspacePdf: read
  }
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); open.mockReset(); release.mockClear(); read.mockReset()
})

describe('mobile paper PDF transport', () => {
  it('fetches via a scoped preview URL and releases its lease', async () => {
    await act(async () => root.render(createElement(MobilePaperPdf, {
      workspaceRoot: '/library', path: '/library/papers/x/paper.pdf', initialPage: 1,
      marks: [], onPage: vi.fn(), onQuote: vi.fn(), onHighlight: vi.fn(), onTranslate: vi.fn()
    })))
    expect(open).toHaveBeenCalledWith({ workspaceRoot: '/library', path: '/library/papers/x/paper.pdf' })
    expect(read).not.toHaveBeenCalled()
    expect(host.textContent).toContain('PDF 加载中')
    act(() => root.unmount())
    expect(release).toHaveBeenCalledWith({ leaseId: 'lease-1' })
    root = createRoot(host)
  })
})
