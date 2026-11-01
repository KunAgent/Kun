import { ChartSpecV1Schema } from '@kun/extension-api'
import { z } from 'zod'

/**
 * Data report artifact: KPI tiles, governed charts and short text, produced
 * by the `report_open` tool in a conversation and saved under `.kun-reports/`
 * so the Artifacts library lists it as its own kind. The agent sends data and
 * block order only; Kun owns rendering. Shared by the runtime and the
 * renderer, so it must stay free of Node-only APIs.
 */

export const REPORT_OPEN_TOOL_NAME = 'report_open' as const
export const DATA_REPORT_VERSION = 1 as const
export const DATA_REPORT_DIR = '.kun-reports'
export const DATA_REPORT_TITLE_MAX_CHARS = 120
export const DATA_REPORT_MAX_BLOCKS = 24
export const DATA_REPORT_MAX_STATS = 8
export const DATA_REPORT_MAX_BYTES = 512 * 1024

const REPORT_ID_PATTERN = /^[0-9a-f]{10}$/

export function isDataReportId(value: unknown): value is string {
  return typeof value === 'string' && REPORT_ID_PATTERN.test(value)
}

export function dataReportRelativePath(reportId: string): string {
  return `${DATA_REPORT_DIR}/${reportId}.json`
}

export const DataReportStatSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  value: z.union([z.string().trim().min(1).max(40), z.number().finite()]),
  note: z.string().trim().min(1).max(160).optional(),
  delta: z.string().trim().min(1).max(40).optional(),
  tone: z.enum(['positive', 'negative', 'neutral']).optional()
})
export type DataReportStat = z.infer<typeof DataReportStatSchema>

export const DataReportBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('stats'),
    items: z.array(DataReportStatSchema).min(1).max(DATA_REPORT_MAX_STATS)
  }),
  z.strictObject({
    type: z.literal('chart'),
    width: z.enum(['full', 'half']).optional(),
    chart: ChartSpecV1Schema
  }),
  z.strictObject({
    type: z.literal('text'),
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4_000).optional()
  }).refine((block) => Boolean(block.title || block.body), { message: 'text block needs a title or body' })
])
export type DataReportBlock = z.infer<typeof DataReportBlockSchema>

const reportFields = {
  title: z.string().trim().min(1).max(DATA_REPORT_TITLE_MAX_CHARS),
  subtitle: z.string().trim().min(1).max(400).optional(),
  asOf: z.string().trim().min(1).max(80).optional(),
  sources: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
  blocks: z.array(DataReportBlockSchema).min(1).max(DATA_REPORT_MAX_BLOCKS)
}

function withinBytes<T>(value: T, context: z.RefinementCtx): void {
  if (utf8Bytes(value) > DATA_REPORT_MAX_BYTES) {
    context.addIssue({ code: 'custom', message: `report exceeds ${DATA_REPORT_MAX_BYTES} bytes` })
  }
}

/** What the agent sends to `report_open`. */
export const DataReportInputSchema = z.strictObject(reportFields).superRefine(withinBytes)
export type DataReportInput = z.infer<typeof DataReportInputSchema>

/** The saved `.kun-reports/<reportId>.json` file. */
export const DataReportFileSchema = z.strictObject({
  ...reportFields,
  version: z.literal(DATA_REPORT_VERSION),
  reportId: z.string().regex(REPORT_ID_PATTERN),
  threadId: z.string().min(1).max(200).optional(),
  revision: z.number().int().positive(),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64)
}).superRefine(withinBytes)
export type DataReportFile = z.infer<typeof DataReportFileSchema>

/** Tool result payload the GUI reads to show the card and open the artifact. */
export type DataReportRequestPayload = {
  version: typeof DATA_REPORT_VERSION
  reportId: string
  title: string
  relativePath: string
  revision: number
  updatedAt: string
}

export type DataReportSummary = { stats: number; charts: number; texts: number }

export function summarizeDataReport(report: Pick<DataReportInput, 'blocks'>): DataReportSummary {
  const summary: DataReportSummary = { stats: 0, charts: 0, texts: 0 }
  for (const block of report.blocks) {
    if (block.type === 'stats') summary.stats += block.items.length
    else if (block.type === 'chart') summary.charts += 1
    else summary.texts += 1
  }
  return summary
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
