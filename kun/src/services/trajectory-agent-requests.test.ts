import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { TrajectoryRequestRecordSchema } from '../contracts/trajectory.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { SessionStore, SessionUsageRecord } from '../ports/session-store.js'
import { LlmDebugRecorder } from './llm-debug-recorder.js'
import {
  agentToolLabel,
  projectAgentRequests,
  type AgentTrajectoryTurn
} from './trajectory-agent-requests.js'
import { TrajectoryQueryService } from './trajectory-query-service.js'

const T = (second: number): string => new Date(Date.UTC(2026, 9, 10, 8, 0, second)).toISOString()

const turn: AgentTrajectoryTurn = {
  id: 'turn-a',
  status: 'completed',
  createdAt: T(0),
  startedAt: T(1),
  finishedAt: T(30),
  model: 'codemaker-pro',
  harnessId: 'codemaker'
}

function text(id: string, at: number, value: string, kind: 'assistant_text' | 'assistant_reasoning' = 'assistant_text'): TurnItem {
  return { id, kind, threadId: 'thread-a', turnId: 'turn-a', role: 'assistant', status: 'completed', createdAt: T(at), text: value }
}

function call(id: string, at: number, kind = 'read', extra: Record<string, unknown> = {}): TurnItem {
  return {
    id: `call-${id}`, kind: 'tool_call', threadId: 'thread-a', turnId: 'turn-a', role: 'tool',
    status: 'completed', createdAt: T(at), callId: id, toolName: `acp:${kind}`, toolKind: 'tool_call',
    arguments: { title: `Tool ${id}`, kind, ...extra }
  }
}

function result(id: string, at: number): TurnItem {
  return {
    id: `result-${id}`, kind: 'tool_result', threadId: 'thread-a', turnId: 'turn-a', role: 'tool',
    status: 'completed', createdAt: T(at), finishedAt: T(at), callId: id, toolName: 'acp:read',
    toolKind: 'tool_call', output: 'ok', isError: false
  }
}

function usage(promptTokens: number, completionTokens: number): UsageSnapshot {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cacheHitRate: null, turns: 1 }
}

function report(at: number, snapshot: UsageSnapshot): SessionUsageRecord {
  return {
    threadId: 'thread-a', turnId: 'turn-a', model: 'codemaker-pro', source: 'harness-reported',
    harnessId: 'codemaker', completedAt: T(at), usage: snapshot
  }
}

/** reasoning+text → two parallel reads, text → one read, then a final answer. */
const items: TurnItem[] = [
  { id: 'user', kind: 'user_message', threadId: 'thread-a', turnId: 'turn-a', role: 'user', status: 'completed', createdAt: T(0), text: 'go' },
  text('think-1', 3, 'plan', 'assistant_reasoning'),
  text('say-1', 4, 'reading'),
  call('a', 5),
  call('b', 5),
  result('a', 7),
  result('b', 8),
  text('say-2', 10, 'one more'),
  call('c', 11),
  result('c', 14),
  text('say-3', 16, 'done')
]

describe('projectAgentRequests', () => {
  it('splits an Agent turn into model calls and marks a per-turn usage total', () => {
    const projection = projectAgentRequests({
      threadId: 'thread-a', turns: [turn], items, usage: [report(30, usage(3_000, 300))], tracedTurnIds: new Set()
    })

    expect(projection.requests.map((request) => ({
      step: request.step,
      startedAt: request.startedAt,
      firstTokenAt: request.firstTokenAt,
      completedAt: request.completedAt,
      attribution: request.usageAttribution
    }))).toEqual([
      { step: 0, startedAt: T(1), firstTokenAt: T(3), completedAt: T(5), attribution: 'included' },
      { step: 1, startedAt: T(8), firstTokenAt: T(10), completedAt: T(11), attribution: 'included' },
      { step: 2, startedAt: T(14), firstTokenAt: T(16), completedAt: T(30), attribution: 'aggregate' }
    ])
    expect(projection.requests[2]).toMatchObject({
      origin: 'agent', harnessId: 'codemaker', harnessLabel: 'CodeMaker', provider: 'codemaker', model: 'codemaker-pro',
      usageSteps: 3, usage: { promptTokens: 3_000, completionTokens: 300 }
    })
    expect(projection.owners.get('call-b')?.step).toBe(0)
    expect(projection.owners.get('say-2')?.step).toBe(1)
    expect(projection.owners.has('user')).toBe(false)
  })

  it('attaches per-call reports one to one even when they all land at turn end', () => {
    const projection = projectAgentRequests({
      threadId: 'thread-a',
      turns: [turn],
      items,
      usage: [report(29, usage(1_000, 50)), report(29, usage(1_200, 60)), report(29, usage(1_400, 70))],
      tracedTurnIds: new Set()
    })

    expect(projection.requests.map((request) => [request.usageAttribution, request.usage?.promptTokens]))
      .toEqual([['call', 1_000], ['call', 1_200], ['call', 1_400]])
  })

  it('maps reports to the call they followed and leaves later calls of a running turn open', () => {
    const projection = projectAgentRequests({
      threadId: 'thread-a',
      turns: [{ ...turn, status: 'running', finishedAt: undefined }],
      items: items.slice(0, -1),
      usage: [report(6, usage(900, 40))],
      tracedTurnIds: new Set()
    })

    expect(projection.requests.map((request) => [request.status, request.usageAttribution]))
      .toEqual([['completed', 'call'], ['completed', undefined]])
  })

  it('keeps folded reports schema-valid when an Agent counts cache reads outside prompt tokens', () => {
    const cached = { ...usage(100, 5), cacheHitTokens: 400, cacheMissTokens: 0, cachedTokens: 400 }
    const projection = projectAgentRequests({
      threadId: 'thread-a',
      turns: [turn],
      items: items.slice(0, 3),
      usage: [report(20, cached), report(25, cached)],
      tracedTurnIds: new Set()
    })

    expect(projection.requests).toHaveLength(1)
    expect(projection.requests[0]?.usage).toMatchObject({ promptTokens: 200, cacheHitTokens: 800 })
    expect(() => TrajectoryRequestRecordSchema.parse(projection.requests[0])).not.toThrow()
  })

  it('skips Kun turns and Agent turns Kun already traced', () => {
    const projection = projectAgentRequests({
      threadId: 'thread-a',
      turns: [{ ...turn, harnessId: 'kun' }, { ...turn, id: 'turn-b' }],
      items,
      usage: [],
      tracedTurnIds: new Set(['turn-b'])
    })

    expect(projection.requests).toEqual([])
  })
})

describe('agentToolLabel', () => {
  it('labels ACP calls by kind and target, from sideband or legacy arguments', () => {
    expect(agentToolLabel({
      ...call('x', 1, 'execute'),
      meta: { delegatedTool: { version: 1, kind: 'execute', title: 'Ran ls', command: 'ls -la' } }
    } as Extract<TurnItem, { kind: 'tool_call' }>)).toEqual({ toolName: 'execute', argumentPreview: 'ls -la' })
    expect(agentToolLabel(call('y', 1, 'read', {
      locations: [{ path: '/repo/src/a.ts', line: 12 }],
      rawInput: { path: '/repo/src/a.ts' }
    }) as Extract<TurnItem, { kind: 'tool_call' }>)).toEqual({ toolName: 'read', argumentPreview: '/repo/src/a.ts:12' })
    expect(agentToolLabel(call('z', 1, 'other', { title: 'Invoked skill openspec-apply-change' }) as Extract<TurnItem, { kind: 'tool_call' }>))
      .toEqual({ toolName: 'other', argumentPreview: 'Invoked skill openspec-apply-change' })
  })

  it('leaves non-ACP tools alone', () => {
    expect(agentToolLabel({ ...call('n', 1), toolName: 'Bash' } as Extract<TurnItem, { kind: 'tool_call' }>)).toBeNull()
  })
})

describe('TrajectoryQueryService with third-party Agent turns', () => {
  it('shows rebuilt model calls with usage next to per-call assistant rows', async () => {
    const sessions = {
      loadItems: async () => items,
      loadUsageRecords: async () => [report(30, usage(3_000, 300))]
    } as unknown as SessionStore
    const service = new TrajectoryQueryService(new LlmDebugRecorder(), sessions, async () => [turn])
    const page = await service.page('thread-a', { limit: 100, filter: 'all', query: '' })

    const requests = page.records.filter((record) => record.kind === 'llm_request')
    const assistants = page.records.filter((record) => record.kind === 'assistant')
    expect(requests).toHaveLength(3)
    expect(assistants.map((record) => record.kind === 'assistant' && [record.preview, record.parentRequestId]).sort())
      .toEqual([
        ['done', 'agent:turn-a:2'],
        ['one more', 'agent:turn-a:1'],
        ['reading', 'agent:turn-a:0']
      ])
    expect(page.records).toContainEqual(expect.objectContaining({
      kind: 'tool', callId: 'c', toolName: 'read', durationMs: 3_000, parentRequestId: 'agent:turn-a:1'
    }))
    expect(page.summary).toMatchObject({ requestCount: 3, toolCount: 3, inputTokens: 3_000, outputTokens: 300 })
    const timing = await service.detail('thread-a', 'request:agent:turn-a:1', 'timing')
    expect(timing?.content).toMatchObject({ durationMs: 3_000, ttftMs: 2_000 })
  })
})
