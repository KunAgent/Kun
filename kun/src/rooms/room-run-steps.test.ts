import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { runSteps } from './room-run-steps.js'

const base = { threadId: 'thread', turnId: 'turn', role: 'tool' as const, status: 'completed' as const }
const call = (id: string, toolName: string, toolKind: string, args: Record<string, unknown>, extra: object = {}) =>
  ({ ...base, id, kind: 'tool_call', toolName, callId: id, toolKind, arguments: args,
    createdAt: '2026-10-18T00:11:00.000Z', ...extra }) as TurnItem
const result = (callId: string, isError = false) =>
  ({ ...base, id: 'result-' + callId, kind: 'tool_result', toolName: 'bash', callId, toolKind: 'command_execution',
    output: 'ok', isError, createdAt: '2026-10-18T00:11:05.000Z' }) as TurnItem

describe('runSteps', () => {
  it('keeps work, drops published messages and cards, and names each target', () => {
    const steps = runSteps([
      call('df', 'bash', 'command_execution', { command: ['df', '-h', '/'] }), result('df'),
      call('read', 'read', 'tool_call', { path: '/tmp/a\nb.txt' }), result('read'),
      call('im', 'send_im_message', 'tool_call', { body: 'progress' }),
      call('ask', 'request_user_input', 'tool_call', {}),
      call('denied_storm', 'bash', 'command_execution', { command: 'rm -rf /' })
    ], 'completed')
    expect(steps).toEqual([
      expect.objectContaining({ id: 'df', target: 'df -h /', status: 'done', endedAt: '2026-10-18T00:11:05.000Z' }),
      expect.objectContaining({ id: 'read', target: '/tmp/a b.txt', status: 'done' })
    ])
  })

  it('marks unfinished calls running while the run is live and cancelled after it ends', () => {
    const items = [call('edit', 'edit', 'file_change', { file_path: 'src/a.ts' }), call('stop', 'bash', 'command_execution',
      { command: 'sleep 9' }, { cancelRequestedAt: '2026-10-18T00:12:00.000Z' }), call('fail', 'bash', 'command_execution', { command: 'false' }), result('fail', true)]
    expect(runSteps(items, 'running').map((step) => step.status)).toEqual(['running', 'cancelled', 'failed'])
    expect(runSteps(items, 'completed').map((step) => step.status)).toEqual(['cancelled', 'cancelled', 'failed'])
  })

  it('keeps approvals with their decision', () => {
    const steps = runSteps([{ ...base, id: 'approval', kind: 'approval', approvalId: 'a', toolName: 'bash',
      summary: '  Delete 9 cache\nfolders ', status: 'denied', createdAt: '2026-10-18T00:13:00.000Z' } as TurnItem], 'completed')
    expect(steps).toEqual([{ id: 'approval', kind: 'approval', toolName: 'bash', label: 'Delete 9 cache folders',
      status: 'denied', startedAt: '2026-10-18T00:13:00.000Z' }])
  })
})
