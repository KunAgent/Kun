/**
 * Backfill the main PDF of a library unit that only holds metadata (DOI /
 * BibTeX / feed imports) or whose PDF went missing. Sources, in order: the
 * recorded arXiv id, then the metadata `pdfUrl` (any https host, `%PDF-`
 * magic enforced by paper-http).
 */
import { basename, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { PaperUnitMetaV2 } from '../../../shared/paper/paper-meta-v2'
import { pathExists } from '../workspace-paths'
import { downloadArxivPdf, downloadArxivPdfFromUrl } from './arxiv-client'
import type { PaperFetchContext } from './arxiv-client'
import { readPaperUnitMetaV2, updatePaperUnitMetaV2 } from './paper-library-service'
import { PaperUnitError } from './paper-unit-service'

export async function backfillPaperPdf(
  unitDirAbs: string,
  context: PaperFetchContext = {}
): Promise<PaperUnitMetaV2> {
  const meta = await readPaperUnitMetaV2(unitDirAbs)
  if (!meta) throw new PaperUnitError('invalid-unit', 'paper.json is missing or invalid.')
  if (meta.pdfFile && (await pathExists(join(unitDirAbs, meta.pdfFile)))) return meta
  let pdf: Buffer
  if (meta.arxivId) {
    pdf = await downloadArxivPdf(meta.arxivId, context)
  } else if (meta.pdfUrl) {
    pdf = await downloadArxivPdfFromUrl(meta.pdfUrl, context)
  } else {
    throw new PaperUnitError('not-found', 'No PDF source (arXiv id or PDF URL) is recorded for this paper.')
  }
  const pdfFile = meta.pdfFile ?? `${basename(unitDirAbs)}.pdf`
  await writeFile(join(unitDirAbs, pdfFile), pdf)
  return meta.pdfFile === pdfFile ? meta : updatePaperUnitMetaV2(unitDirAbs, { pdfFile })
}
