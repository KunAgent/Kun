import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { TrajectoryRecord } from '../../agent/trajectory'
import { parseTrajectoryPage } from '../../agent/trajectory'
import { deriveHarnessLayout, projectHarnessCells } from './trajectory-harness-model'
import { deriveHarnessTimeline, harnessTimelineFocusIds } from './trajectory-harness-timeline'
import { HARNESS_COLLAPSED_HEIGHT, HARNESS_ROW_HEIGHT, HARNESS_TERMINAL_BOUNDARY_HEIGHT, harnessVirtualRows } from './trajectory-harness-virtual'

const base = {
  schemaVersion: 2 as const,
  threadId: 'thread-1', turnId: 'turn-1', roundId: 'round-1', step: 1,
  status: 'completed' as const, detailState: 'available' as const, preview: ''
}

function request(): TrajectoryRecord {
  return {
    ...base,
    id: 'request:req-1', kind: 'llm_request', requestId: 'req-1', attempt: 1,
    attemptReason: 'initial', purpose: 'assistant', provider: 'test', model: 'model',
    endpointFormat: 'chat_completions', startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1_000, optionsAvailable: true,
    usage: {
      promptTokens: 100, completionTokens: 20, totalTokens: 120,
      cacheHitRate: null, turns: 1, requestTtftMs: 250, requestGenerationMs: 750
    }
  }
}

function assistant(): TrajectoryRecord {
  return {
    ...base,
    id: 'assistant:req-1', kind: 'assistant', itemId: 'assistant-text',
    itemIds: ['assistant-reasoning', 'assistant-text'], parentRequestId: 'req-1',
    startedAt: '2026-01-01T00:00:00.000Z', durationMs: 1_000,
    preview: 'Done', thinkingPreview: 'Thinking', attachmentIds: []
  }
}

function tool(): TrajectoryRecord {
  return {
    ...base,
    id: 'tool:call-1', kind: 'tool', callId: 'call-1', parentRequestId: 'req-1',
    toolName: 'read', argumentsItemId: 'tool-call', resultItemId: 'tool-result',
    isError: false, argumentPreview: '{"path":"a.ts"}', resultPreview: 'ok',
    schemaAvailable: true, attachmentIds: [], startedAt: '2026-01-01T00:00:00.500Z',
    durationMs: 100, preview: 'read a.ts'
  }
}

describe('Harness trajectory parity models', () => {
  it('attaches request numbers without rendering a duplicate request row', () => {
    const layout = deriveHarnessLayout([request(), assistant(), tool()])
    expect(layout.requests[0]?.number).toBe(1)
    expect(layout.cells.map((cell) => cell.kind)).toEqual(['assistant', 'tool'])
    expect(layout.cells[0]?.request?.request.requestId).toBe('req-1')
    expect(layout.cells.filter((cell) => cell.request)).toHaveLength(1)
    expect(layout.cells[1]?.result).toBe('ok')
  })

  it('keeps the initial system row outside Turn 1 and emits one request marker', () => {
    const system: TrajectoryRecord = {
      ...base,
      id: 'system:req-1', kind: 'system', itemId: 'prompt:req-1', itemIds: [],
      parentRequestId: 'req-1', startedAt: '2025-12-31T23:59:59.999Z',
      thinkingPreview: '', attachmentIds: [], promptFingerprint: 'prompt-a'
    }
    const layout = deriveHarnessLayout([request(), system, assistant(), tool()])
    expect(layout.turns.map((turn) => turn.number)).toEqual([0, 1])
    expect(layout.turns[0]?.cells).toHaveLength(1)
    expect(layout.cells.filter((cell) => cell.request)).toHaveLength(1)
    expect(layout.cells.find((cell) => cell.request)?.kind).toBe('assistant')
  })

  it('retains a terminal request-only boundary as a 9px virtual row', () => {
    const layout = deriveHarnessLayout([request()])
    expect(layout.cells).toHaveLength(1)
    expect(layout.cells[0]).toMatchObject({ kind: 'request', requestOnly: true })
    expect(harnessVirtualRows(layout.cells)[0]?.height).toBe(HARNESS_TERMINAL_BOUNDARY_HEIGHT)
  })

  it('folds calls and turns into 20px virtual summary rows', () => {
    const layout = deriveHarnessLayout([request(), assistant(), tool()])
    const foldedCalls = projectHarnessCells({
      layout,
      collapsedTurns: new Set(),
      collapsedCalls: new Set(['assistant:req-1']),
      searchQuery: ''
    })
    expect(foldedCalls.at(-1)?.collapsedSummary).toBe('calls')
    expect(harnessVirtualRows(foldedCalls).at(-1)?.height).toBe(HARNESS_COLLAPSED_HEIGHT)
    expect(harnessVirtualRows(layout.cells)[0]?.height).toBe(HARNESS_ROW_HEIGHT)
  })

  it('projects semantic lanes, TTFT, duration and inclusive focus', () => {
    const cells = deriveHarnessLayout([request(), assistant(), tool()]).cells
    const sequence = deriveHarnessTimeline(cells, 'sequence')!
    expect(sequence.spans.map((span) => span.lane)).toEqual([1, 2])
    expect(sequence.spans[0]?.ttftFraction).toBe(0.25)
    const duration = deriveHarnessTimeline(cells, 'duration')!
    expect(duration.end).toBeGreaterThan(duration.start)
    expect(harnessTimelineFocusIds(duration, {
      start: duration.spans[1]!.start,
      end: duration.spans[1]!.end
    })).toContain('tool:call-1')
  })

  it('normalizes schema-v1 pages to v2 renderer records', () => {
    const page = parseTrajectoryPage({
      schemaVersion: 1,
      records: [{
        ...base,
        schemaVersion: 1,
        id: 'legacy-user', kind: 'input', itemId: 'item-1',
        startedAt: '2026-01-01T00:00:00.000Z'
      }],
      summary: {
        schemaVersion: 1, requestCount: 0, toolCount: 0, runningCount: 0,
        failedCount: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: null,
        avgTtftMs: null, avgTokensPerSecond: null, totalDurationMs: 0,
        costUsd: 0, costCny: 0, valueEstimateUsd: 0, valueEstimateCny: 0,
        lastStatus: null
      },
      warnings: [], historyIncomplete: false
    })
    expect(page.schemaVersion).toBe(2)
    expect(page.records[0]).toMatchObject({ kind: 'user', itemIds: ['item-1'] })
  })

  it('pins the frozen Harness geometry in CSS modules', async () => {
    const [view, toolbar, timeline, ledger, inspector] = await Promise.all([
      readFile(new URL('./TrajectoryView.module.css', import.meta.url), 'utf8'),
      readFile(new URL('./TrajectoryToolbar.module.css', import.meta.url), 'utf8'),
      readFile(new URL('./TrajectoryTimeline.module.css', import.meta.url), 'utf8'),
      readFile(new URL('./TrajectoryLedger.module.css', import.meta.url), 'utf8'),
      readFile(new URL('./TrajectoryInspector.module.css', import.meta.url), 'utf8')
    ])
    expect(toolbar).toContain('height: 32px')
    expect(view).toContain('-webkit-app-region: no-drag')
    expect(view).not.toMatch(/var\(--ds-(?:main|ink|muted|faint|hover|card|sidebar-bg)\b/u)
    expect(view).toContain('--trajectory-user-span:')
    expect(view).toContain('--trajectory-context-span:')
    expect(view).toContain('--trajectory-tool-span:')
    expect(timeline).toContain('height: 50px')
    expect(timeline).toContain(".span[data-kind='user']")
    expect(timeline).toContain(".span[data-kind='context']")
    expect(timeline).toContain(".span[data-kind='assistant']")
    expect(timeline).toContain(".span[data-kind='tool']")
    expect(timeline).toContain('100vw color-mix')
    expect(ledger).toContain('height: 30px')
    expect(ledger).toContain(".kindTag[data-kind='subtool']")
    expect(ledger).toContain('max-width: 620px')
    expect(inspector).toContain('width: clamp(320px, 38%, 440px)')
    expect(inspector).toContain('max-width: 760px')
  })
})
