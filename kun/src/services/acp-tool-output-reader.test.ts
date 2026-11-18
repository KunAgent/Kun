import { expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import { createAcpToolOutputReader } from './acp-tool-output-reader.js'

const session = '89f2d9bb-cc7e-4dee-8bd7-ab20a2cf9644'
const startedAt = '2026-11-18T13:32:29.000Z'
const turn = { id: 'turn', harnessId: 'antigravity', startedAt }
const row = { kind: 'tool_result', status: 'completed', toolName: 'acp:other', threadId: 'thread', turnId: 'turn',
  callId: 'call', output: '', meta: { toolPresentation: { source: 'acp', name: 'mcp_kun-tools_git_inspect' } } }
function fixture(item: object, harnessId = 'antigravity', events: RuntimeEvent[] = []) {
  const read = vi.fn().mockReturnValue({ text: 'original result', truncated: false })
  const items = vi.fn().mockResolvedValue({ items: [item] })
  const bindings = { peek: vi.fn().mockResolvedValue(null) }
  const reader = createAcpToolOutputReader({ getMetadata: vi.fn().mockResolvedValue({ id: 'thread', turns: [{ ...turn, harnessId }] }) },
    { loadItemPage: items, highestSeq: async () => events.at(-1)?.seq ?? 0,
      loadEventPage: async (_id, opts) => ({ hasMore: false, eventBytes: 0,
        events: events.filter(e => e.seq > opts.sinceSeq).slice(0, opts.maxEvents) }) }, bindings, read)
  return { reader, read, items, bindings }
}
it('uses the saved host locator, scoped to the stored call inside the requested turn', async () => {
  const { reader, read, bindings } = fixture({ ...row, meta: { ...row.meta, antigravityOutputSessionId: session } })
  expect(await reader('thread', 'turn', 'call')).toMatchObject({ text: 'original result' })
  expect(bindings.peek).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledWith({ sessionId: session, callId: 'call', name: 'mcp_kun-tools_git_inspect', failed: false })
  for (const [thread, turnId, call] of [['thread', 'other', 'call'], ['thread', 'turn', 'another'], ['foreign', 'turn', 'call']] as const)
    expect(await reader(thread, turnId, call)).toBeNull()
  expect(read).toHaveBeenCalledTimes(1)
})
it('recovers a legacy session from the exact turn marker and refuses foreign markers or existing ACP results', async () => {
  const events = [{ seq: 1, timestamp: '2026-11-18T12:00:00.000Z', threadId: 'thread', kind: 'turn_started' },
    { seq: 2, timestamp: startedAt, threadId: 'thread', turnId: 'turn', kind: 'harness_session_recreated',
      providerKind: 'acp', harnessId: 'antigravity', replacementSession: { nativeSessionId: session } }] as RuntimeEvent[]
  expect(await fixture(row, 'antigravity', events).reader('thread','turn','call')).toMatchObject({ text: 'original result' })
  expect(await fixture(row, 'antigravity', events.map(e => ({ ...e, turnId: 'other' }))).reader('thread','turn','call')).toBeNull()
  const other = fixture(row, 'another-agent', events)
  expect(await other.reader('thread', 'turn', 'call')).toBeNull()
  expect(other.items).not.toHaveBeenCalled()
  expect(await fixture({ ...row, output: false }, 'antigravity', events).reader('thread','turn','call')).toBeNull()
})
