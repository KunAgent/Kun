import { describe, expect, it } from 'vitest'
import { lunarInfo, lunarLabel, monthCells, monthOf, shiftDay, shiftMonth, weekdayLabels } from './calendar'
import {
  appendTaskChange, applyNoteChange, countTasks, formatKunDispatchUrl, formatKunRoomUrl,
  formatKunThreadUrl, linkChange, parseTasks, quadrantChange, rolloverIncompleteDailyNoteTasks,
  summarizeDay, taskAt, toggleChange
} from './tasks'

describe('daily notes task markdown', () => {
  it('parses GFM tasks, completion state, and !1..!4 quadrant tokens while ignoring code fences', () => {
    const md = [
      'Morning notes',
      '- [x] Fix crash !1',
      '- [ ] Write design doc !2',
      '* [ ] Triage inbox',
      '```md',
      '- [ ] Inside code block !3',
      '```',
      '+ [X] Cleanup !4  '
    ].join('\n')

    const tasks = parseTasks(md)
    expect(tasks.map(t => ({ line: t.line, done: t.done, text: t.text, quadrant: t.quadrant }))).toEqual([
      { line: 1, done: true, text: 'Fix crash', quadrant: 1 },
      { line: 2, done: false, text: 'Write design doc', quadrant: 2 },
      { line: 3, done: false, text: 'Triage inbox', quadrant: null },
      { line: 7, done: true, text: 'Cleanup', quadrant: 4 }
    ])
    expect(countTasks(md)).toEqual({ done: 2, total: 4 })
    expect(summarizeDay(md)).toEqual({ done: 2, total: 4, hasContent: true })
    expect(summarizeDay('   \n  ')).toEqual({ done: 0, total: 0, hasContent: false })
  })

  it('parses kun:// room, dispatch, and thread links in either token order alongside sub-notes', () => {
    const md = [
      `- [ ] Fix fold jump [小Kun](${formatKunDispatchUrl('room-1', 'wbl-9')}) !1`,
      '  - Repro: collapse sidebar then click notification',
      `- [ ] Triage packaging !2 [小Kun](${formatKunRoomUrl('room-1', 'msg-3')})`,
      `- [x] Follow up session [会话](${formatKunThreadUrl('thr-42')})`
    ].join('\n')

    const tasks = parseTasks(md)
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({
      text: 'Fix fold jump',
      quadrant: 1,
      notes: ['- Repro: collapse sidebar then click notification'],
      link: { kind: 'dispatch', label: '小Kun', roomId: 'room-1', linkId: 'wbl-9' }
    })
    expect(tasks[1]).toMatchObject({
      text: 'Triage packaging',
      quadrant: 2,
      link: { kind: 'room', label: '小Kun', roomId: 'room-1', messageId: 'msg-3' }
    })
    expect(tasks[2]).toMatchObject({
      done: true,
      text: 'Follow up session',
      quadrant: null,
      link: { kind: 'thread', label: '会话', threadId: 'thr-42' }
    })
  })

  it('preserves links when changing quadrants and preserves quadrants when binding links', () => {
    let md = '- [ ] Ship build !1'
    md = applyNoteChange(md, linkChange(taskAt(md, 0)!, {
      label: '小Kun',
      url: formatKunRoomUrl('room-a', 'msg-1')
    }))
    expect(md).toBe('- [ ] Ship build [小Kun](kun://room/room-a?message=msg-1) !1')

    md = applyNoteChange(md, quadrantChange(taskAt(md, 0)!, 3))
    expect(md).toBe('- [ ] Ship build [小Kun](kun://room/room-a?message=msg-1) !3')

    md = applyNoteChange(md, linkChange(taskAt(md, 0)!, {
      label: '小Kun',
      url: formatKunDispatchUrl('room-a', 'wbl-7')
    }))
    expect(md).toBe('- [ ] Ship build [小Kun](kun://dispatch/room-a/wbl-7) !3')
  })

  it('preserves CRLF line endings when toggling and updating quadrants', () => {
    let md = 'Header\r\n- [ ] Ship build !1\r\n- [ ] Review PR   \r\n'
    const first = taskAt(md, 1)!
    expect(first.text).toBe('Ship build')
    expect(first.quadrant).toBe(1)

    md = applyNoteChange(md, toggleChange(first))
    expect(md).toBe('Header\r\n- [x] Ship build !1\r\n- [ ] Review PR   \r\n')

    md = applyNoteChange(md, quadrantChange(taskAt(md, 1)!, null))
    expect(md).toBe('Header\r\n- [x] Ship build\r\n- [ ] Review PR   \r\n')

    md = applyNoteChange(md, quadrantChange(taskAt(md, 2)!, 3))
    expect(md).toBe('Header\r\n- [x] Ship build\r\n- [ ] Review PR !3\r\n')
  })

  it('rolls over incomplete tasks with their sub-notes and links while keeping completed tasks in place', () => {
    const yesterday = [
      'Retrospective',
      '- [x] Merged hotfix !1',
      '- [ ] Pending review [小Kun](kun://dispatch/r1/l1) !2',
      '  - Waiting on CI matrix',
      '- [ ] Already on today'
    ].join('\n')
    const today = '- [ ] Already on today\n- [ ] Fresh task'

    const { nextFrom, nextTo, movedCount } = rolloverIncompleteDailyNoteTasks(yesterday, today)
    expect(movedCount).toBe(2)
    expect(nextFrom).toBe('Retrospective\n- [x] Merged hotfix !1')
    expect(nextTo).toBe([
      '- [ ] Already on today',
      '- [ ] Fresh task',
      '- [ ] Pending review [小Kun](kun://dispatch/r1/l1) !2',
      '  - Waiting on CI matrix'
    ].join('\n'))
  })

  it('appends tasks cleanly to empty, unterminated, and newline-terminated notes', () => {
    let md = ''
    md = applyNoteChange(md, appendTaskChange(md, 'First task', 1))
    expect(md).toBe('- [ ] First task !1')

    md = applyNoteChange(md, appendTaskChange(md, 'Second\ntask', null))
    expect(md).toBe('- [ ] First task !1\n- [ ] Second task')

    const withNewline = md + '\n'
    expect(applyNoteChange(withNewline, appendTaskChange(withNewline, 'Third', 4)))
      .toBe('- [ ] First task !1\n- [ ] Second task\n- [ ] Third !4')
  })
})

describe('daily notes calendar helpers', () => {
  it('builds fixed 42-cell Sunday-first month grids and shifts dates across boundaries', () => {
    expect(monthOf('2026-11-26')).toBe('2026-11')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftDay('2024-02-29', 1)).toBe('2024-03-01')

    const cells = monthCells('2026-11')
    expect(cells).toHaveLength(42)
    expect(cells[0]).toEqual({ day: '2026-11-01', inMonth: true })
    expect(cells[29]).toEqual({ day: '2026-11-30', inMonth: true })
    expect(cells[30]).toEqual({ day: '2026-12-01', inMonth: false })
    expect(weekdayLabels('zh')).toHaveLength(7)
  })

  it('formats Chinese lunar dates only for zh locales and marks the first lunar day', () => {
    expect(lunarLabel('en', '2026-11-26')).toBe('')
    expect(lunarInfo('zh', '2026-11-09')).toEqual({ text: '十月', isMonthStart: true })
    expect(lunarInfo('zh-CN', '2026-11-26')).toEqual({ text: '十八', isMonthStart: false })
  })
})

describe('daily notes preload channel isolation', () => {
  it('keeps workbench preload IPC channel constants aligned with shared DAILY_NOTES_CHANNELS', async () => {
    const { DAILY_NOTES_CHANNELS } = await import('@shared/daily-notes')
    const { DAILY_NOTES_WORKBENCH_IPC } = await import('../../../preload/daily-notes-workbench-channels')
    for (const [key, value] of Object.entries(DAILY_NOTES_WORKBENCH_IPC)) {
      expect(DAILY_NOTES_CHANNELS[key as keyof typeof DAILY_NOTES_WORKBENCH_IPC]).toBe(value)
    }
  })
})
