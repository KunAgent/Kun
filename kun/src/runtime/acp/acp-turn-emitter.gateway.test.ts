import { expect, it, vi } from 'vitest'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { AcpDraftEmitter } from './acp-turn-emitter.js'

const usage = { kind: 'usage', threadId: 'thread', turnId: 'turn', usage: {
  promptTokens: 100, completionTokens: 10, totalTokens: 110, cacheHitRate: null, turns: 0 } } as RuntimeEventDraft
const note = { kind: 'turn_started', threadId: 'thread', turnId: 'turn' } as unknown as RuntimeEventDraft

it('drops the agent-reported usage of a gateway-metered turn but keeps every other event', async () => {
  const record = vi.fn(async () => undefined)
  const turns = { applyItem: vi.fn(), applyAssistantDelta: vi.fn(), updateItem: vi.fn() }
  await new AcpDraftEmitter({ turns, events: { record } } as never, 'thread', 'turn', { gatewayMetered: true }).emitAll([usage, note])
  expect(record).toHaveBeenCalledTimes(1)
  expect(record).toHaveBeenCalledWith(note)
  record.mockClear()
  await new AcpDraftEmitter({ turns, events: { record } } as never, 'thread', 'turn').emitAll([usage])
  expect(record).toHaveBeenCalledWith(usage)
})
