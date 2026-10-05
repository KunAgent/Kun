import { paperHighlightSchema, paperVisualMarkSchema, type PaperHighlight, type PaperVisualMark } from '../../../shared/paper/paper-marks-types'
import { readPaperAnnotations, readPaperMarkCard } from './paper-marks-service'
import { resolveTargetPathWithinWorkspace } from '../workspace-paths'
import { PaperEvidenceError } from './paper-evidence-store'
import { readPaperVersion } from './paper-evidence-version'

type BoundMark = PaperHighlight | PaperVisualMark
const anchorOf = (mark: BoundMark) => JSON.stringify(mark.kind === 'highlight'
  ? [mark.page, mark.rects, mark.quote] : [mark.page, mark.rect, mark.image.path])

function currentHash(unitDirAbs: string): () => Promise<string> {
  let pending: Promise<string> | undefined
  return () => pending ??= readPaperVersion(unitDirAbs).then(({ snapshot }) => snapshot.pdfSha256)
}

async function bindMark<T extends BoundMark>(previous: BoundMark | undefined, incoming: T,
  readHash: () => Promise<string>, expectedPdfSha256?: string): Promise<T> {
  const expected = expectedPdfSha256 ?? incoming.pdfSha256
  if (previous) {
    if (previous.kind !== incoming.kind) throw new PaperEvidenceError('invalid-mark', 'Mark kinds cannot be changed.')
    if (previous.pdfSha256 && expected && previous.pdfSha256 !== expected) {
      throw new PaperEvidenceError('stale-anchor', 'A saved mark cannot be rebound to different PDF bytes.')
    }
    if (anchorOf(previous) !== anchorOf(incoming)) {
      if (!previous.pdfSha256 || previous.pdfSha256 !== await readHash()) {
        throw new PaperEvidenceError('stale-anchor', 'Create a new mark in the current PDF instead of changing an unbound or stale anchor.')
      }
    }
    // Do not silently upgrade a legacy mark when its comment/color is edited.
    const { pdfSha256: _untrusted, ...rest } = incoming
    return { ...rest, ...(previous.pdfSha256 ? { pdfSha256: previous.pdfSha256 } : {}) } as T
  }
  if (!expected) return incoming
  if (await readHash() !== expected) throw new PaperEvidenceError('stale-anchor', 'The PDF changed after this reader was opened. Reload before saving a mark.')
  return { ...incoming, pdfSha256: expected }
}

/** The renderer supplies a hash of the bytes actually displayed, never a claimed verified flag. */
export async function validatePaperMarkBinding<T extends BoundMark>(
  unitDirAbs: string, incoming: T, expectedPdfSha256?: string
): Promise<T> {
  await resolveTargetPathWithinWorkspace(`marks/${incoming.kind === 'highlight' ? 'annotations' : incoming.id}.json`, unitDirAbs)
  const previous = incoming.kind === 'highlight'
    ? (await readPaperAnnotations(unitDirAbs)).find((mark) => mark.id === incoming.id)
    : paperVisualMarkSchema.safeParse(await readPaperMarkCard(unitDirAbs, incoming.id)).data
  return bindMark(previous, incoming, currentHash(unitDirAbs), expectedPdfSha256)
}

export async function validatePaperHighlightBindings(unitDirAbs: string, items: unknown[], expectedPdfSha256?: string) {
  await resolveTargetPathWithinWorkspace('marks/annotations.json', unitDirAbs)
  const previous = new Map((await readPaperAnnotations(unitDirAbs)).map((mark) => [mark.id, mark]))
  const readHash = currentHash(unitDirAbs)
  const highlights = items.filter((item) => (item as { kind?: string })?.kind === 'highlight')
  return Promise.all(highlights.map((item) => {
    const mark = paperHighlightSchema.parse(item)
    return bindMark(previous.get(mark.id), mark, readHash, expectedPdfSha256)
  }))
}
