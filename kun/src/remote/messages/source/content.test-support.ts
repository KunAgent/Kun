import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { HistoryReferenceService } from '../../../history/history-reference-service.js'
import type { HistorySourceProvider } from '../../../contracts/history-reference.js'
export async function longSource(root: string, service: HistoryReferenceService, provider: HistorySourceProvider, label = 'long', cutoff?: string, body?: string) {
  const text = body ?? 'A'.repeat(16383) + '😀' + '中'.repeat(17000) + '_SOURCE_COMPLETE_TAIL', sessionId = label + '-session'
  const path = join(root, label + (provider === 'opencode' ? '.json' : '.jsonl'))
  let records: unknown
  if (provider === 'opencode') records = { info: { id: sessionId, title: 'Source', directory: root, time: { created: 1, updated: 2 } },
    messages: [1, 2].flatMap((i) => [
      { info: { id: `msg${i}u`, role: 'user', time: { created: i } }, parts: [{ id: `part${i}u`, type: 'text', text: 'Question ' + i }] },
      { info: { id: `msg${i}z`, role: 'assistant', parentID: `msg${i}u`, path: { cwd: root }, time: { created: i, completed: i + 1 }, finish: 'stop' },
        parts: [{ id: `part${i}z`, type: 'text', text: i === 1 ? text : 'AFTER_CUTOFF_SECRET' }] }
    ]) }
  else if (provider === 'claude-code') records = [1, 2].flatMap((i) => [
    { type: 'user', uuid: `user-${i}`, parentUuid: i === 1 ? null : 'assistant-1', sessionId, cwd: root,
      timestamp: '2026-09-13T00:00:00.000Z', message: { content: [{ type: 'text', text: 'Question ' + i }] } },
    { type: 'assistant', uuid: `assistant-${i}`, parentUuid: `user-${i}`, sessionId, cwd: root,
      timestamp: '2026-09-13T00:00:00.000Z', message: { content: [{ type: 'text', text: i === 1 ? text : 'AFTER_CUTOFF_SECRET' }], stop_reason: 'end_turn' } }
  ])
  else records = [{ type: 'session_meta', payload: { id: sessionId, cwd: root } }, ...[1, 2].flatMap((i) => [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-' + i } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Question ' + i }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'read', call_id: 'call-' + i, arguments: JSON.stringify({ query: text }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-' + i, output: text } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: i === 1 ? text : 'AFTER_CUTOFF_SECRET' }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-' + i } }
  ])]
  await writeFile(path, Array.isArray(records) ? records.map((record) => JSON.stringify({ timestamp: '2026-09-13T00:00:00.000Z', ...record })).join('\n') + '\n' : JSON.stringify(records))
  const cutoffTurnId = cutoff ?? `${provider}:${sessionId}:${provider === 'codex' ? 'turn-1' : provider === 'claude-code' ? 'user-1' : 'msg1u'}`
  const created = await service.createBranch({ path, sourceProvider: provider, cutoffTurnId, idempotencyKey: label + '-' + provider })
  const page = await service.page(created.reference.id, { threadId: created.thread.id, limit: 100 })
  const item = page.turns.flatMap((turn) => turn.items).find((item) => item.kind === 'assistant_text')!
  return { ...created, path, text, item, page, sessionId }
}
