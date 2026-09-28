import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy, PDFOutlineItem } from 'pdfjs-dist/build/pdf.mjs'
import { findPaperPdfPage, flattenPaperOutline, resolvePaperOutlinePage } from './mobile-paper-pdf-tools'

describe('mobile PDF navigation tools', () => {
  it('searches on demand and stops at the first matching page', async () => {
    const cleanup = vi.fn()
    const getPage = vi.fn(async (page: number) => ({
      getTextContent: async () => ({ items: [{ str: page === 3 ? 'Target result' : 'Other text' }] }), cleanup
    }))
    const pdf = { numPages: 200, getPage } as unknown as PDFDocumentProxy
    expect(await findPaperPdfPage(pdf, 'target', 1, () => false)).toBe(3)
    expect(getPage).toHaveBeenCalledTimes(3)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(await findPaperPdfPage(pdf, 'target', 1, () => true)).toBeNull()
  })
  it('resolves PDF outline destinations to pages', async () => {
    const item = { title: 'Method', dest: 'method', items: [] } as unknown as PDFOutlineItem
    const pdf = { getDestination: vi.fn(async () => [{ num: 7 }]),
      getPageIndex: vi.fn(async () => 5) } as unknown as PDFDocumentProxy
    expect(await resolvePaperOutlinePage(pdf, item)).toBe(6)
    expect(flattenPaperOutline([item])).toMatchObject([{ depth: 0, item: { title: 'Method' } }])
  })
})
