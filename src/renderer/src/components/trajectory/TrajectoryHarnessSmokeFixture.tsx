import { createRoot, type Root } from 'react-dom/client'
import type {
  TrajectoryDetail,
  TrajectoryDetailSection,
  TrajectoryRecord,
  TrajectorySummary
} from '../../agent/trajectory'
import { useTrajectoryUiStore } from '../../store/trajectory-ui-store'
import { TrajectoryView } from './TrajectoryView'
import type { TrajectoryData } from './useTrajectoryData'

const THREAD_ID = 'trajectory-smoke-thread'
let mountedRoot: Root | null = null
type RequestRecord = Extract<TrajectoryRecord, { requestId: string }>
type MessageRecord = Extract<TrajectoryRecord, { itemId: string }>
type ToolRecord = Extract<TrajectoryRecord, { callId: string }>

export type TrajectorySmokeScenario =
  | 'default'
  | 'unselected'
  | 'empty'
  | 'loading'
  | 'running'
  | 'failed'
  | 'long'

export function mountTrajectoryHarnessSmokeFixture(
  scenario: TrajectorySmokeScenario = 'default'
): void {
  mountedRoot?.unmount()
  document.body.replaceChildren()
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'
  const host = document.createElement('div')
  host.dataset.trajectorySmokeHost = scenario
  Object.assign(host.style, {
    position: 'fixed', inset: '0', display: 'flex', background: 'var(--ds-bg-main)'
  })
  host.style.setProperty('-webkit-app-region', 'drag')
  document.body.append(host)
  const records = scenarioRecords(scenario)
  const selected = scenario === 'unselected'
    ? null
    : records.find((record) => record.kind === 'assistant')?.id ?? null
  useTrajectoryUiStore.getState().remove(THREAD_ID)
  useTrajectoryUiStore.getState().update(THREAD_ID, { selectedRecordId: selected })
  mountedRoot = createRoot(host)
  mountedRoot.render(
    <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%' }}>
      <TrajectoryView
        threadId={THREAD_ID}
        data={fixtureData(records, scenario)}
        detailLoader={fixtureDetail}
      />
      <div
        data-testid="trajectory-smoke-composer"
        aria-hidden="true"
        inert
        style={{
          position: 'absolute', zIndex: 20, right: '18%', bottom: 0, left: '18%', height: 112,
          border: '1px solid var(--ds-border-muted)', borderRadius: '18px 18px 0 0',
          background: 'var(--ds-bg-main)', boxShadow: '0 -8px 24px rgb(0 0 0 / 6%)',
          visibility: 'hidden', pointerEvents: 'none'
        }}
      />
    </div>
  )
}

function fixtureData(records: TrajectoryRecord[], scenario: TrajectorySmokeScenario): TrajectoryData {
  return {
    records,
    summary: summary(records),
    ...(scenario === 'long' || scenario === 'default' || scenario === 'unselected'
      ? { nextCursor: 'earlier' }
      : {}),
    warnings: [],
    historyIncomplete: false,
    loading: scenario === 'loading',
    loadingOlder: false,
    error: null,
    refresh: () => undefined,
    loadOlder: () => undefined
  }
}

function scenarioRecords(scenario: TrajectorySmokeScenario): TrajectoryRecord[] {
  if (scenario === 'empty' || scenario === 'loading') return []
  const records = baseRecords()
  if (scenario === 'running') {
    return records.map((record) => record.id === 'request:2' || record.id === 'assistant:2'
      ? { ...record, status: 'running', completedAt: undefined, durationMs: undefined }
      : record) as TrajectoryRecord[]
  }
  if (scenario === 'failed') {
    return records.map((record) => record.id === 'tool:2'
      ? { ...record, status: 'failed', isError: true, errorMessage: 'Command exited with code 1' }
      : record) as TrajectoryRecord[]
  }
  if (scenario === 'long') {
    return [...records, ...Array.from({ length: 128 }, (_, index) => message({
      id: `long:${index}`,
      kind: index % 9 === 0 ? 'context' : 'assistant',
      turnId: `turn-${3 + Math.floor(index / 4)}`,
      step: index % 4,
      startedAt: iso(7_000 + index * 90),
      completedAt: iso(7_060 + index * 90),
      durationMs: 60,
      preview: `Virtualized trajectory record ${index + 1}`,
      itemId: `item-long-${index}`,
      itemIds: [`item-long-${index}`],
      parentRequestId: index % 2 ? 'request-2' : undefined,
      thinkingPreview: index % 9 === 0 ? '' : 'bounded reasoning preview'
    }))]
  }
  return records
}

function baseRecords(): TrajectoryRecord[] {
  return [
    request({ id: 'request:1', requestId: 'request-1', roundId: 'round-1', turnId: 'turn-1', step: 0, startedAt: iso(0), firstTokenAt: iso(540), completedAt: iso(1_800), durationMs: 1_800 }),
    message({ id: 'system:1', kind: 'system', turnId: 'turn-1', step: 0, startedAt: iso(0), completedAt: iso(0), durationMs: 0, preview: 'Initial System Prompt', itemId: 'prompt-1', itemIds: [], parentRequestId: 'request-1', thinkingPreview: '', promptFingerprint: 'system-a' }),
    message({ id: 'user:1', kind: 'user', turnId: 'turn-1', step: 0, startedAt: iso(80), completedAt: iso(100), durationMs: 20, preview: 'Review the current implementation and fix the trajectory UI.', itemId: 'user-1', itemIds: ['user-1'], parentRequestId: 'request-1', thinkingPreview: '', sourceAvailable: true, sourceType: 'user', sourceLabel: 'User' }),
    message({ id: 'assistant:1', kind: 'assistant', turnId: 'turn-1', step: 0, startedAt: iso(540), completedAt: iso(1_800), durationMs: 1_260, preview: 'I will inspect the implementation and reproduce the Harness interaction model.', itemId: 'answer-1', itemIds: ['reasoning-1', 'answer-1'], parentRequestId: 'request-1', thinkingPreview: 'Inspecting the renderer structure and timeline geometry.', sourceAvailable: false }),
    tool({ id: 'tool:1', callId: 'call-1', turnId: 'turn-1', step: 0, startedAt: iso(1_900), completedAt: iso(2_900), durationMs: 1_000, parentRequestId: 'request-1', toolName: 'read_file', argumentPreview: '{"path":"TrajectoryView.tsx"}', resultPreview: 'Loaded 337 lines' }),
    request({ id: 'request:2', requestId: 'request-2', roundId: 'round-2', turnId: 'turn-2', step: 1, startedAt: iso(3_200), firstTokenAt: iso(3_940), completedAt: iso(6_200), durationMs: 3_000, previousPromptFingerprint: 'system-a', promptFingerprint: 'system-b' }),
    message({ id: 'system:2', kind: 'system', turnId: 'turn-2', step: 1, startedAt: iso(3_200), completedAt: iso(3_200), durationMs: 0, preview: 'System Prompt Updated', itemId: 'prompt-2', itemIds: [], parentRequestId: 'request-2', thinkingPreview: '', previousPromptFingerprint: 'system-a', promptFingerprint: 'system-b' }),
    message({ id: 'context:2', kind: 'context', turnId: 'turn-2', step: 1, startedAt: iso(3_280), completedAt: iso(3_300), durationMs: 20, preview: 'Workspace and active OpenSpec context', itemId: 'context-2', itemIds: ['context-2'], parentRequestId: 'request-2', thinkingPreview: '', sourceAvailable: true, sourceType: 'model_context', sourceLabel: 'Model context' }),
    message({ id: 'assistant:2', kind: 'assistant', turnId: 'turn-2', step: 1, startedAt: iso(3_940), completedAt: iso(5_100), durationMs: 1_160, preview: 'The dense ledger and synchronized inspector are now wired.', itemId: 'answer-2', itemIds: ['reasoning-2', 'answer-2'], parentRequestId: 'request-2', thinkingPreview: 'Checking turn boundaries, request markers, and responsive behavior.', sourceAvailable: false }),
    tool({ id: 'tool:2', callId: 'call-2', turnId: 'turn-2', step: 1, startedAt: iso(5_200), completedAt: iso(6_000), durationMs: 800, parentRequestId: 'request-2', toolName: 'run_tests', argumentPreview: '{"suite":"trajectory"}', resultPreview: '19 tests passed' }),
    tool({ id: 'subtool:2', kind: 'subtool', callId: 'child-2', parentCallId: 'call-2', turnId: 'turn-2', step: 1, startedAt: iso(5_400), completedAt: iso(5_900), durationMs: 500, parentRequestId: 'request-2', toolName: 'vitest', argumentPreview: '', resultPreview: 'renderer suite passed' }),
    message({ id: 'compacted:2', kind: 'compacted', turnId: 'turn-2', step: 1, startedAt: iso(6_100), completedAt: iso(6_120), durationMs: 20, preview: 'Older context compacted into a stable summary.', itemId: 'compact-2', itemIds: ['compact-2'], parentRequestId: 'request-2', thinkingPreview: '' })
  ]
}

function request(overrides: Partial<RequestRecord> & Pick<RequestRecord, 'id' | 'requestId' | 'roundId' | 'turnId' | 'step' | 'startedAt'>): RequestRecord {
  return {
    schemaVersion: 2, kind: 'llm_request', threadId: THREAD_ID, attempt: 1,
    attemptReason: 'initial', purpose: 'assistant', provider: 'openai-compatible', model: 'gpt-5.6-sol',
    endpointFormat: 'chat_completions', status: 'completed', preview: 'gpt-5.6-sol · openai-compatible',
    detailState: 'available', optionsAvailable: true, promptFingerprint: 'system-a',
    usage: { promptTokens: 42_000, completionTokens: 346, totalTokens: 42_346, cacheHitRate: 0.91, cacheHitTokens: 38_000, requestTtftMs: 540, requestGenerationMs: 1_260 },
    ...overrides
  }
}

function message(overrides: Partial<MessageRecord> & Pick<MessageRecord, 'id' | 'kind' | 'turnId' | 'step' | 'startedAt' | 'preview' | 'itemId' | 'itemIds' | 'thinkingPreview'>): MessageRecord {
  return {
    schemaVersion: 2, threadId: THREAD_ID, roundId: `round-${overrides.turnId}`,
    status: 'completed', detailState: 'available', attachmentIds: [], ...overrides
  }
}

function tool(overrides: Partial<ToolRecord> & Pick<ToolRecord, 'id' | 'callId' | 'turnId' | 'step' | 'startedAt' | 'toolName' | 'argumentPreview' | 'resultPreview'>): ToolRecord {
  return {
    schemaVersion: 2, kind: 'tool', threadId: THREAD_ID, roundId: `round-${overrides.turnId}`,
    status: 'completed', preview: overrides.toolName, detailState: 'available', isError: false,
    schemaAvailable: true, attachmentIds: [], ...overrides
  }
}

function summary(records: TrajectoryRecord[]): TrajectorySummary {
  return {
    schemaVersion: 2,
    requestCount: records.filter((record) => record.kind === 'llm_request').length,
    toolCount: records.filter((record) => record.kind === 'tool').length,
    runningCount: records.filter((record) => record.status === 'running').length,
    failedCount: records.filter((record) => record.status === 'failed').length,
    inputTokens: 84_000, outputTokens: 692, reasoningTokens: 300, cacheReadTokens: 76_000,
    cacheWriteTokens: 0, cacheHitRate: .91, avgTtftMs: 640, avgTokensPerSecond: 31.8,
    totalDurationMs: 4_800, costUsd: .18, costCny: 1.3, valueEstimateUsd: 2.5,
    valueEstimateCny: 18, lastStatus: records.some((record) => record.status === 'running') ? 'running' : 'completed'
  }
}

async function fixtureDetail(
  _threadId: string,
  recordId: string,
  section: TrajectoryDetailSection
): Promise<TrajectoryDetail> {
  if (section === 'raw') {
    const blocks = recordId === 'assistant:1'
      ? [
          { type: 'thinking', content: 'Inspecting the renderer structure and timeline geometry.' },
          { type: 'text', content: 'I will inspect the implementation and reproduce the Harness interaction model.' },
          { type: 'tool-call', content: { path: 'TrajectoryView.tsx' }, callId: 'call-1', toolName: 'read_file' }
        ]
      : [{ type: 'text', content: 'Review the current implementation and fix the trajectory UI.' }]
    return { schemaVersion: 2, recordId, section, state: 'available', truncated: false, content: { kind: 'blocks', blocks } }
  }
  if (section === 'source') {
    return {
      schemaVersion: 2,
      recordId,
      section,
      state: 'available',
      truncated: false,
      content: { kind: 'message-source', label: 'User', value: { kind: 'user' } }
    }
  }
  return {
    schemaVersion: 2,
    recordId,
    section,
    state: 'available',
    truncated: false,
    content: section === 'rendered'
      ? '**Harness parity fixture**\n\nThe selected row is rendered with the production inspector.'
      : { schemaVersion: 2, id: recordId, section, status: 'completed', durationMs: 1160 }
  }
}

function iso(offsetMs: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + offsetMs).toISOString()
}
