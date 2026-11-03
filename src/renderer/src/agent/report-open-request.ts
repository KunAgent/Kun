import {
  DataReportInputSchema,
  REPORT_OPEN_TOOL_NAME,
  dataReportRelativePath,
  isDataReportId,
  type DataReportInput
} from '../../../../kun/src/contracts/data-report'
import type { ChatBlock, ToolBlock } from './types'
import type { CoreTurnItemJson } from './kun-contract'
import { payloadFor } from './kun-mapper-core'

/**
 * Delegated harnesses report the bridged tool under their own names: Claude
 * Code (Agent SDK) as `mcp__kun__report_open`, Codex as `mcp:kun/report_open`.
 */
export function isReportOpenToolName(name: unknown): boolean {
  return name === REPORT_OPEN_TOOL_NAME ||
    name === `mcp__kun__${REPORT_OPEN_TOOL_NAME}` ||
    name === `mcp:kun/${REPORT_OPEN_TOOL_NAME}`
}

/**
 * Renderer view of one `report_open` call. The report itself comes from the
 * call arguments (validated with the runtime's schema), so the transcript
 * shows the revision this turn produced even after later revisions rewrite
 * the saved file.
 */
export type ReportOpenRequestMetadata = {
  status: 'pending' | 'ready' | 'failed'
  title: string
  report?: DataReportInput
  reportId?: string
  relativePath?: string
  revision?: number
  updatedAt?: string
  error?: string
}

const TITLE_MAX_CHARS = 120

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Codex wraps MCP call arguments as `{ arguments, server }`. */
function callArguments(item: CoreTurnItemJson): Record<string, unknown> {
  const args = record(item.arguments) ?? {}
  return item.toolName === REPORT_OPEN_TOOL_NAME ? args : record(args.arguments) ?? args
}

/** An MCP CallToolResult carries Kun's JSON result as text content. */
function resultPayload(item: CoreTurnItemJson): Record<string, unknown> {
  const payload = payloadFor(item)
  if (item.toolName === REPORT_OPEN_TOOL_NAME || payload.reportRequest) return payload
  const content = Array.isArray(payload.content) ? payload.content : []
  for (const entry of content) {
    const raw = record(entry)?.text
    if (typeof raw !== 'string') continue
    try {
      const parsed = record(JSON.parse(raw))
      if (parsed) return parsed
    } catch {
      // Plain-text result.
    }
  }
  return payload
}

export function parseReportInput(value: unknown): DataReportInput | undefined {
  const parsed = DataReportInputSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function fromRequest(request: Record<string, unknown>, report: DataReportInput | undefined): ReportOpenRequestMetadata | undefined {
  const reportId = request.reportId
  const title = text(request.title, TITLE_MAX_CHARS)
  if (!isDataReportId(reportId) || !title) return undefined
  const revision = typeof request.revision === 'number' && Number.isInteger(request.revision) && request.revision > 0
    ? request.revision
    : 1
  const updatedAt = text(request.updatedAt, 64)
  return {
    status: 'ready',
    title,
    reportId,
    // Never trust a path from the transcript: it is derived from the id.
    relativePath: dataReportRelativePath(reportId),
    revision,
    ...(updatedAt ? { updatedAt } : {}),
    ...(report ? { report } : {})
  }
}

export function extractReportOpenRequest(item: CoreTurnItemJson): ReportOpenRequestMetadata | undefined {
  if (!isReportOpenToolName(item.toolName)) return undefined
  const args = item.arguments ? callArguments(item) : {}
  const report = parseReportInput(args)
  const argTitle = text(args.title, TITLE_MAX_CHARS)
  if (item.kind !== 'tool_result') {
    return argTitle || report ? { status: 'pending', title: argTitle || 'Report', ...(report ? { report } : {}) } : undefined
  }
  const payload = resultPayload(item)
  const request = record(payload.reportRequest)
  const parsed = !item.isError && payload.ok !== false && request ? fromRequest(request, report) : undefined
  if (parsed) return parsed
  return {
    status: 'failed',
    title: argTitle || text(request?.title, TITLE_MAX_CHARS) || 'Report',
    error: text(payload.error, 600) || 'report_open failed'
  }
}

/** Turn sections read every block on each render; a report is validated once per meta object. */
const readCache = new WeakMap<object, ReportOpenRequestMetadata | null>()

/** Validated read of the metadata the mapper attached to a tool block. */
export function readReportOpenRequest(block: ChatBlock): ReportOpenRequestMetadata | undefined {
  if (block.kind !== 'tool' || !isReportOpenToolName(block.meta?.toolName)) return undefined
  const meta = record(block.meta?.reportOpenRequest)
  if (!meta) return undefined
  const cached = readCache.get(meta)
  if (cached !== undefined) return cached ?? undefined
  const parsed = readMeta(meta)
  readCache.set(meta, parsed ?? null)
  return parsed
}

function readMeta(meta: Record<string, unknown>): ReportOpenRequestMetadata | undefined {
  const title = text(meta.title, TITLE_MAX_CHARS) || 'Report'
  const report = meta.report === undefined ? undefined : parseReportInput(meta.report)
  if (meta.status === 'failed') {
    return { status: 'failed', title, error: text(meta.error, 600) || 'report_open failed' }
  }
  if (meta.status === 'pending') return { status: 'pending', title, ...(report ? { report } : {}) }
  return fromRequest(meta, report)
}

export function reportOpenStatusOverride(
  item: CoreTurnItemJson,
  request: ReportOpenRequestMetadata | undefined
): ToolBlock['status'] | undefined {
  if (!isReportOpenToolName(item.toolName) || !request) return undefined
  if (request.status === 'failed') return 'error'
  return request.status === 'pending' ? undefined : 'success'
}

export function isReportOpenBlock(block: ChatBlock): block is ToolBlock {
  return block.kind === 'tool' && Boolean(readReportOpenRequest(block))
}

function titleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/** Calls with the same title in one turn rewrite one report: show the newest call only. */
export function latestReportOpenBlocks(blocks: readonly ToolBlock[]): ToolBlock[] {
  const latest = new Map<string, ToolBlock>()
  for (const block of blocks) {
    const request = readReportOpenRequest(block)
    const key = request ? titleKey(request.title) : block.id
    latest.delete(key)
    latest.set(key, block)
  }
  return [...latest.values()]
}
