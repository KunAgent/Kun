import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { promotePaperEvidence, readPaperEvidence, readPaperEvidenceMaterial, readPaperEvidenceSource, updatePaperEvidence } from './paper-evidence-service'
import { readPaperEvidenceWorkspace } from './paper-evidence-store'
import { movePaperUnitToGroup } from './paper-library-service'
import { createPaperMatrix, updatePaperMatrix } from './paper-matrix-service'
import { readPaperVersion } from './paper-evidence-version'
import { extractEvidencePdfText, withPaperArxivVersion } from './paper-evidence-text'
import { writePaperAnnotations, writePaperMarkCard, writePaperVisualMarkPng, deletePaperMarkCard } from './paper-marks-service'
import type { PaperHighlight } from '../../../shared/paper/paper-marks-types'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

vi.mock('./paper-evidence-text', async (original) => ({
  ...await original<typeof import('./paper-evidence-text')>(), extractEvidencePdfText: vi.fn()
}))

const bytes = Buffer.from('%PDF-1.7\noriginal PDF bytes')
const hash = createHash('sha256').update(bytes).digest('hex')
const quote = 'We evaluate on the held-out test split.'
const now = '2026-10-05T00:00:00Z'
let root: string
let unit: string
const mark = (patch: Partial<PaperHighlight> = {}): PaperHighlight => ({
  id: 'mark-1', kind: 'highlight', color: 'yellow', page: 1, rects: [[0.1, 0.2, 0.6, 0.1]],
  quote, createdAt: now, updatedAt: now, pdfSha256: hash, ...patch
})
const metadata = { version: 2, slug: 'paper', title: 'Evidence Paper', authors: ['A. Author'],
  importedAt: now, arxivId: '2401.12345', pdfFile: 'paper.pdf',
  pdfUrl: 'https://arxiv.org/pdf/2401.12345v9', bibtex: '@article{AuthorSuppliedKey,title={Evidence Paper}}' }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paper-evidence-'))
  unit = join(root, 'papers', 'paper')
  await mkdir(unit, { recursive: true })
  await writeFile(join(unit, 'paper.json'), JSON.stringify(metadata))
  await writeFile(join(unit, 'paper.pdf'), bytes)
  await writePaperAnnotations(unit, [mark()])
  vi.mocked(extractEvidencePdfText).mockResolvedValue({ pageCount: 2,
    pages: [{ page: 1, text: `arXiv:2401.12345v3 ${quote}` }, { page: 2, text: '' }], truncated: false })
})
afterEach(async () => { vi.clearAllMocks(); await rm(root, { recursive: true, force: true }) })

async function collect() {
  const result = await promotePaperEvidence(root, { unitDir: 'papers/paper', markId: 'mark-1', expectedRevision: 0 })
  if (!result.ok) throw new Error(result.message)
  return result
}

describe('trusted paper evidence', () => {
  it('captures real bytes, supplied cite key, actual stamped version, quote, and separate user verification', async () => {
    const result = await collect()
    expect(result.items[0]).toMatchObject({ originalQuote: quote, verification: 'unverified',
      mechanical: { versionBinding: 'bound', quoteMatch: 'matched' },
      paperVersion: { canonicalId: 'arxiv:2401.12345', citeKey: 'AuthorSuppliedKey', pdfSha256: hash, arxivVersion: 'v3' } })
    expect(await readPaperEvidenceSource(root, result.items[0].id)).toMatchObject({ status: 'current', pdfFile: 'paper.pdf', page: 1 })
  })

  it('never guesses arXiv v1 or trusts a stale versioned metadata URL', async () => {
    const { snapshot } = await readPaperVersion(unit)
    expect(snapshot.arxivVersion).toBeUndefined()
    expect(withPaperArxivVersion(snapshot, 'arXiv:2401.99999v4')).toEqual(snapshot)
    expect(withPaperArxivVersion(snapshot, 'arXiv:2401.12345')).toEqual(snapshot)
  })

  it('preserves immutable source evidence while interpretation and verification are edited', async () => {
    const result = await collect()
    const id = result.items[0].id
    const saved = await updatePaperEvidence(root, { evidenceId: id, expectedRevision: result.revision,
      patch: { interpretation: 'My interpretation', conditions: 'Small held-out sample', question: 'Does it generalize?', claimKind: 'user-judgment', verification: 'user-verified' } })
    expect(saved).toMatchObject({ ok: true, items: [{ id, originalQuote: quote, interpretation: 'My interpretation', verification: 'user-verified' }] })
    await expect(updatePaperEvidence(root, { evidenceId: id, expectedRevision: 2,
      patch: { originalQuote: 'invented' } as never })).rejects.toThrow()
    expect((await readPaperEvidenceWorkspace(root)).evidence[0].originalQuote).toBe(quote)
  })

  it('returns all papers after editing one card in the global evidence view', async () => {
    const first = await collect()
    const other = join(root, 'papers', 'other')
    await mkdir(other)
    await writeFile(join(other, 'paper.json'), JSON.stringify({ ...metadata, slug: 'other' }))
    await writeFile(join(other, 'paper.pdf'), bytes)
    await writePaperAnnotations(other, [mark({ id: 'mark-2' })])
    const second = await promotePaperEvidence(root, { unitDir: 'papers/other', markId: 'mark-2', expectedRevision: first.revision })
    if (!second.ok) throw new Error(second.message)
    const updated = await updatePaperEvidence(root, { evidenceId: first.items[0].id, expectedRevision: second.revision, patch: { interpretation: 'Saved edit' } })
    if (!updated.ok) throw new Error(updated.message)
    expect(updated.items.map((item) => item.unitDir)).toEqual(['papers/paper', 'papers/other'])
    expect(updated.items[0].interpretation).toBe('Saved edit')
  })

  it('preserves evidence, owned matrix edits, and source navigation through library group moves', async () => {
    const captured = await collect()
    const matrices = await createPaperMatrix(root, { title: 'Compare', unitDirs: ['papers/paper'], axes: ['result'], expectedRevision: 1 })
    if (!matrices.ok) throw new Error(matrices.message)
    await updatePaperMatrix(root, { matrixId: matrices.matrices[0].id, expectedRevision: 2, patch: { cells: [{
      unitDir: 'papers/paper', axis: 'result', value: 'My retained edit', status: 'reported', evidenceIds: [captured.items[0].id],
      comparability: 'unknown', comparabilityReason: ''
    }] } })
    const moved = await movePaperUnitToGroup(root, join(root, 'papers'), unit, 'reviewed')
    const state = await readPaperEvidenceWorkspace(root)
    expect(state.evidence[0]).toMatchObject({ id: captured.items[0].id, unitDir: 'papers/reviewed/paper', originalQuote: quote })
    expect(state.evidence[0].paperVersion).toEqual(captured.items[0].paperVersion)
    expect(state.matrices[0].cells[0]).toMatchObject({ unitDir: 'papers/reviewed/paper', value: 'My retained edit', evidenceIds: [captured.items[0].id] })
    expect(await readPaperEvidenceSource(root, captured.items[0].id)).toMatchObject({ status: 'current', unitDir: moved.unitDir, pdfFile: 'paper.pdf' })
  })

  it('refuses a group move when the evidence index is corrupt', async () => {
    await collect()
    const path = join(root, '.kun/paper-evidence/workspace.json')
    await writeFile(path, '{broken')
    await expect(movePaperUnitToGroup(root, join(root, 'papers'), unit, 'reviewed')).rejects.toMatchObject({ code: 'corrupt-store' })
    expect(await readFile(join(unit, 'paper.pdf'))).toEqual(bytes)
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })

  it('preserves manual edits on repeated promotion', async () => {
    const first = await collect()
    await updatePaperEvidence(root, { evidenceId: first.items[0].id, expectedRevision: 1, patch: { interpretation: 'Keep me' } })
    const again = await promotePaperEvidence(root, { unitDir: 'papers/paper', markId: 'mark-1', expectedRevision: 2 })
    expect(again).toMatchObject({ ok: true, items: [{ interpretation: 'Keep me' }] })
    expect((await readPaperEvidenceWorkspace(root)).evidence).toHaveLength(1)
  })

  it('makes simultaneous repeated promotion idempotent even with the same old revision', async () => {
    const [first, second] = await Promise.all([collect(), collect()])
    expect(first.items[0].id).toBe(second.items[0].id)
    expect((await readPaperEvidenceWorkspace(root)).evidence).toHaveLength(1)
    expect((await readPaperEvidenceWorkspace(root)).revision).toBe(1)
  })

  it('does not upgrade legacy marks to bound even when their quote matches', async () => {
    await writePaperAnnotations(unit, [mark({ pdfSha256: undefined })])
    const result = await collect()
    expect(result.items[0].mechanical).toMatchObject({ versionBinding: 'legacy-unbound', quoteMatch: 'matched' })
    expect(await readPaperEvidenceSource(root, result.items[0].id)).toMatchObject({ status: 'legacy-unbound' })
  })

  it('rejects stale anchors and keeps old evidence when PDF is replaced or missing', async () => {
    const first = await collect()
    await writeFile(join(unit, 'paper.pdf'), '%PDF-1.7\nreplacement')
    await expect(promotePaperEvidence(root, { unitDir: 'papers/paper', markId: 'mark-1', expectedRevision: 1 })).rejects.toMatchObject({ code: 'stale-anchor' })
    const source = await readPaperEvidenceSource(root, first.items[0].id)
    expect(source).toMatchObject({ status: 'stale' })
    expect(source).not.toHaveProperty('pdfFile')
    await rm(join(unit, 'paper.pdf'))
    expect(await readPaperEvidenceSource(root, first.items[0].id)).toMatchObject({ status: 'missing' })
    await expect(promotePaperEvidence(root, { unitDir: 'papers/paper', markId: 'mark-1', expectedRevision: 1 })).rejects.toMatchObject({ code: 'missing-pdf' })
    expect((await readPaperEvidenceWorkspace(root)).evidence).toHaveLength(1)
  })

  it('rejects quotes on the wrong page and out-of-range anchors', async () => {
    await writePaperAnnotations(unit, [mark({ quote: 'A result that is absent' })])
    await expect(collect()).rejects.toMatchObject({ code: 'quote-mismatch' })
    await writePaperAnnotations(unit, [mark({ page: 9 })])
    await expect(collect()).rejects.toMatchObject({ code: 'stale-anchor' })
    expect((await readPaperEvidenceWorkspace(root)).revision).toBe(0)
  })

  it('exposes scanned/partial text without declaring a quote match', async () => {
    await writePaperAnnotations(unit, [mark({ page: 2 })])
    const result = await collect()
    expect(result.items[0]).toMatchObject({ verification: 'unverified', mechanical: { quoteMatch: 'unavailable', textPartial: true } })
    expect(await readPaperEvidenceMaterial(root, 'papers/paper')).toMatchObject({ ok: true, pageCount: 2,
      extractedPages: [1], missingTextPages: [2], textPartial: true, abstractOnly: false })
  })

  it('reports actual figure-index extraction confidence without inventing version binding', async () => {
    await mkdir(join(unit, 'figures'))
    await writeFile(join(unit, 'figures/index.json'), JSON.stringify({ version: 1, source: 'pdf-caption', items: [
      { id: 'figure-1', kind: 'figure', label: 'Figure 1', caption: 'Chart', path: '1.png', width: 20, height: 20, confidence: 'low' },
      { id: 'table-1', kind: 'table', label: 'Table 1', caption: 'Results', path: '2.png', width: 20, height: 20, confidence: 'high' }
    ] }))
    expect(await readPaperEvidenceMaterial(root, 'papers/paper')).toMatchObject({ ok: true,
      figureConfidence: { high: 1, medium: 0, low: 1 }, figuresSource: 'pdf-caption', figuresVersionBound: false })
  })

  it('returns metadata-only material honestly and prevents evidence promotion without PDF', async () => {
    const { pdfFile: _pdf, ...withoutPdf } = metadata
    await writeFile(join(unit, 'paper.json'), JSON.stringify({ ...withoutPdf, abstract: 'Only an abstract.' }))
    expect(await readPaperEvidenceMaterial(root, 'papers/paper')).toMatchObject({ ok: true, paperVersion: null, sourceText: 'Only an abstract.', abstractOnly: true })
    await expect(collect()).rejects.toMatchObject({ code: 'missing-pdf' })
  })

  it('preserves a private visual snapshot after deleting the original mark', async () => {
    await writePaperVisualMarkPng(unit, 'visual-1', Buffer.from('original PNG bytes'))
    await writePaperMarkCard(unit, { id: 'visual-1', kind: 'visual', page: 1, rect: [0, 0, 1, 1],
      image: { path: 'assets/visual-1.png' }, pdfSha256: hash, createdAt: now, updatedAt: now })
    const result = await promotePaperEvidence(root, { unitDir: 'papers/paper', markId: 'visual-1', expectedRevision: 0 })
    if (!result.ok) throw new Error(result.message)
    expect(result.items[0]).toMatchObject({ originalQuote: '', sourceKind: 'visual', mechanical: { quoteMatch: 'not-applicable' } })
    await deletePaperMarkCard(unit, 'visual-1')
    expect(await readFile(join(root, result.items[0].imagePath!), 'utf8')).toBe('original PNG bytes')
  })

  it('rejects escaped paper paths', async () => {
    await expect(readPaperEvidence(root, '../elsewhere')).rejects.toThrow('within')
  })

  it.skipIf(process.platform === 'win32')('rejects symlinked PDF paths outside the unit', async () => {
    await rm(join(unit, 'paper.pdf'))
    await symlink(join(root, 'outside.pdf'), join(unit, 'paper.pdf'))
    await writeFile(join(root, 'outside.pdf'), bytes)
    await expect(collect()).rejects.toThrow('within')
  })
})
