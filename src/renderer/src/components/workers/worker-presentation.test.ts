import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { WorkerRowData } from './worker-row-data'
import {
  formatWorkerClock,
  formatWorkerTokens,
  groupWorkerRows,
  previewLine,
  workerActivityText,
  workerHue,
  workerMetaParts,
  workerStatus,
  workerTimeLabel,
  WORKER_HUE_COUNT
} from './worker-presentation'
import { workerRow } from './worker-test-fixtures'

const t = i18n.getFixedT('en', 'common')

function row(overrides: Partial<WorkerRowData>): WorkerRowData {
  return {
    workerId: 'wrk',
    label: 'backend',
    state: 'active',
    control: 'manager',
    reviewer: false,
    bucket: 'working',
    ...overrides
  }
}

describe('worker presentation', () => {
  it('puts anything that waits on the user first and finished work last', () => {
    const rows = [
      row({ workerId: 'done', bucket: 'done' }),
      row({ workerId: 'live', bucket: 'working' }),
      row({ workerId: 'failed', bucket: 'needs-you', dispatchState: 'failed' }),
      row({ workerId: 'released', state: 'released', bucket: 'working' }),
      row({ workerId: 'asks', bucket: 'working', openQuestion: {
        questionId: 'q', dispatchId: 'd', workerId: 'asks', question: '?', state: 'open', createdAt: 'x', updatedAt: 'x'
      } })
    ]
    expect(groupWorkerRows(rows).map((group) => [group.section, group.rows.map((entry) => entry.workerId)])).toEqual([
      ['needs-you', ['failed', 'asks']],
      ['working', ['live']],
      ['done', ['done', 'released']]
    ])
    expect(workerStatus(rows[3]!).kind).toBe('released')
    // A finished child agent is done, never "released".
    expect(workerStatus(row({ state: 'released', bucket: 'done', child: { threadId: 'c' } })).kind).toBe('done')
  })

  it('describes live work by tool family instead of raw tool names', () => {
    const live = (currentTool: string) => row({ activityRow: workerRow({ currentTool }) })
    expect(workerActivityText(live('read_file'), t)).toBe('Reading files')
    expect(workerActivityText(live('apply_patch'), t)).toBe('Editing files')
    expect(workerActivityText(live('grep'), t)).toBe('Searching the code')
    expect(workerActivityText(live('bash'), t)).toBe('Running a command')
    expect(workerActivityText(live('mcp__figma__export'), t)).toBe('Calling mcp__figma__export')
    expect(workerActivityText(row({ progressNote: 'Checking NSIS macros' }), t)).toBe('Checking NSIS macros')
  })

  it('cleans streamed previews that start mid-sentence or carry markdown', () => {
    expect(previewLine('。')).toBe('')
    expect(previewLine('——**否（FAIL）** 最终')).toBe('…否（FAIL） 最终')
    expect(previewLine('Patched `update-health.ts`, tests pass')).toBe('Patched update-health.ts, tests pass')
    expect(workerActivityText(row({ bucket: 'done', lastMessagePreview: '。' }), t)).toBe('Done')
  })

  it('formats usage, clocks and agent meta compactly', () => {
    expect(formatWorkerTokens(7_967_830)).toBe('7.97M')
    expect(formatWorkerTokens(412_300)).toBe('412K')
    expect(formatWorkerTokens(980)).toBe('980')
    expect(formatWorkerClock(225_000)).toBe('3:45')
    expect(formatWorkerClock(3_723_000)).toBe('1:02:03')
    expect(workerMetaParts(row({ harnessId: 'kun', model: 'deepseek-flash', totalTokens: 4_100_000 })))
      .toEqual(['Kun', 'deepseek-flash', '4.1M tok'])
  })

  it('shows a clock while live and a relative time once settled', () => {
    const since = '2026-10-23T00:00:00.000Z'
    const now = Date.parse(since) + 125_000
    const live = row({ activityRow: workerRow({ stateSince: since }) })
    expect(workerTimeLabel(live, now, t)).toBe('2:05')
    expect(workerTimeLabel({ ...live, bucket: 'done' }, now, t)).toBe('2 min ago')
    expect(workerTimeLabel(row({}), now, t)).toBe('')
  })

  it('keeps a stable tint per worker', () => {
    expect(workerHue('wrk_abc')).toBe(workerHue('wrk_abc'))
    expect(workerHue('wrk_abc')).toBeGreaterThanOrEqual(0)
    expect(workerHue('wrk_abc')).toBeLessThan(WORKER_HUE_COUNT)
  })
})
