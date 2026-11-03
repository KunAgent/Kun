import { describe, expect, it } from 'vitest'
import {
  hiddenScheduledTaskThreadCount,
  isScheduledTaskThread,
  withoutScheduledTaskThreads
} from './scheduled-task-threads'

function thread(id: string, title: string, archived = false) {
  return { id, title, archived }
}

describe('isScheduledTaskThread', () => {
  it('matches the titles the schedule runtime writes', () => {
    expect(isScheduledTaskThread(thread('a', '[Scheduled task] 每日A股'))).toBe(true)
    expect(isScheduledTaskThread(thread('b', '  [Scheduled task] Task'))).toBe(true)
    expect(isScheduledTaskThread(thread('c', '[Scheduled task]'))).toBe(true)
  })

  it('leaves user sessions alone', () => {
    expect(isScheduledTaskThread(thread('d', '检查定时任务'))).toBe(false)
    expect(isScheduledTaskThread(thread('e', 'scheduled task review'))).toBe(false)
  })
})

describe('withoutScheduledTaskThreads', () => {
  const threads = [
    thread('user', '整理发布说明'),
    thread('run1', '[Scheduled task] 每日A股'),
    thread('run2', '[Scheduled task] 巡检')
  ]

  it('drops scheduled run sessions from a project list', () => {
    expect(withoutScheduledTaskThreads(threads).map((item) => item.id)).toEqual(['user'])
  })

  it('keeps the session the user has open', () => {
    expect(withoutScheduledTaskThreads(threads, { keepThreadId: 'run2' }).map((item) => item.id))
      .toEqual(['user', 'run2'])
  })

  it('reveals them for an explicit search', () => {
    expect(withoutScheduledTaskThreads(threads, { revealAll: true })).toHaveLength(3)
  })
})

describe('hiddenScheduledTaskThreadCount', () => {
  it('counts the sessions the sidebar is holding back', () => {
    expect(hiddenScheduledTaskThreadCount([
      thread('user', '整理发布说明'),
      thread('run1', '[Scheduled task] 每日A股'),
      thread('run2', '[Scheduled task] 巡检')
    ])).toBe(2)
  })

  it('ignores archived sessions unless archived rows are shown', () => {
    const threads = [thread('run1', '[Scheduled task] 每日A股', true)]
    expect(hiddenScheduledTaskThreadCount(threads)).toBe(0)
    expect(hiddenScheduledTaskThreadCount(threads, { showArchived: true })).toBe(1)
  })

  it('reports nothing while a search reveals every session', () => {
    expect(hiddenScheduledTaskThreadCount(
      [thread('run1', '[Scheduled task] 每日A股')],
      { searching: true }
    )).toBe(0)
  })
})
