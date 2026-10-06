import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperEvidence } from '@shared/paper/paper-evidence-types'
import { inspectPaperEvidence, paperEvidenceCitation, promotePaperEvidence } from './paper-evidence-actions'
import { newPaperHighlight, usePaperMarksStore } from './paper-marks-store'

const navigation = vi.hoisted(() => vi.fn())
const openFile = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../lib/knowledge-source-navigation', () => ({ requestKnowledgeSourceNavigation: navigation }))
vi.mock('../write/write-workspace-store', () => ({
  useWriteWorkspaceStore: { getState: () => ({ workspaceRoot: '/library', openFile }) },
  writeJoinPath: (root: string, path: string) => `${root.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}))
const hash = 'a'.repeat(64)
const evidence: PaperEvidence = {
  id: 'evidence-1', unitDir: 'papers/a', sourceMarkId: 'mark-1', sourceKind: 'highlight',
  originalQuote: 'Author-reported original quotation.', anchor: { page: 4, rects: [[0, 0, 1, 1]] },
  paperVersion: { canonicalId: 'arxiv:2401.12345', arxivVersion: 'v2', citeKey: 'SuppliedKey', title: 'Paper A',
    pdfFile: 'paper.pdf', pdfSha256: hash, pdfBytes: 100, capturedAt: 'now' },
  mechanical: { versionBinding: 'bound', quoteMatch: 'matched', textPartial: false, checkedAt: 'now' },
  interpretation: 'My analysis', conditions: 'Held-out split', question: 'Why?',
  claimKind: 'user-judgment', verification: 'unverified', createdAt: 'now', updatedAt: 'now'
}
let api: {
  paperMarksWrite: ReturnType<typeof vi.fn>
  paperEvidenceRead: ReturnType<typeof vi.fn>
  paperEvidencePromote: ReturnType<typeof vi.fn>
  paperEvidenceSource: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  vi.clearAllMocks()
  usePaperMarksStore.setState({ workspaceRoot: '/library', unitDir: 'papers/a', items: [], cards: {}, removedIds: [], dirty: false })
  api = {
    paperMarksWrite: vi.fn(async (payload) => ({ ok: true, items: payload.items })),
    paperEvidenceRead: vi.fn(async () => ({ ok: true, revision: 7, items: [] })),
    paperEvidencePromote: vi.fn(async () => ({ ok: true, revision: 8, items: [evidence] })),
    paperEvidenceSource: vi.fn(async () => ({ ok: true, status: 'current', unitDir: 'papers/a', pdfFile: 'paper.pdf', page: 4,
      title: 'Paper A', citeKey: 'SuppliedKey', expectedSha256: hash, currentSha256: hash, message: 'Current source' }))
  }
  vi.stubGlobal('window', { kunGui: api })
})
afterEach(() => {
  vi.unstubAllGlobals()
  usePaperMarksStore.setState({ workspaceRoot: '', unitDir: '', items: [], cards: {}, removedIds: [], dirty: false })
})

describe('reader evidence promotion', () => {
  it('flushes actual pending marks before reading the current revision and promoting by mark ID', async () => {
    const mark = newPaperHighlight({ color: 'yellow', page: 4, rects: [[0, 0, 0.1, 0.1]], quote: evidence.originalQuote, pdfSha256: hash })
    usePaperMarksStore.setState({ items: [mark], dirty: true })
    await promotePaperEvidence('/library', 'papers/a', mark.id)
    expect(api.paperMarksWrite).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: '/library', unitDir: 'papers/a', items: [mark] }))
    expect(api.paperMarksWrite.mock.invocationCallOrder[0]).toBeLessThan(api.paperEvidenceRead.mock.invocationCallOrder[0])
    expect(api.paperEvidenceRead.mock.invocationCallOrder[0]).toBeLessThan(api.paperEvidencePromote.mock.invocationCallOrder[0])
    expect(api.paperEvidencePromote).toHaveBeenCalledWith({ workspaceRoot: '/library', unitDir: 'papers/a', markId: mark.id, expectedRevision: 7 })
  })

  it('does not promote old persisted marks when saving pending edits fails', async () => {
    usePaperMarksStore.setState({ dirty: true })
    api.paperMarksWrite.mockResolvedValue({ ok: false, code: 'stale-anchor', message: 'PDF changed' })
    await expect(promotePaperEvidence('/library', 'papers/a', 'mark-1')).rejects.toThrow()
    expect(api.paperEvidenceRead).not.toHaveBeenCalled()
    expect(api.paperEvidencePromote).not.toHaveBeenCalled()
    expect(usePaperMarksStore.getState().dirty).toBe(true)
  })

  it('surfaces malformed-store and revision-conflict errors without retrying edits silently', async () => {
    api.paperEvidenceRead.mockResolvedValueOnce({ ok: false, code: 'corrupt-store', message: 'Store needs repair' })
    await expect(promotePaperEvidence('/library', 'papers/a', 'mark-1')).rejects.toThrow('Store needs repair')
    expect(api.paperEvidencePromote).not.toHaveBeenCalled()
    api.paperEvidencePromote.mockResolvedValueOnce({ ok: false, code: 'revision-conflict', message: 'Reload before saving' })
    await expect(promotePaperEvidence('/library', 'papers/a', 'mark-1')).rejects.toThrow('Reload before saving')
    expect(api.paperEvidencePromote).toHaveBeenCalledTimes(1)
  })
})

describe('reader evidence source navigation', () => {
  it.each(['missing', 'stale', 'legacy-unbound'])('refuses %s sources before opening a PDF', async (status) => {
    api.paperEvidenceSource.mockResolvedValue({ ok: true, status, message: `${status} source` })
    await expect(inspectPaperEvidence('/library', evidence)).rejects.toThrow(`${status} source`)
    expect(openFile).not.toHaveBeenCalled()
    expect(navigation).not.toHaveBeenCalled()
  })

  it('opens only the verified unit-relative PDF and carries its expected hash to guard replacement races', async () => {
    await inspectPaperEvidence('/library', evidence)
    expect(api.paperEvidenceSource).toHaveBeenCalledWith({ workspaceRoot: '/library', evidenceId: 'evidence-1' })
    expect(openFile).toHaveBeenCalledWith('/library', '/library/papers/a/paper.pdf', { groupId: 'primary' })
    expect(navigation).toHaveBeenCalledWith({ filePath: '/library/papers/a/paper.pdf',
      location: { kind: 'pdf', pageStart: 4, pageEnd: 4, expectedSha256: hash } })
    expect(openFile.mock.invocationCallOrder[0]).toBeLessThan(navigation.mock.invocationCallOrder[0])
  })

  it('uses the current server-side unit path when an old card outlives a group move', async () => {
    api.paperEvidenceSource.mockResolvedValueOnce({ ok: true, status: 'current', unitDir: 'papers/reviewed/a',
      pdfFile: 'paper.pdf', page: 4, expectedSha256: hash })
    await inspectPaperEvidence('/library', evidence)
    expect(openFile).toHaveBeenCalledWith('/library', '/library/papers/reviewed/a/paper.pdf', { groupId: 'primary' })
    expect(navigation).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/library/papers/reviewed/a/paper.pdf' }))
  })

  it('surfaces source errors and never navigates without a resolved PDF', async () => {
    api.paperEvidenceSource.mockResolvedValueOnce({ ok: false, message: 'Source read failed' })
    await expect(inspectPaperEvidence('/library', evidence)).rejects.toThrow('Source read failed')
    api.paperEvidenceSource.mockResolvedValueOnce({ ok: true, status: 'current', message: 'No file' })
    await expect(inspectPaperEvidence('/library', evidence)).rejects.toThrow('No file')
    expect(openFile).not.toHaveBeenCalled()
    expect(navigation).not.toHaveBeenCalled()
  })

  it('retains original quote, cite key, version hash, and semantic-review state when copying citations', () => {
    const citation = paperEvidenceCitation(evidence)
    expect(citation).toContain(evidence.originalQuote)
    expect(citation).toContain('[@SuppliedKey]')
    expect(citation).toContain('v2; SHA-256: ' + hash)
    expect(citation).toContain('semantic review: unverified')
    expect(citation).toContain('Interpretation: My analysis')
    expect(evidence.originalQuote).toBe('Author-reported original quotation.')
  })
})
