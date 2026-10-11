import { expect, it, vi } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { AcpDraftEmitter } from './acp-turn-emitter.js'

const call = (createdAt: string, status: 'pending' | 'running' | 'completed'): TurnItem => ({
  id: 'item_tool_1', kind: 'tool_call', threadId: 'thread', turnId: 'turn', role: 'tool', status,
  createdAt, callId: 'call-1', toolName: 'acp:read', toolKind: 'tool_call', arguments: {}
})
const result = (createdAt: string): TurnItem => ({
  id: 'item_toolresult_1', kind: 'tool_result', threadId: 'thread', turnId: 'turn', role: 'tool',
  status: 'completed', createdAt, finishedAt: createdAt, callId: 'call-1', toolName: 'acp:read',
  toolKind: 'tool_call', output: 'ok', isError: false
})
const draft = (kind: string, item: TurnItem): RuntimeEventDraft =>
  ({ kind, threadId: 'thread', turnId: 'turn', itemId: item.id, item }) as RuntimeEventDraft

it('keeps the first createdAt/finishedAt when a delegated tool item is rebuilt by updates', async () => {
  const applied: TurnItem[] = []
  const turns = {
    applyItem: vi.fn(async (_thread: string, item: TurnItem) => { applied.push(item) }),
    applyAssistantDelta: vi.fn(),
    updateItem: vi.fn(async (_thread: string, _id: string, item: TurnItem) => { applied.push(item); return item })
  }
  await new AcpDraftEmitter({ turns, events: { record: vi.fn() } } as never, 'thread', 'turn').emitAll([
    draft('item_created', call('2026-10-10T08:00:01.000Z', 'pending')),
    draft('tool_call_started', call('2026-10-10T08:00:02.000Z', 'running')),
    draft('item_updated', call('2026-10-10T08:00:05.000Z', 'completed')),
    draft('tool_call_finished', result('2026-10-10T08:00:05.000Z')),
    // A late evidence refresh rebuilds the result again.
    draft('item_updated', result('2026-10-10T08:00:09.000Z'))
  ])

  expect(applied.filter((item) => item.kind === 'tool_call').map((item) => item.createdAt))
    .toEqual(['2026-10-10T08:00:01.000Z', '2026-10-10T08:00:01.000Z', '2026-10-10T08:00:01.000Z'])
  expect(applied.filter((item) => item.kind === 'tool_result').map((item) => [item.createdAt, item.finishedAt]))
    .toEqual([
      ['2026-10-10T08:00:05.000Z', '2026-10-10T08:00:05.000Z'],
      ['2026-10-10T08:00:05.000Z', '2026-10-10T08:00:05.000Z']
    ])
})
