/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { appendPaperImportFiles, cancelPaperImportSessionItem, editFailedPaperImportInput, startPaperImportSession, usePaperImportSession } from './paper-import-session'
import { parsePaperImportInput } from './paper-import-classify'
import { newPaperImportItem } from './paper-import-queue'
import { usePaperModeStore } from './paper-mode-store'

const ensure = vi.hoisted(() => vi.fn(async () => '/fixed'))
vi.mock('./paper-space', () => ({ paperSpaceReadingSettings: () => ({ papersDir: 'papers' }), ensurePaperSpace: ensure }))
vi.mock('./paper-mode-actions', () => ({ rememberPaperSpace: vi.fn(async () => undefined) }))
const meta = { version: 2 as const, slug: 'a', title: 'Paper A', authors: [], importedAt: '2026-01-01T00:00:00Z' }
const pdf = vi.fn()
const bib = vi.fn()
const search = vi.fn()
const read = vi.fn()
const cancel = vi.fn()
const download = vi.fn()
const bibtex = '@article{a,title={Paper A},year={2025}}\n@article{b,title={Paper B},year={2026}}'

beforeEach(() => {
  vi.clearAllMocks()
  ensure.mockResolvedValue('/fixed')
  usePaperImportSession.setState(usePaperImportSession.getInitialState(), true)
  pdf.mockResolvedValue({ ok: true, unitDir: 'papers/a', meta, reused: false })
  bib.mockImplementation(async ({ bibtex: text }: { bibtex: string }) => ({ ok: true, imported: 1, skipped: 0,
    entries: [{ citeKey: text.includes('{b,') ? 'b' : 'a', ok: true, unitDir: text.includes('{b,') ? 'papers/b' : 'papers/a', meta }] }))
  download.mockResolvedValue({ ok: true, meta: { ...meta, pdfFile: 'paper.pdf' } })
  Object.assign(window, { kunGui: { paperImport: pdf, paperImportBibtex: bib, paperSearchByTitle: search,
    readWorkspaceFile: read, paperCancel: cancel, paperDownloadPdf: download } })
})
afterEach(() => { delete (window as unknown as { kunGui?: unknown }).kunGui })

describe('app-owned paper imports', () => {
  it('splits BibTeX into per-entry results and retries only the failed entry with a fresh request identity', async () => {
    bib.mockImplementationOnce(async () => ({ ok: true, imported: 1, skipped: 0, entries: [{ citeKey: 'a', ok: true, unitDir: 'papers/a', meta }] }))
    bib.mockImplementationOnce(async () => ({ ok: true, imported: 0, skipped: 1, entries: [{ citeKey: 'b', ok: false, message: 'offline' }] }))
    usePaperImportSession.setState({ value: bibtex })
    await startPaperImportSession()
    const first = usePaperImportSession.getState().items
    expect(first.map((item) => item.status)).toEqual(['done', 'failed'])
    expect(bib).toHaveBeenCalledTimes(2)
    expect(bib.mock.calls.every(([input]) => input.workspaceRoot === '/fixed' && input.parentDir === 'papers')).toBe(true)
    const requestId = first[1].requestId
    await startPaperImportSession(true)
    expect(bib).toHaveBeenCalledTimes(3)
    expect(bib.mock.calls[2][0].bibtex).toContain('@article{b,')
    expect(bib.mock.calls[2][0].requestId).not.toBe(requestId)
    expect(usePaperImportSession.getState().items.map((item) => item.status)).toEqual(['done', 'done'])
  })

  it('retries a corrected identifier without touching a successful row', async () => {
    pdf.mockResolvedValueOnce({ ok: false, message: 'Bad identifier' })
    usePaperImportSession.setState({ value: '10.1234/bad\n2401.12345' })
    await startPaperImportSession()
    const [failed, successful] = usePaperImportSession.getState().items
    expect(failed.status).toBe('failed')
    expect(successful.status).toBe('done')
    editFailedPaperImportInput(failed.id, '10.1234/corrected')
    await startPaperImportSession(true)
    expect(pdf).toHaveBeenCalledTimes(3)
    expect(pdf.mock.calls[2][0].input).toBe('10.1234/corrected')
    expect(pdf.mock.calls[2][0].requestId).not.toBe(failed.requestId)
    expect(usePaperImportSession.getState().items[1]).toBe(successful)
  })

  it('expands corrected BibTeX into individually tracked entries on failed-only retry', async () => {
    const failed = { ...newPaperImportItem({ kind: 'doi', raw: '10.1234/bad', ref: '10.1234/bad' }), status: 'failed' as const }
    usePaperImportSession.setState({ items: [failed] })
    editFailedPaperImportInput(failed.id, bibtex)
    await startPaperImportSession(true)
    expect(bib).toHaveBeenCalledTimes(2)
    expect(usePaperImportSession.getState().items.map((item) => item.status)).toEqual(['done', 'done'])
  })

  it('continues after the import UI closes, preserving results and real source roots', async () => {
    let settle!: (result: unknown) => void
    pdf.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    usePaperImportSession.setState({ items: [newPaperImportItem({ kind: 'localPdf', raw: 'a.pdf', ref: '/downloads/a.pdf' })] })
    const running = startPaperImportSession()
    await vi.waitFor(() => expect(pdf).toHaveBeenCalledTimes(1))
    usePaperModeStore.getState().setImportDialogOpen(false)
    expect(usePaperImportSession.getState().running).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
    settle({ ok: true, unitDir: 'papers/old', workspaceRoot: '/legacy', meta, reused: true })
    await running
    usePaperModeStore.getState().setImportDialogOpen(true)
    expect(usePaperImportSession.getState()).toMatchObject({ running: false, finished: true,
      items: [{ status: 'done', workspaceRoot: '/legacy', unitDir: 'papers/old', reused: true }] })
  })

  it('cancels a resolving title without allowing its late result to import', async () => {
    let settle!: (result: unknown) => void
    search.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    usePaperImportSession.setState({ value: 'An exact research paper title' })
    const running = startPaperImportSession()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    cancelPaperImportSessionItem(usePaperImportSession.getState().items[0])
    settle({ ok: true, candidates: [{ title: 'found', arxivId: '2401.12345' }] })
    await running
    expect(pdf).not.toHaveBeenCalled()
    expect(usePaperImportSession.getState().items[0].status).toBe('canceled')
  })

  it('keeps unreadable BibTeX files visible and expands them on a successful retry', async () => {
    read.mockResolvedValueOnce({ ok: false, message: 'Permission denied' })
    await appendPaperImportFiles(['/downloads/citations.bib'])
    expect(usePaperImportSession.getState().items[0]).toMatchObject({ status: 'failed', sourceFile: '/downloads/citations.bib' })
    read.mockResolvedValueOnce({ ok: true, content: bibtex })
    await startPaperImportSession(true)
    expect(usePaperImportSession.getState().items.map((item) => item.status)).toEqual(['done', 'done'])
    expect(bib).toHaveBeenCalledTimes(2)
  })

  it('drains files dropped during a run through the same bounded queue', async () => {
    let settle!: (result: unknown) => void
    pdf.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    await appendPaperImportFiles(['/downloads/a.pdf'])
    const running = startPaperImportSession()
    await vi.waitFor(() => expect(pdf).toHaveBeenCalledTimes(1))
    await appendPaperImportFiles(['/downloads/b.pdf'])
    settle({ ok: true, unitDir: 'papers/a', meta, reused: false })
    await running
    expect(pdf).toHaveBeenCalledTimes(2)
    expect(usePaperImportSession.getState().items.every((item) => item.status === 'done')).toBe(true)
  })

  it('downloads a requested BibTeX PDF at the reused source, not the import root', async () => {
    const metadata = { ...meta, pdfUrl: 'https://example.org/a.pdf' }
    bib.mockResolvedValueOnce({ ok: true, imported: 0, skipped: 1, entries: [
      { citeKey: 'a', ok: true, unitDir: 'papers/old', workspaceRoot: '/legacy', meta: metadata, reused: true }
    ] })
    usePaperImportSession.setState({ value: '@article{a,title={Paper A}}', downloadPdfs: true })
    await startPaperImportSession()
    expect(download).toHaveBeenCalledWith({ workspaceRoot: '/legacy', unitDir: 'papers/old' })
    expect(usePaperImportSession.getState().items[0]).toMatchObject({ status: 'done', workspaceRoot: '/legacy', reused: true, meta: { pdfFile: 'paper.pdf' } })
  })

  it('keeps imported metadata when an optional PDF download fails and respects the unchecked option', async () => {
    bib.mockResolvedValue({ ok: true, imported: 1, skipped: 0, entries: [
      { citeKey: 'a', ok: true, unitDir: 'papers/a', meta: { ...meta, pdfUrl: 'https://example.org/a.pdf' } }
    ] })
    download.mockResolvedValueOnce({ ok: false, message: 'PDF unavailable' })
    usePaperImportSession.setState({ value: '@article{a,title={Paper A}}', downloadPdfs: true })
    await startPaperImportSession()
    expect(usePaperImportSession.getState().items[0]).toMatchObject({ status: 'done', pdfError: 'PDF unavailable', meta: { title: 'Paper A' } })
    usePaperImportSession.setState({ value: '@article{b,title={Paper B}}', downloadPdfs: false })
    await startPaperImportSession()
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('does not fall back to Work or invoke an import when space initialization fails', async () => {
    ensure.mockRejectedValueOnce(new Error('fixed space missing'))
    usePaperImportSession.setState({ value: '2401.12345' })
    await startPaperImportSession()
    expect(usePaperImportSession.getState()).toMatchObject({ error: 'fixed space missing', running: false })
    expect(pdf).not.toHaveBeenCalled()
    expect(parsePaperImportInput(bibtex)).toHaveLength(2)
  })
})
