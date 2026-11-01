import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataReportFileSchema } from '../../contracts/data-report.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildDesignCanvasLocalTools } from './design-canvas-tool.js'
import {
  REPORT_OPEN_TOOL_NAME,
  createReportOpenTool,
  dataReportId,
  shouldAdvertiseReportOpen
} from './report-open-tool.js'

function guiContext(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    clientSurface: 'gui',
    agentSurface: 'code',
    activeToolCallId: 'call_1',
    ...overrides
  }
}

const report = {
  title: 'Kun 用户概况',
  subtitle: '最近 7 天',
  blocks: [
    { type: 'stats', items: [{ label: '注册用户', value: 502, note: 'Auth 账号总数' }, { label: '实际使用', value: '359', delta: '+12', tone: 'positive' }] },
    {
      type: 'chart',
      width: 'half',
      chart: {
        version: 1,
        type: 'line',
        title: 'DAU',
        data: [{ day: '10/26', dau: 107 }, { day: '10/27', dau: 100 }],
        x: { field: 'day' },
        series: [{ field: 'dau', label: 'DAU' }]
      }
    },
    { type: 'text', title: '口径', body: '活跃 = 当日有活动的去重账号' }
  ]
}

describe('report_open tool', () => {
  it('is registered with the GUI local tools', () => {
    expect(buildDesignCanvasLocalTools().map((tool) => tool.name)).toContain(REPORT_OPEN_TOOL_NAME)
  })

  it('advertises on GUI Code and Work turns with a workspace only', () => {
    expect(shouldAdvertiseReportOpen(guiContext())).toBe(true)
    expect(shouldAdvertiseReportOpen(guiContext({ agentSurface: 'write' }))).toBe(true)
    expect(shouldAdvertiseReportOpen(guiContext({ harnessId: 'claude-code' }))).toBe(true)
    expect(shouldAdvertiseReportOpen(guiContext({ clientSurface: 'tui' }))).toBe(false)
    expect(shouldAdvertiseReportOpen(guiContext({ threadMode: 'plan' }))).toBe(false)
    expect(shouldAdvertiseReportOpen(guiContext({ guiDesignMode: true }))).toBe(false)
    expect(shouldAdvertiseReportOpen(guiContext({ imContext: true }))).toBe(false)
    expect(shouldAdvertiseReportOpen(guiContext({ roomAgent: true }))).toBe(false)
    expect(shouldAdvertiseReportOpen(guiContext({ executionUnitKind: 'worker' }))).toBe(false)
    expect(shouldAdvertiseReportOpen(guiContext({ workspace: ' ' }))).toBe(false)
  })

  it('saves the report and bumps the revision when the same title is sent again', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-report-open-'))
    try {
      const times = ['2026-10-28T01:00:00.000Z', '2026-10-28T02:00:00.000Z']
      const tool = createReportOpenTool({ now: () => new Date(times.shift() ?? '2026-10-28T03:00:00.000Z') })
      const context = guiContext({ workspace })
      const first = await tool.execute(report, context)
      expect(first.isError).toBeFalsy()
      const output = first.output as { reportRequest: { reportId: string; relativePath: string; revision: number } }
      const reportId = dataReportId('thread_1', 'Kun 用户概况')
      expect(output.reportRequest).toMatchObject({ reportId, relativePath: `.kun-reports/${reportId}.json`, revision: 1 })

      const second = await tool.execute({ ...report, title: '  kun 用户概况 ' }, context)
      expect((second.output as typeof output).reportRequest.revision).toBe(2)
      const saved = DataReportFileSchema.parse(JSON.parse(await readFile(join(workspace, output.reportRequest.relativePath), 'utf8')))
      expect(saved).toMatchObject({
        reportId,
        threadId: 'thread_1',
        revision: 2,
        createdAt: '2026-10-28T01:00:00.000Z',
        updatedAt: '2026-10-28T02:00:00.000Z'
      })
      expect(saved.blocks).toHaveLength(3)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects invalid chart data with a message the model can act on', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-report-open-'))
    try {
      const result = await createReportOpenTool().execute({
        title: 'Broken',
        blocks: [{ type: 'chart', chart: { version: 1, type: 'line', title: 'x', data: [{ day: 'a', v: 1 }], x: { field: 'day' }, series: [{ field: 'missing' }] } }]
      }, guiContext({ workspace }))
      expect(result.isError).toBe(true)
      expect(String((result.output as { error: string }).error)).toContain('unknown data field: missing')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('refuses to run outside a GUI turn', async () => {
    const result = await createReportOpenTool().execute(report, guiContext({ clientSurface: 'tui' }))
    expect(result.isError).toBe(true)
  })
})
