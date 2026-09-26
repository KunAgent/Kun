/**
 * Open-access PDF resolution for GUI imports (plan P3). Reuses the shared
 * candidate ordering from the Kun paper-search engine — hit pdfUrl → arXiv
 * twin → Unpaywall → Europe PMC → CORE — then downloads with the bounded
 * paper HTTP layer and verifies the page-1 title before accepting the file,
 * so a stale publisher link cannot silently land the wrong PDF.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveOaPdfUrls,
  type OaPdfCandidate,
  type OaResolveInput
} from '../../../../kun/src/services/paper-search/paper-oa-resolver'
import { jaccardSimilarity, titleTokens } from '../../../../kun/src/services/paper-search/paper-search-text'
import type { PaperSearchCredentials } from '../../../../kun/src/services/paper-search/paper-search-types'
import { fetchWithOptionalProxy } from '../../proxy-fetch'
import { PaperFetchError, paperFetchBytes } from './paper-http'
import { identifyLocalPdf } from './paper-identify-service'
import type { PaperFetchContext } from './arxiv-client'

export type PaperOaFetchContext = PaperFetchContext & {
  credentials?: PaperSearchCredentials
}

/** Id/title match threshold: page-1 text extraction is rough, so keep it loose. */
const PDF_TITLE_JACCARD = 0.55

function pdfMatchesPaper(
  identified: { doi?: string; arxivId?: string; titleGuess?: string },
  expected: { title?: string; doi?: string; arxivId?: string }
): boolean {
  if (expected.doi && identified.doi && identified.doi.toLowerCase() === expected.doi.toLowerCase()) {
    return true
  }
  if (expected.arxivId && identified.arxivId === expected.arxivId) return true
  if (!expected.title || !identified.titleGuess) return false
  const want = titleTokens(expected.title)
  const got = titleTokens(identified.titleGuess)
  return want.size > 0 && jaccardSimilarity(want, got) >= PDF_TITLE_JACCARD
}

async function fetchCandidatePdf(
  url: string,
  ctx: PaperOaFetchContext
): Promise<Buffer> {
  return paperFetchBytes(url, {
    signal: ctx.signal,
    proxyUrl: ctx.proxyUrl,
    expectPdf: true,
    // OA locations point at publisher hosts outside the metadata allowlist.
    allowAnyHost: true
  })
}

export type OaDownloadOutcome =
  | { status: 'ok'; pdf: Buffer; via: OaPdfCandidate['via']; url: string }
  /** No candidate URL existed at all (no pdfUrl, no DOI resolvers). */
  | { status: 'none' }
  /** Candidates existed but every download failed or failed title check. */
  | { status: 'rejected'; tried: number }

/**
 * Try each OA candidate in order; return the first PDF whose page-1
 * identifiers or title agree with the expected paper.
 */
export async function downloadVerifiedOaPdf(
  input: OaResolveInput,
  expected: { title?: string; doi?: string; arxivId?: string },
  ctx: PaperOaFetchContext
): Promise<OaDownloadOutcome> {
  const candidates = await resolveOaPdfUrls(input, {
    fetch: (url, init) => fetchWithOptionalProxy(url, init, ctx.proxyUrl ?? ''),
    signal: ctx.signal,
    credentials: ctx.credentials
  }).catch(() => [] as OaPdfCandidate[])
  if (!candidates.length) return { status: 'none' }
  for (const candidate of candidates) {
    let pdf: Buffer
    try {
      pdf = await fetchCandidatePdf(candidate.url, ctx)
    } catch (error) {
      if (ctx.signal?.aborted) throw error
      continue
    }
    // Title check needs the file on disk for the existing pdfjs pipeline.
    const tmp = await mkdtemp(join(tmpdir(), 'kun-paper-oa-'))
    try {
      const pdfPath = join(tmp, 'candidate.pdf')
      await writeFile(pdfPath, pdf)
      const identified = await identifyLocalPdf(pdfPath).catch(() => ({}))
      if (!expected.title || pdfMatchesPaper(identified, expected)) {
        return { status: 'ok', pdf, via: candidate.via, url: candidate.url }
      }
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return { status: 'rejected', tried: candidates.length }
}

/** Map a fetch failure onto a readable message; aborts propagate upward. */
export function isPaperOaAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof PaperFetchError && error.code === 'canceled')
}
