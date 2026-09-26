import { z } from 'zod'
import {
  PAPER_SEARCH_SOURCES,
  type PaperListEntryMeta,
  type PaperListMeta,
  type PaperSearchCardHit,
  type PaperSearchResultMeta,
  type PaperSearchSource,
  type PaperSearchSourceReport
} from '@shared/paper/paper-search'
import type { PaperImportHintMeta } from '@shared/paper/paper-types'
import { canonicalChartToolName } from './chart-spec-adapter'

export type RendererPaperListEntry = PaperListEntryMeta
export type RendererPaperList = PaperListMeta
export type RendererPaperSearchMeta = PaperSearchResultMeta
export type RendererPaperCard = PaperSearchCardHit

const sourceSchema = z.enum(PAPER_SEARCH_SOURCES)

const cardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  abstract: z.string().optional(),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  coolId: z.string().optional(),
  url: z.string().optional(),
  pdfUrl: z.string().optional(),
  citations: z.number().optional(),
  sources: z.array(sourceSchema).default([])
})

const sourceReportSchema = z.object({
  source: sourceSchema,
  count: z.number(),
  ms: z.number(),
  error: z.string().optional(),
  cached: z.boolean().optional(),
  degraded: z.boolean().optional()
}) satisfies z.ZodType<PaperSearchSourceReport>

const searchMetaSchema = z.object({
  version: z.literal(1),
  query: z.string(),
  total: z.number(),
  papers: z.array(cardSchema),
  sources: z.array(sourceReportSchema)
}) satisfies z.ZodType<PaperSearchResultMeta>

const listEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
  group: z.string().optional(),
  priority: z.enum(['must', 'should', 'optional']).optional(),
  verified: z.boolean(),
  paper: cardSchema.optional()
}) satisfies z.ZodType<PaperListEntryMeta>

const listMetaSchema = z.object({
  version: z.literal(1),
  title: z.string().optional(),
  summary: z.string().optional(),
  papers: z.array(listEntrySchema).min(1)
}) satisfies z.ZodType<PaperListMeta>

export type RendererPaperDetails = {
  version: 1
  papers: RendererPaperCard[]
}

const detailsMetaSchema = z.object({
  version: z.literal(1),
  papers: z.array(cardSchema)
}) satisfies z.ZodType<RendererPaperDetails>

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function metaValue(item: { meta?: Record<string, unknown> } | undefined, key: string): unknown {
  return record(item?.meta) ? item.meta[key] : undefined
}

/** Second trust-boundary validation for `meta.paperSearch` sideband data. */
export function parseRendererPaperSearchMeta(value: unknown): RendererPaperSearchMeta | null {
  const parsed = searchMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Second trust-boundary validation for `meta.paperList` sideband data. */
export function parseRendererPaperListMeta(value: unknown): RendererPaperList | null {
  const parsed = listMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function isPaperReportToolName(value: string | undefined): boolean {
  return canonicalChartToolName(value) === 'paper_report'
}

export function isPaperSearchToolName(value: string | undefined): boolean {
  return ['paper_search', 'paper_citations'].includes(canonicalChartToolName(value))
}

/** Any paper-suite tool — used to track agent-search progress rows. */
export function isPaperToolName(value: string | undefined): boolean {
  return ['paper_search', 'paper_report', 'paper_citations', 'paper_details'].includes(
    canonicalChartToolName(value)
  )
}

export function isPendingPaperReportTool(block: {
  kind?: string
  status?: string
  meta?: Record<string, unknown>
}): boolean {
  if (block.kind !== 'tool' || block.status !== 'running') return false
  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName : undefined
  return isPaperReportToolName(toolName)
}

/**
 * Replay path: a completed `paper_report` tool result becomes a
 * `paper-list` chat block via `meta.paperList`.
 */
export function paperListFromToolItem(item: {
  kind?: string
  status?: string
  isError?: boolean
  toolName?: string
  meta?: Record<string, unknown>
}): RendererPaperList | null {
  if (
    item.kind !== 'tool_result' ||
    item.status !== 'completed' ||
    item.isError === true ||
    !isPaperReportToolName(item.toolName)
  ) return null
  return parseRendererPaperListMeta(metaValue(item, 'paperList'))
}

/**
 * Replay path: `paper_search`/`paper_citations` results keep their merged
 * hit cards on the tool block for the expanded search card.
 */
export function paperSearchMetaFromToolItem(item: {
  kind?: string
  status?: string
  isError?: boolean
  toolName?: string
  meta?: Record<string, unknown>
}): RendererPaperSearchMeta | null {
  if (
    item.kind !== 'tool_result' ||
    item.status !== 'completed' ||
    item.isError === true ||
    !isPaperSearchToolName(item.toolName)
  ) return null
  return parseRendererPaperSearchMeta(metaValue(item, 'paperSearch'))
}

/** Replay path: `paper_details` results attach resolved cards to the tool block. */
export function paperDetailsFromToolItem(item: {
  kind?: string
  status?: string
  isError?: boolean
  toolName?: string
  meta?: Record<string, unknown>
}): RendererPaperDetails | null {
  if (
    item.kind !== 'tool_result' ||
    item.status !== 'completed' ||
    item.isError === true ||
    canonicalChartToolName(item.toolName) !== 'paper_details'
  ) return null
  const parsed = detailsMetaSchema.safeParse(metaValue(item, 'paperDetails'))
  return parsed.success ? parsed.data : null
}

/** Import handle in order of reliability: arXiv (PDF always), venue id, DOI. */
export function paperCardImportInput(card: {
  arxivId?: string
  coolId?: string
  doi?: string
}): string | undefined {
  return card.arxivId ?? card.coolId ?? card.doi
}

export function paperCardUrl(card: {
  arxivId?: string
  doi?: string
  url?: string
}): string | undefined {
  if (card.arxivId) return `https://arxiv.org/abs/${card.arxivId}`
  if (card.doi) return `https://doi.org/${card.doi}`
  return card.url
}

/**
 * Prefetched import metadata (plan P3.2): hands the DOI path everything the
 * search card already resolved so it can skip Crossref and seed the OA chain.
 */
export function paperCardImportMeta(card: PaperSearchCardHit): PaperImportHintMeta {
  return {
    title: card.title,
    authors: card.authors,
    abstract: card.abstract,
    year: card.year !== undefined ? String(card.year) : undefined,
    venue: card.venue,
    doi: card.doi,
    arxivId: card.arxivId,
    coolId: card.coolId,
    pdfUrl: card.pdfUrl,
    sourceUrl: card.url
  }
}

export function paperSourceLabel(source: PaperSearchSource, t: (key: string) => string): string {
  return t(`writePaperSearchSource_${source}`)
}
