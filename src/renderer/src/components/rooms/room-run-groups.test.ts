import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { groupRoomRunItems, roomToolArgumentSummary } from './room-run-groups'

const item = (id: string, kind: string, fields = {}) => ({ id, kind, threadId: 'thread', turnId: 'turn', status: 'completed', createdAt: '2026-09-13T00:00:00Z', ...fields }) as CoreTurnItemJson
describe('room run tool grouping', () => {
  it('pairs exact call IDs while preserving standalone and incomplete history', () => {
    const rows = groupRoomRunItems([item('a', 'tool_call', { callId: 'first', toolName: 'read' }),
      item('text', 'assistant_text'), item('b', 'tool_result', { callId: 'second', toolName: 'read' }),
      item('c', 'tool_result', { callId: 'first', toolName: 'read', isError: true })])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ kind: 'tool', callId: 'first', call: { id: 'a' }, result: { id: 'c' } })
    expect(rows[1].kind).toBe('item')
    expect(rows[2]).toMatchObject({ kind: 'tool', callId: 'second', result: { id: 'b' } })
  })
  it('summarizes useful arguments without dumping credentials or huge payloads', () => {
    const result = roomToolArgumentSummary({ path: '/project/file', command: 'node\ncheck.js', apiKey: 'secret', data: 'x'.repeat(9000) })
    expect(result).toBe('node check.js · /project/file')
    expect(result).not.toContain('secret')
  })
})
