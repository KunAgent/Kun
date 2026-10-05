import { randomUUID } from 'node:crypto'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  paperEvidencePatchSchema,
  type PaperEvidence,
  type PaperEvidenceMaterialResult,
  type PaperEvidenceResult,
  type PaperEvidencePatch,
  type PaperEvidenceSourceResult
} from '../../../shared/paper/paper-evidence-types'
import { paperVisualMarkSchema } from '../../../shared/paper/paper-marks-types'
import { extractEvidencePdfText, withPaperArxivVersion } from './paper-evidence-text'
import { resolveTargetPathWithinWorkspace } from '../workspace-paths'
import { readPaperFigureIndex } from './paper-unit-service'
import { readPaperAnnotations, readPaperMarkCard } from './paper-marks-service'
import { PaperEvidenceError, readPaperEvidenceWorkspace, mutatePaperEvidenceWorkspace } from './paper-evidence-store'
import { paperEvidenceUnit, readPaperIdentity, readPaperVersion } from './paper-evidence-version'

const normalizedQuote = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim()

export async function readPaperEvidence(root: string, unitDir?: string): Promise<PaperEvidenceResult> {
  const unit = unitDir ? await paperEvidenceUnit(root, unitDir) : undefined
  const state = await readPaperEvidenceWorkspace(root)
  return { ok: true, revision: state.revision, items: state.evidence.filter((item) => !unit || item.unitDir === unit.unitDir) }
}

export async function readPaperEvidenceMaterial(root: string, unitDir: string): Promise<PaperEvidenceMaterialResult> {
  const { unitDirAbs } = await paperEvidenceUnit(root, unitDir)
  const { meta } = await readPaperIdentity(unitDirAbs)
  await resolveTargetPathWithinWorkspace('figures/index.json', unitDirAbs)
  const figureIndex = await readPaperFigureIndex(unitDirAbs)
  const figureConfidence = { high: 0, medium: 0, low: 0 }
  for (const figure of figureIndex?.items ?? []) figureConfidence[figure.confidence] += 1
  const figures = { figuresStatus: figureIndex ? meta.preprocess?.figuresStatus ?? 'ok' : 'none',
    figuresSource: figureIndex?.source, figureConfidence, figuresVersionBound: false } as const
  const metadataOnly = (): PaperEvidenceMaterialResult => ({ ok: true, paperVersion: null,
    sourceText: meta.abstract ?? '', pageCount: 0, extractedPages: [], missingTextPages: [],
    textPartial: true, abstractOnly: true, ...figures })
  if (!meta.pdfFile) return metadataOnly()
  let source: Awaited<ReturnType<typeof readPaperVersion>>
  try { source = await readPaperVersion(unitDirAbs) } catch (error) {
    // Only an absent PDF permits the freshly read local abstract. Other source
    // errors fail closed; the renderer must never substitute a cached abstract.
    if (error instanceof PaperEvidenceError && error.code === 'missing-pdf') return metadataOnly()
    throw error
  }
  const { snapshot, bytes } = source
  const text = await extractEvidencePdfText(bytes)
  const after = await readPaperVersion(unitDirAbs)
  if (after.snapshot.pdfSha256 !== snapshot.pdfSha256) throw new PaperEvidenceError('stale-pdf', 'The PDF changed during extraction. Reload it and try again.')
  const readablePages = text.pages.filter((page) => page.text.trim())
  const extractedPages = readablePages.map((page) => page.page)
  const extracted = new Set(extractedPages)
  const missingTextPages = Array.from({ length: text.pageCount }, (_, index) => index + 1).filter((page) => !extracted.has(page))
  return { ok: true, paperVersion: withPaperArxivVersion(snapshot, text.pages.find((page) => page.page === 1)?.text ?? ''),
    sourceText: readablePages.length
      ? readablePages.map((page) => `<!-- page ${page.page} -->\n${page.text}`).join('\n\n')
      : meta.abstract?.trim() ?? '',
    pageCount: text.pageCount, extractedPages, missingTextPages,
    textPartial: !readablePages.length || text.truncated || missingTextPages.length > 0,
    abstractOnly: !readablePages.length, ...figures }
}

export async function promotePaperEvidence(root: string, input: {
  unitDir: string; markId: string; expectedRevision: number
}): Promise<PaperEvidenceResult> {
  const unit = await paperEvidenceUnit(root, input.unitDir)
  const next = await mutatePaperEvidenceWorkspace(root, input.expectedRevision, async (state) => {
    await resolveTargetPathWithinWorkspace(join('marks', 'annotations.json'), unit.unitDirAbs)
    await resolveTargetPathWithinWorkspace(join('marks', `${input.markId}.json`), unit.unitDirAbs)
    const highlights = await readPaperAnnotations(unit.unitDirAbs)
    const highlight = highlights.find((item) => item.id === input.markId)
    const visual = highlight ? null : paperVisualMarkSchema.safeParse(await readPaperMarkCard(unit.unitDirAbs, input.markId))
    const mark = highlight ?? (visual?.success ? visual.data : undefined)
    if (!mark) throw new PaperEvidenceError('missing-mark', 'Choose an existing highlight or visual mark to collect evidence.')
    const rects = mark.kind === 'highlight' ? mark.rects : [mark.rect]
    if (rects.some(([x, y, width, height]) => !width || !height || x + width > 1.001 || y + height > 1.001)) {
      throw new PaperEvidenceError('invalid-anchor', 'The source mark has invalid page coordinates.')
    }
    const { snapshot, bytes } = await readPaperVersion(unit.unitDirAbs)
    if (mark.pdfSha256 && mark.pdfSha256 !== snapshot.pdfSha256) {
      throw new PaperEvidenceError('stale-anchor', 'This mark belongs to a different PDF version. Open its original PDF or make a new mark in the current PDF.')
    }
    // Repeated clicks never replace previously collected evidence or manual edits.
    if (state.evidence.some((item) => item.unitDir === unit.unitDir && item.sourceMarkId === mark.id && item.paperVersion.pdfSha256 === snapshot.pdfSha256)) return
    const text = await extractEvidencePdfText(bytes, mark.page)
    if (mark.page > text.pageCount) throw new PaperEvidenceError('stale-anchor', 'The mark page is outside the current PDF.')
    const pageText = text.pages.find((page) => page.page === mark.page)?.text
    const quote = mark.kind === 'highlight' ? mark.quote : ''
    const quoteMatch = mark.kind === 'visual' ? 'not-applicable' : !pageText?.trim() || !quote.trim() ? 'unavailable'
      : normalizedQuote(pageText).includes(normalizedQuote(quote)) ? 'matched' : 'not-found'
    if (quoteMatch === 'not-found') throw new PaperEvidenceError('quote-mismatch', 'The selected quote was not found on its PDF page. Check the source before collecting evidence.')
    const after = await readPaperVersion(unit.unitDirAbs)
    if (after.snapshot.pdfSha256 !== snapshot.pdfSha256) throw new PaperEvidenceError('stale-pdf', 'The PDF changed while collecting evidence. Reload it and try again.')
    const now = new Date().toISOString()
    const item: PaperEvidence = {
      id: randomUUID(), unitDir: unit.unitDir, sourceMarkId: mark.id, sourceKind: mark.kind,
      originalQuote: quote,
      anchor: { page: mark.page, rects: mark.kind === 'highlight' ? mark.rects : [mark.rect] },
      paperVersion: withPaperArxivVersion(snapshot, text.pages.find((page) => page.page === 1)?.text ?? ''),
      mechanical: { versionBinding: mark.pdfSha256 ? 'bound' : 'legacy-unbound', quoteMatch,
        pageCount: text.pageCount, textPartial: text.truncated || !pageText?.trim(), checkedAt: now },
      interpretation: mark.comment ?? '', conditions: '', question: '',
      claimKind: mark.comment?.trim() ? 'user-judgment' : 'author-reported',
      verification: 'unverified', createdAt: now, updatedAt: now
    }
    if (mark.kind === 'visual') {
      const source = await resolveTargetPathWithinWorkspace(join('marks', mark.image.path), unit.unitDirAbs)
      const imagePath = `.kun/paper-evidence/assets/${item.id}.png`
      const target = await resolveTargetPathWithinWorkspace(imagePath, root)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
      item.imagePath = imagePath
    }
    state.evidence.push(item)
  }).catch(async (error: unknown) => {
    // A repeated in-flight click may carry the previous revision. Returning the
    // already committed capture is safe; never reapply its initial fields.
    if (!(error instanceof PaperEvidenceError) || error.code !== 'revision-conflict') throw error
    const state = await readPaperEvidenceWorkspace(root)
    const { snapshot } = await readPaperVersion(unit.unitDirAbs)
    if (!state.evidence.some((item) => item.unitDir === unit.unitDir && item.sourceMarkId === input.markId &&
      item.paperVersion.pdfSha256 === snapshot.pdfSha256)) throw error
    return state
  })
  return { ok: true, revision: next.revision, items: next.evidence.filter((item) => item.unitDir === unit.unitDir) }
}

export async function updatePaperEvidence(root: string, input: {
  evidenceId: string; expectedRevision: number; patch: PaperEvidencePatch
}): Promise<PaperEvidenceResult> {
  const patch = paperEvidencePatchSchema.parse(input.patch)
  const next = await mutatePaperEvidenceWorkspace(root, input.expectedRevision, (state) => {
    const item = state.evidence.find((candidate) => candidate.id === input.evidenceId)
    if (!item) throw new PaperEvidenceError('missing-evidence', 'Evidence no longer exists. Reload before saving.')
    Object.assign(item, patch, { updatedAt: new Date().toISOString() })
  })
  return { ok: true, revision: next.revision, items: next.evidence }
}

export async function readPaperEvidenceSource(root: string, evidenceId: string): Promise<PaperEvidenceSourceResult> {
  const state = await readPaperEvidenceWorkspace(root)
  const item = state.evidence.find((candidate) => candidate.id === evidenceId)
  if (!item) throw new PaperEvidenceError('missing-evidence', 'Evidence no longer exists.')
  const base = { ok: true as const, unitDir: item.unitDir, page: item.anchor.page, title: item.paperVersion.title,
    citeKey: item.paperVersion.citeKey, expectedSha256: item.paperVersion.pdfSha256 }
  try {
    const unit = await paperEvidenceUnit(root, item.unitDir)
    const { snapshot } = await readPaperVersion(unit.unitDirAbs)
    if (snapshot.pdfSha256 !== item.paperVersion.pdfSha256) {
      return { ...base, status: 'stale', currentSha256: snapshot.pdfSha256, message: 'The PDF was replaced. The saved evidence belongs to its previous bytes; its old anchor will not be opened.' }
    }
    if (item.mechanical.versionBinding === 'legacy-unbound') {
      return { ...base, status: 'legacy-unbound', currentSha256: snapshot.pdfSha256, message: 'This legacy mark has no original PDF-version binding. Its anchor cannot be treated as verified.' }
    }
    return { ...base, status: 'current', pdfFile: snapshot.pdfFile.replaceAll('\\', '/'),
      currentSha256: snapshot.pdfSha256, message: 'The source PDF matches the saved SHA-256. Semantic verification is separate.' }
  } catch (error) {
    if (error instanceof PaperEvidenceError && ['missing-pdf', 'invalid-unit'].includes(error.code)) {
      return { ...base, status: 'missing', message: 'The source PDF or paper unit is missing. The saved evidence has been preserved.' }
    }
    throw error
  }
}
