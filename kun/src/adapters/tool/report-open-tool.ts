import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  DATA_REPORT_MAX_BLOCKS,
  DATA_REPORT_VERSION,
  DataReportInputSchema,
  REPORT_OPEN_TOOL_NAME,
  dataReportRelativePath,
  summarizeDataReport,
  type DataReportFile,
  type DataReportRequestPayload
} from '../../contracts/data-report.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { designToolError } from './design-canvas-normalization.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { assertCanWritePath } from './sandbox-policy.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'

export { REPORT_OPEN_TOOL_NAME } from '../../contracts/data-report.js'

const inputSchema = z.toJSONSchema(DataReportInputSchema, {
  io: 'input',
  target: 'draft-07',
  reused: 'inline'
}) as Record<string, unknown>
delete inputSchema.$schema

/**
 * GUI conversations with a workspace: the report renders as a card in the
 * transcript and is saved for the Artifacts library. Plan turns stay
 * read-only, and IM, room and execution-unit turns have no card to show.
 */
export function shouldAdvertiseReportOpen(context: ToolHostContext): boolean {
  return context.clientSurface === 'gui' &&
    context.threadMode !== 'plan' &&
    context.guiDesignMode !== true &&
    context.imContext !== true &&
    context.roomAgent !== true &&
    context.roomPeer !== true &&
    context.roomStepKind === undefined &&
    context.executionUnitKind === undefined &&
    Boolean(context.workspace.trim())
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/** Same conversation + same title rewrites one report, so revisions land in the same artifact. */
export function dataReportId(threadId: string, title: string): string {
  return createHash('sha256').update(['data-report', threadId, normalizedKey(title)].join('\0')).digest('hex').slice(0, 10)
}

async function previousReport(absolutePath: string): Promise<Pick<DataReportFile, 'createdAt' | 'revision'> | null> {
  try {
    const parsed = JSON.parse(await readFile(absolutePath, 'utf8')) as Record<string, unknown>
    const revision = typeof parsed.revision === 'number' && Number.isInteger(parsed.revision) && parsed.revision > 0
      ? parsed.revision
      : 1
    const createdAt = typeof parsed.createdAt === 'string' && parsed.createdAt ? parsed.createdAt : null
    return createdAt ? { createdAt, revision } : null
  } catch {
    return null
  }
}

export function createReportOpenTool(options: { now?: () => Date } = {}): LocalTool {
  const now = options.now ?? (() => new Date())
  return LocalToolHost.defineTool({
    name: REPORT_OPEN_TOOL_NAME,
    description: [
      'Show a data report in this conversation and save it as an artifact the user can reopen from the Artifacts library.',
      'Use it when the user asks to see numbers, trends, comparisons, proportions or a dashboard, or says visualize / chart / plot / 可视化 / 画图 / 看板, after you have gathered the real data.',
      'A report is an ordered list of blocks: `stats` (KPI tiles: label, value, optional note and delta), `chart` (one governed chart spec: line, area, bar, pie, donut, metric or table, with rows in `data`; `width: "half"` puts two charts side by side) and `text` (a short heading or plain-text note).',
      'Use only data you actually queried or computed; never invent numbers. Put definitions, time zone and cut-off time in `subtitle`, `asOf` or a text block, not in chart titles.',
      'Kun owns rendering, colors, theme and export: send no HTML, CSS, scripts or colors.',
      `At most ${DATA_REPORT_MAX_BLOCKS} blocks. Calling again with the same title in this conversation updates the same artifact (a new revision).`,
      'After the call, state the key takeaways in two or three sentences; do not repeat every number.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: shouldAdvertiseReportOpen,
    inputSchema,
    execute: async (args, context) => withToolBoundary(async () => {
      if (!shouldAdvertiseReportOpen(context)) {
        return designToolError('report_open is available only in GUI conversations with a workspace, outside plan mode')
      }
      const parsed = DataReportInputSchema.safeParse(args)
      if (!parsed.success) return designToolError(`report_open input is invalid: ${z.prettifyError(parsed.error)}`)
      const report = parsed.data
      const reportId = dataReportId(context.threadId, report.title)
      const relativePath = dataReportRelativePath(reportId)
      const resolved = await resolveWorkspacePath(relativePath, context, { enforceWorkspaceBoundary: true })
      assertCanWritePath(resolved.absolutePath, context)
      const previous = await previousReport(resolved.absolutePath)
      const timestamp = now().toISOString()
      const file: DataReportFile = {
        version: DATA_REPORT_VERSION,
        reportId,
        ...(context.threadId ? { threadId: context.threadId } : {}),
        revision: previous ? previous.revision + 1 : 1,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...report
      }
      await mkdir(dirname(resolved.absolutePath), { recursive: true })
      await writeFile(resolved.absolutePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      const reportRequest: DataReportRequestPayload = {
        version: DATA_REPORT_VERSION,
        reportId,
        title: report.title,
        relativePath,
        revision: file.revision,
        updatedAt: timestamp
      }
      const summary = summarizeDataReport(report)
      return {
        output: {
          ok: true,
          status: 'ready',
          reportRequest,
          message: [
            `Showed "${report.title}" in the conversation (${summary.stats} stat(s), ${summary.charts} chart(s)) and saved it to ${relativePath} (revision ${file.revision}); it is listed in the Artifacts library.`,
            'Now summarize the key takeaways briefly.'
          ].join(' ')
        }
      }
    })
  })
}
