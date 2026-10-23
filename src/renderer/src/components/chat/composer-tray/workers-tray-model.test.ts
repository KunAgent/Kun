import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { selectSessionExecutionSummary } from '../../../store/session-execution-summary'
import { workerRow } from '../../workers/worker-test-fixtures'
import { workerHue } from '../../workers/worker-presentation'
import { WORKER_SEAT_COUNT, workerSeatMap } from '../../workers/worker-seat'
import {
  assignWorkerAvatarColors,
  buildWorkersTrayRows,
  longestRunningSince,
  WORKER_AVATAR_COLORS,
  workerAvatarColor,
  workerRowNote,
  workerRunningActivity,
  workersCountDetail,
  workersSegmentStatus,
  workersSheetSummaryParts,
  workerStopRowData,
  workerTrayRowStatus,
  workersAccessibleStatus
} from './workers-tray-model'

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options)
const NOW = Date.now()

beforeAll(async () => {
  await i18n.loadLanguages('zh')
  await i18n.changeLanguage('en')
})

describe('worker avatars', () => {
  it('gives each team member its own seat, in worker-id order, without shape repeats up to six', () => {
    const seats = workerSeatMap(['w_tests', 'w_forms', 'w_docs'])
    expect([...seats.entries()]).toEqual([['w_docs', 0], ['w_forms', 1], ['w_tests', 2]])
    const crowd = workerSeatMap(Array.from({ length: WORKER_SEAT_COUNT + 2 }, (_, index) => `w${index}`))
    expect(new Set(crowd.values()).size).toBe(WORKER_SEAT_COUNT)
    expect(crowd.get(`w${WORKER_SEAT_COUNT}`)).toBe(0)
  })

  it('puts the seat on every tray row, so the segment and the sheet agree', () => {
    const rows = buildWorkersTrayRows([workerRow({ unitId: 'b' }), workerRow({ unitId: 'a' })], { now: NOW, feedError: false })
    expect(Object.fromEntries(rows.map((row) => [row.id, row.seat]))).toEqual({ a: 0, b: 1 })
  })

  it('keeps one stable color per worker id', () => {
    expect(workerAvatarColor('wrk_1')).toBe(workerAvatarColor('wrk_1'))
    expect(WORKER_AVATAR_COLORS).toContain(workerAvatarColor('wrk_2'))
  })

  it('never repaints a shown worker when a teammate joins', () => {
    const colorsOf = (ids: string[]): Map<string, string> => new Map(
      buildWorkersTrayRows(ids.map((id) => workerRow({ unitId: id, threadId: id, state: 'working' })), {
        now: NOW,
        feedError: false
      }).map((row) => [row.id, row.color])
    )
    const before = colorsOf(['w_docs', 'w_review'])
    // w_da sorts first and hashes to the same hue as w_docs.
    expect(workerHue('w_da')).toBe(workerHue('w_docs'))
    const after = colorsOf(['w_da', 'w_docs', 'w_review', 'wrk_a', 'wrk_b', 'wrk_c', 'wrk_d'])
    for (const [id, color] of before) expect(after.get(id)).toBe(color)
    expect(colorsOf(['w_docs']).get('w_docs')).toBe(before.get('w_docs'))
    for (const [id, color] of after) {
      // The palette index of the Collaboration panel tile's data-hue.
      expect(color).toBe(WORKER_AVATAR_COLORS[workerHue(id)])
    }
    // The team-level rule other surfaces ask gives the same answer.
    expect(assignWorkerAvatarColors(['w_da', 'w_docs']).get('w_docs')).toBe(before.get('w_docs'))
    expect(assignWorkerAvatarColors(['w_docs']).get('w_docs')).toBe(before.get('w_docs'))
  })
})

describe('worker row status', () => {
  const options = { now: NOW, feedError: false }

  it('follows the shared display buckets', () => {
    expect(workerTrayRowStatus(workerRow({ state: 'working' }), options)).toBe('running')
    expect(workerTrayRowStatus(workerRow({ state: 'initializing' }), options)).toBe('starting')
    expect(workerTrayRowStatus(workerRow({ state: 'waiting', waitingReason: 'question' }), options)).toBe('waiting')
    expect(workerTrayRowStatus(workerRow({ state: 'failed' }), options)).toBe('failed')
    expect(workerTrayRowStatus(workerRow({ state: 'done', reviewRequired: true }), options)).toBe('review')
    expect(workerTrayRowStatus(workerRow({ state: 'done', reviewStatus: 'passed' }), options)).toBe('done')
  })

  it('never claims live state for restored rows or a stale feed', () => {
    expect(workerTrayRowStatus(workerRow({ state: 'working', restoredUnconfirmed: true }), options)).toBe('unconfirmed')
    expect(workerTrayRowStatus(workerRow({ state: 'working' }), { now: NOW, feedError: true })).toBe('unconfirmed')
  })

  it('drops archived and settled rows, like the summary', () => {
    expect(workerTrayRowStatus(workerRow({ visibility: 'archived' }), options)).toBeNull()
    expect(workerTrayRowStatus(workerRow({ state: 'idle' } as never), options)).toBeNull()
  })
})

describe('buildWorkersTrayRows', () => {
  it('puts the rows that need the user first and keeps the feed order within a status', () => {
    const rows = buildWorkersTrayRows([
      workerRow({ unitId: 'done', reviewStatus: 'passed', state: 'done' }),
      workerRow({ unitId: 'run_a', state: 'working' }),
      workerRow({ unitId: 'wait', state: 'waiting', waitingReason: 'approval' }),
      workerRow({ unitId: 'run_b', state: 'working' }),
      workerRow({ unitId: 'fail', state: 'failed' })
    ], { now: NOW, feedError: false })
    expect(rows.map((row) => row.id)).toEqual(['wait', 'fail', 'run_a', 'run_b', 'done'])
  })

  it('stops team members through the team and child agents through their turn', () => {
    const [team, child, idle] = buildWorkersTrayRows([
      workerRow({ unitId: 'team', teamId: 'team_1', state: 'working' }),
      workerRow({ unitId: 'child', threadId: 'thr_child', turnId: 'turn_1', state: 'working' }),
      workerRow({ unitId: 'noturn', state: 'working' })
    ], { now: NOW, feedError: false })
    expect(team!.stop).toEqual({ kind: 'team', workerId: 'team' })
    expect(child!.stop).toEqual({ kind: 'turn', threadId: 'thr_child', turnId: 'turn_1' })
    expect(idle!.stop).toBeNull()
    expect(workerStopRowData(team!)).toMatchObject({ workerId: 'team', state: 'active' })
    expect(workerStopRowData(team!)!.child).toBeUndefined()
    expect(workerStopRowData(child!)!.child).toEqual({ threadId: 'thr_child', turnId: 'turn_1' })
    const [waiting] = buildWorkersTrayRows([workerRow({ teamId: 'team_1', state: 'waiting' })], { now: NOW, feedError: false })
    expect(waiting!.stop).toBeNull()
  })

  it('finds the longest running worker', () => {
    const rows = buildWorkersTrayRows([
      workerRow({ unitId: 'a', state: 'working', stateSince: new Date(NOW - 30_000).toISOString() }),
      workerRow({ unitId: 'b', state: 'working', stateSince: new Date(NOW - 192_000).toISOString() }),
      workerRow({ unitId: 'c', state: 'waiting', stateSince: new Date(NOW - 999_000).toISOString() })
    ], { now: NOW, feedError: false })
    expect(longestRunningSince(rows)).toBe(Date.parse(new Date(NOW - 192_000).toISOString()))
  })
})

describe('segment status', () => {
  const summaryOf = (rows: Parameters<typeof selectSessionExecutionSummary>[0], options = {}) =>
    selectSessionExecutionSummary(rows, { now: NOW, ...options })

  it('labels by priority with the right tone', () => {
    const waiting = workersSegmentStatus(summaryOf([
      workerRow({ unitId: 'a', state: 'working' }),
      workerRow({ unitId: 'b', state: 'waiting' })
    ]), t)
    expect(waiting).toEqual({ tone: 'waiting', labelTone: 'waiting', label: '1 needs you', selfNamed: false })
    expect(workersSegmentStatus(summaryOf([workerRow({ state: 'failed' })]), t).labelTone).toBe('error')
    expect(workersSegmentStatus(summaryOf([workerRow({ state: 'done', reviewRequired: true })]), t).label)
      .toBe('1 to review')
    expect(workersSegmentStatus(summaryOf([
      workerRow({ unitId: 'a', state: 'working' }),
      workerRow({ unitId: 'b', state: 'initializing' })
    ]), t)).toEqual({ tone: 'running', labelTone: 'default', label: '2 collaborators working', selfNamed: true })
    expect(workersSegmentStatus(summaryOf([workerRow({ state: 'done', reviewStatus: 'passed' })]), t))
      .toEqual({ tone: 'done', labelTone: 'done', label: 'Collaboration done', selfNamed: true })
    expect(workersSegmentStatus(summaryOf([workerRow({ state: 'done', reviewStatus: 'passed' })], { mainRunning: true }), t).label)
      .toBe('Collaboration done')
    expect(workersSegmentStatus(summaryOf([workerRow({ state: 'working' })], { feedError: true }), t))
      .toEqual({ tone: 'default', labelTone: 'default', label: 'Status unconfirmed', selfNamed: false })
  })

  it('reads in Chinese with the board copy', async () => {
    await i18n.changeLanguage('zh')
    try {
      expect(workersSegmentStatus(summaryOf([workerRow({ state: 'waiting' })]), t).label).toBe('1 个等你处理')
      expect(workersSegmentStatus(summaryOf([
        workerRow({ unitId: 'a', state: 'working' }),
        workerRow({ unitId: 'b', state: 'working' })
      ]), t).label).toBe('2 位协作者在做')
      expect(workersSegmentStatus(summaryOf([workerRow({ state: 'done', reviewStatus: 'passed' })]), t).label)
        .toBe('协作已完成')
      const rows = buildWorkersTrayRows([
        workerRow({ unitId: 'a', state: 'working' }),
        workerRow({ unitId: 'b', state: 'waiting' }),
        workerRow({ unitId: 'c', state: 'done', reviewStatus: 'passed' })
      ], { now: NOW, feedError: false })
      expect(workersSheetSummaryParts(rows, t)).toEqual(['1 个在后台', '1 个等你处理'])
      const summary = summaryOf([
        workerRow({ unitId: 'a', state: 'working' }),
        workerRow({ unitId: 'b', state: 'waiting' })
      ])
      expect(workersAccessibleStatus(summary, workersSegmentStatus(summary, t), t))
        .toBe('协作：1 个等你处理，2 个未结束')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('names the unfinished count unless the label already says it', () => {
    const accessible = (rows: Parameters<typeof selectSessionExecutionSummary>[0], options = {}): string => {
      const summary = summaryOf(rows, options)
      return workersAccessibleStatus(summary, workersSegmentStatus(summary, t), t)
    }
    expect(accessible([
      workerRow({ unitId: 'a', state: 'working' }),
      workerRow({ unitId: 'b', state: 'waiting' }),
      workerRow({ unitId: 'c', state: 'failed' })
    ])).toBe('Collaborators: 1 needs you, 3 unfinished')
    expect(accessible([
      workerRow({ unitId: 'a', state: 'working' }),
      workerRow({ unitId: 'b', state: 'initializing' })
    ])).toBe('Collaborators: 2 collaborators working')
    expect(accessible([workerRow({ state: 'done', reviewStatus: 'passed' })])).toBe('Collaborators: Collaboration done')
    expect(accessible([workerRow({ state: 'working' })], { feedError: true }))
      .toBe('Collaborators: Status unconfirmed')
  })

  it('keeps the old strip count line for the tooltip', () => {
    const summary = summaryOf([
      workerRow({ unitId: 'a', state: 'working' }),
      workerRow({ unitId: 'b', state: 'waiting' }),
      workerRow({ unitId: 'c', state: 'done', reviewStatus: 'passed' })
    ])
    expect(workersCountDetail(summary, t)).toBe('1 running · 1 waiting · 1 done')
  })
})

describe('sheet summary and row notes', () => {
  const rowsOf = (...rows: Parameters<typeof workerRow>[0][]) =>
    buildWorkersTrayRows(rows.map((row, index) => workerRow({ unitId: `w${index}`, ...row })), { now: NOW, feedError: false })

  it('counts finished rows only when nothing else is going on', () => {
    expect(workersSheetSummaryParts(rowsOf({ state: 'done', reviewStatus: 'passed' }, { state: 'done', reviewStatus: 'passed' }), t))
      .toEqual(['2 done'])
    expect(workersSheetSummaryParts(rowsOf({ state: 'failed' }, { state: 'done', reviewStatus: 'passed' }), t))
      .toEqual(['1 failed'])
    expect(workersSheetSummaryParts(rowsOf({ state: 'working', restoredUnconfirmed: true }), t))
      .toEqual(['1 unconfirmed'])
  })

  it('says what a waiting worker needs', () => {
    const [question] = rowsOf({ state: 'waiting', waitingReason: 'question', lastMessagePreview: 'Delete the old note or mark it deprecated?' })
    expect(workerRowNote(question!, t)).toBe('Delete the old note or mark it deprecated?')
    const [approval] = rowsOf({ state: 'waiting', waitingReason: 'approval' })
    expect(workerRowNote(approval!, t)).toBe('Waiting on approval')
  })

  it('summarizes failures, reviews and results', () => {
    const [failed] = rowsOf({ state: 'failed', lastMessagePreview: 'Tests could not start' })
    expect(workerRowNote(failed!, t)).toBe('Tests could not start')
    const [review] = rowsOf({ state: 'done', reviewStatus: 'needs_changes', reviewRequired: true, lastMessagePreview: '2 notes, 1 must change' })
    expect(workerRowNote(review!, t)).toBe('Needs changes · 2 notes, 1 must change')
    const [done] = rowsOf({ state: 'done', reviewStatus: 'passed' })
    expect(workerRowNote(done!, t)).toBe('Passed')
    const [cancelled] = rowsOf({ state: 'done', reviewRequired: false, lastOutcome: 'cancelled' })
    expect(workerRowNote(cancelled!, t)).toBe('Cancelled')
  })

  it('describes running work by tool, note or phase', () => {
    const [tool] = rowsOf({ state: 'working', currentTool: 'read_file' })
    expect(workerRunningActivity(tool!, t)).toBe('Reading files')
    const [note] = rowsOf({ state: 'working', progressNote: 'Writing case 6 of 9' })
    expect(workerRunningActivity(note!, t)).toBe('Writing case 6 of 9')
    const [phase] = rowsOf({ state: 'working', phase: 'verifying' })
    expect(workerRunningActivity(phase!, t)).toBe('Verifying')
  })
})
