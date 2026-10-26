import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { selectSidebarWorkerRows } from './sidebar-worker-rows'

const row = (unitId: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  unitId, kind: 'worker', threadId: `thr_${unitId}`, parentThreadId: 'parent', harnessId: 'kun', title: unitId,
  workspace: { path: '/w', kind: 'worktree' }, state: 'working', mainState: 'working',
  children: { working: 0, waiting: 0, done: 0, failed: 0 }, stateSince: '2026-10-26T10:00:00.000Z',
  updatedAt: '2026-10-26T10:00:00.000Z', provenance: 'runtime', restoredUnconfirmed: false, stalled: false,
  visibility: 'active', residency: 'live', pinned: false, ...extra
}) as ActivityRow
const NOW = Date.parse('2026-10-26T10:01:00.000Z')

describe('selectSidebarWorkerRows', () => {
  it('groups worker rows by parent in start order with their status', () => {
    const rows = {
      b: row('b', { stateSince: '2026-10-26T10:00:05.000Z', state: 'waiting', waitingReason: 'approval' }),
      a: row('a', { progressNote: 'reading 12 files' }),
      c: row('c', { state: 'failed', stateSince: '2026-10-26T10:00:09.000Z' })
    }
    const grouped = selectSidebarWorkerRows(rows, NOW).get('parent')!
    expect(grouped.map((entry) => [entry.unitId, entry.activity])).toEqual([
      ['a', 'running'], ['b', 'awaiting-input'], ['c', 'failed']
    ])
    expect(grouped[0].detail).toBe('reading 12 files')
  })

  it('ignores non-worker, archived and parentless rows', () => {
    const rows = {
      side: row('side', { kind: 'side-chat' }),
      gone: row('gone', { visibility: 'archived' }),
      orphan: row('orphan', { parentThreadId: undefined })
    }
    expect(selectSidebarWorkerRows(rows, NOW).size).toBe(0)
  })

  it('keeps a finished worker as done', () => {
    const rows = { d: row('d', { state: 'done', lastOutcome: 'completed', reviewRequired: false }) }
    expect(selectSidebarWorkerRows(rows, NOW).get('parent')![0].activity).toBe('read')
  })
})
