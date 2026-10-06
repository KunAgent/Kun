import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWritePdfNavigation } from './use-write-pdf-navigation'
import { requestKnowledgeSourceNavigation } from '../../lib/knowledge-source-navigation'

const filePath = '/library/papers/a/paper.pdf'
const document = {} as PDFDocumentProxy
const expected = 'a'.repeat(64)
let tree: ReactTestRenderer | undefined
let navigation: ReturnType<typeof useWritePdfNavigation>
const scroll = vi.fn()
function Viewer({ pdfSha256, loaded = true }: { pdfSha256?: string; loaded?: boolean }) {
  navigation = useWritePdfNavigation({ filePath, pdfDocument: loaded ? document : null, pageCount: 8,
    pageTexts: [], scrollerRef: { current: null }, pdfSha256 })
  navigation.pageRefs.current.set(4, { scrollIntoView: scroll } as unknown as HTMLDivElement)
  return null
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); scroll.mockClear() })
afterEach(async () => {
  await act(async () => tree?.unmount()); tree = undefined
  // Consume any pending fixture navigation so tests remain independent.
  const { subscribeKnowledgeSourceNavigation } = await import('../../lib/knowledge-source-navigation')
  subscribeKnowledgeSourceNavigation(filePath, () => true)()
  vi.unstubAllGlobals()
})
async function mount(props: { pdfSha256?: string; loaded?: boolean }) {
  await act(async () => { tree = create(createElement(Viewer, props)) })
}
async function request(hash?: string) {
  await act(async () => requestKnowledgeSourceNavigation({ filePath, location: { kind: 'pdf', pageStart: 4, pageEnd: 4, expectedSha256: hash } }))
}

describe('version-bound PDF source navigation', () => {
  it('waits until the exact loaded PDF hash is available before jumping', async () => {
    await mount({})
    await request(expected)
    expect(scroll).not.toHaveBeenCalled()
    expect(navigation.currentPage).toBe(1)
    await act(async () => tree!.update(createElement(Viewer, { pdfSha256: expected })))
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(navigation.currentPage).toBe(4)
  })

  it('consumes a stale hash request without jumping or replaying it on a later file load', async () => {
    await mount({ pdfSha256: 'b'.repeat(64) })
    await request(expected)
    expect(scroll).not.toHaveBeenCalled()
    await act(async () => tree!.update(createElement(Viewer, { pdfSha256: expected })))
    expect(scroll).not.toHaveBeenCalled()
    expect(navigation.currentPage).toBe(1)
  })

  it('requires a loaded document even if the hash is already known', async () => {
    await mount({ pdfSha256: expected, loaded: false })
    await request(expected)
    expect(scroll).not.toHaveBeenCalled()
    await act(async () => tree!.update(createElement(Viewer, { pdfSha256: expected })))
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(navigation.currentPage).toBe(4)
  })

  it('retains ordinary non-evidence PDF navigation without a version constraint', async () => {
    await mount({})
    await request()
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(navigation.currentPage).toBe(4)
  })
})
