import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TrajectoryRecord } from '../../agent/trajectory'
import { trajectoryUiState } from '../../store/trajectory-ui-store'
import { mergeRecords } from './useTrajectoryData'
import { TrajectoryTimeline } from './TrajectoryTimeline'
import { TrajectoryInspector } from './TrajectoryInspector'
import { deriveHarnessLayout } from './trajectory-harness-model'

const base = {
  schemaVersion: 2 as const,
  threadId: 'thread-1', turnId: 'turn-1', roundId: 'round-1', step: 0,
  status: 'completed' as const, detailState: 'not_captured' as const, preview: ''
}

function request(id: string, startedAt: string): TrajectoryRecord {
  return {
    ...base, id, kind: 'llm_request', requestId: id, attempt: 1,
    attemptReason: 'initial', purpose: 'assistant', provider: 'test', model: 'model',
    endpointFormat: 'chat_completions', startedAt, optionsAvailable: false
  }
}

describe('trajectory renderer primitives', () => {
  it('merges refreshes by stable id and keeps chronological order', () => {
    const records = mergeRecords(
      [request('new', '2026-01-02T00:00:00.000Z')],
      [request('old', '2026-01-01T00:00:00.000Z'), { ...request('new', '2026-01-02T00:00:00.000Z'), status: 'failed' }]
    )
    expect(records.map((record) => record.id)).toEqual(['old', 'new'])
    expect(records[1]?.status).toBe('failed')
  })

  it('isolates default UI state by thread and renders all three timeline lanes', () => {
    expect(trajectoryUiState({}, 'thread-a')).toMatchObject({ view: 'chat', filter: 'all' })
    const assistant: TrajectoryRecord = {
      ...base,
      id: 'assistant-1', kind: 'assistant', itemId: 'item-1', itemIds: ['item-1'],
      parentRequestId: 'request-1', startedAt: '2026-01-01T00:00:01.000Z',
      thinkingPreview: '', attachmentIds: []
    }
    const cells = deriveHarnessLayout([
      request('request-1', '2026-01-01T00:00:00.000Z'), assistant
    ]).cells
    const html = renderToStaticMarkup(createElement(TrajectoryTimeline, {
      cells,
      selectedId: null,
      mode: 'sequence',
      range: null,
      hasEarlierRecords: false,
      onRangeChange: () => undefined,
      onRecordSelect: () => undefined,
      onLoadEarlier: () => undefined
    }))
    expect(html).toContain('data-testid="trajectory-timeline"')
    expect(html).toContain('trajectoryLaneInput')
    expect(html).toContain('trajectoryLaneModel')
    expect(html).toContain('trajectoryLaneTool')
  })

  it('renders a DSH-style typed summary instead of raw record JSON', () => {
    const assistant: TrajectoryRecord = {
      ...base,
      id: 'assistant-summary', kind: 'assistant', itemId: 'item-summary', itemIds: ['item-summary'],
      parentRequestId: 'request-summary', startedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 900, preview: 'Summary preview', thinkingPreview: 'Reasoning preview', attachmentIds: []
    }
    const layout = deriveHarnessLayout([
      request('request-summary', '2026-01-01T00:00:00.000Z'), assistant
    ])
    const html = renderToStaticMarkup(createElement(TrajectoryInspector, {
      threadId: 'thread-1',
      cell: layout.cells[0] ?? null,
      request: null,
      parentRequest: layout.requests[0] ?? null,
      width: null,
      onWidthChange: () => undefined,
      onClose: () => undefined,
      onSelectParentRequest: () => undefined
    }))
    expect(html).toContain('data-trajectory-summary')
    expect(html).toContain('Summary preview')
    expect(html).toContain('Request #1')
    expect(html).not.toContain('trajectoryTabSource')
  })
})
