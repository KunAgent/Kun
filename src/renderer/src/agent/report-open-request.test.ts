import { describe, expect, it } from 'vitest'
import { chatBlockFromItem } from './kun-mapper'
import type { CoreTurnItemJson } from './kun-contract'
import type { ChatBlock, ToolBlock } from './types'
import {
  extractReportOpenRequest,
  isReportOpenBlock,
  latestReportOpenBlocks,
  readReportOpenRequest
} from './report-open-request'

const REPORT_ID = '0123456789'

const report = {
  title: 'Kun 用户概况',
  blocks: [
    { type: 'stats', items: [{ label: '注册用户', value: 502 }] },
    {
      type: 'chart',
      chart: {
        version: 1, type: 'line', title: 'DAU',
        data: [{ day: '10/26', dau: 107 }, { day: '10/27', dau: 100 }],
        x: { field: 'day' }, series: [{ field: 'dau' }]
      }
    }
  ]
}

function item(overrides: Partial<CoreTurnItemJson>): CoreTurnItemJson {
  return {
    id: 'item_report',
    turnId: 'turn_report',
    threadId: 'thread_report',
    role: 'assistant',
    status: 'completed',
    createdAt: '2026-10-28T00:00:00.000Z',
    kind: 'tool_call',
    toolName: 'report_open',
    callId: 'call_report',
    arguments: report,
    ...overrides
  } as CoreTurnItemJson
}

function result(output: Record<string, unknown>, isError = false, extra: Partial<CoreTurnItemJson> = {}): CoreTurnItemJson {
  return item({ id: 'item_report_result', kind: 'tool_result', role: 'tool', output, isError, ...extra })
}

const ready = {
  ok: true,
  status: 'ready',
  reportRequest: {
    version: 1, reportId: REPORT_ID, title: 'Kun 用户概况',
    relativePath: '../escape.json', revision: 2, updatedAt: '2026-10-28T01:00:00.000Z'
  }
}

describe('report_open request metadata', () => {
  it('reads a streamed call as pending with the validated report', () => {
    const request = extractReportOpenRequest(item({}))
    expect(request).toMatchObject({ status: 'pending', title: 'Kun 用户概况' })
    expect(request?.report?.blocks).toHaveLength(2)
  })

  it('derives the saved path from the id, never from the transcript', () => {
    const request = extractReportOpenRequest(result(ready))
    expect(request).toMatchObject({
      status: 'ready', reportId: REPORT_ID, relativePath: `.kun-reports/${REPORT_ID}.json`, revision: 2
    })
    expect(request?.report?.title).toBe('Kun 用户概况')
  })

  it('reports a failed call with its error', () => {
    expect(extractReportOpenRequest(result({ ok: false, error: 'unknown data field: x' }, true))).toMatchObject({
      status: 'failed', title: 'Kun 用户概况', error: 'unknown data field: x'
    })
  })

  it('unwraps Codex MCP arguments and text results', () => {
    const request = extractReportOpenRequest(result(
      { content: [{ type: 'text', text: JSON.stringify(ready) }] },
      false,
      { toolName: 'mcp:kun/report_open', arguments: { server: 'kun', arguments: report } }
    ))
    expect(request).toMatchObject({ status: 'ready', reportId: REPORT_ID })
    expect(request?.report).toBeDefined()
  })

  it('ignores other tools and invalid ids', () => {
    expect(extractReportOpenRequest(item({ toolName: 'render_chart' }))).toBeUndefined()
    const bad = { ...ready, reportRequest: { ...ready.reportRequest, reportId: 'nope' } }
    expect(extractReportOpenRequest(result(bad))?.status).toBe('failed')
  })

  it('round-trips through the mapper and keeps the newest call per title', () => {
    const first = chatBlockFromItem(result(ready)) as ChatBlock
    const second = chatBlockFromItem(result(ready, false, { id: 'item_report_result_2', callId: 'call_report_2' })) as ChatBlock
    expect(isReportOpenBlock(first)).toBe(true)
    expect(readReportOpenRequest(first)).toMatchObject({ status: 'ready', reportId: REPORT_ID })
    expect((first as ToolBlock).status).toBe('success')
    const latest = latestReportOpenBlocks([first as ToolBlock, second as ToolBlock])
    expect(latest.map((block) => block.id)).toEqual([second.id])
  })
})
