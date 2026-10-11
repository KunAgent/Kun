import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { parseBibtexEntries } from '../../../shared/paper/paper-bibtex'
import { parseArxivId } from '../../../shared/paper/paper-ids'
import type { PaperVersionSnapshot } from '../../../shared/paper/paper-evidence-types'
import { readPaperUnitMetaV2 } from './paper-library-service'
import { canonicalPath, resolveTargetPathWithinWorkspace } from '../workspace-paths'
import { PaperEvidenceError } from './paper-evidence-store'
import { ensurePaperEvidenceIdentity } from './paper-evidence-identity'

export async function paperEvidenceUnit(root: string, unitDir: string) {
  const canonicalRoot = await canonicalPath(root)
  const unitDirAbs = await resolveTargetPathWithinWorkspace(unitDir, canonicalRoot)
  await resolveTargetPathWithinWorkspace('paper.json', unitDirAbs)
  return { unitDirAbs, unitDir: relative(canonicalRoot, unitDirAbs).replaceAll('\\', '/') || '.' }
}

export async function readPaperIdentity(unitDirAbs: string) {
  await resolveTargetPathWithinWorkspace('paper.json', unitDirAbs)
  const meta = await readPaperUnitMetaV2(unitDirAbs)
  if (!meta) throw new PaperEvidenceError('invalid-unit', 'paper.json is missing or invalid.')
  const arxiv = parseArxivId(meta.arxivId ?? '')
  const bibtexKey = meta.bibtex ? parseBibtexEntries(meta.bibtex)[0]?.citeKey : undefined
  const declaredKey = meta.citeKey?.trim() || bibtexKey
  const identity = await ensurePaperEvidenceIdentity(unitDirAbs, meta, declaredKey)
  const canonicalId = arxiv ? `arxiv:${arxiv}` : meta.doi ? `doi:${meta.doi.toLowerCase()}` : `local:${identity.localId}`
  const citeKey = declaredKey || identity.citeKey
  return { canonicalId, citeKey, title: meta.title, meta }
}

/** Hash only a specifically requested PDF; never scan/hash the library at startup. */
export async function readPaperVersion(unitDirAbs: string): Promise<{ snapshot: PaperVersionSnapshot; pdfPath: string; bytes: Buffer }> {
  const unitRoot = await canonicalPath(unitDirAbs)
  const { meta, ...identity } = await readPaperIdentity(unitRoot)
  if (!meta.pdfFile) throw new PaperEvidenceError('missing-pdf', 'This paper has metadata only. Add its PDF before collecting evidence.')
  const pdfPath = await resolveTargetPathWithinWorkspace(meta.pdfFile, unitRoot)
  let bytes: Buffer
  try {
    const info = await stat(pdfPath)
    if (info.size > 64 * 1024 * 1024) throw new PaperEvidenceError('pdf-too-large', 'Evidence inspection supports PDFs up to 64 MiB.')
    bytes = await readFile(pdfPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new PaperEvidenceError('missing-pdf', 'The source PDF is missing. Existing evidence has been preserved.')
    throw error
  }
  if (bytes.length > 64 * 1024 * 1024) throw new PaperEvidenceError('pdf-too-large', 'Evidence inspection supports PDFs up to 64 MiB.')
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new PaperEvidenceError('invalid-pdf', 'The source file is not a PDF.')
  return {
    pdfPath, bytes,
    snapshot: {
      ...identity,
      pdfFile: relative(unitRoot, pdfPath).replaceAll('\\', '/'),
      pdfSha256: createHash('sha256').update(bytes).digest('hex'),
      pdfBytes: bytes.length,
      capturedAt: new Date().toISOString()
    }
  }
}
