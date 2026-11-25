import { describe, expect, it, vi } from 'vitest'
import { buildTrayMenuTemplate, parseTrayThreads, type TrayThreadSummary } from './tray-session-menu'

describe('tray session menu', () => {
  it('parses and sorts active thread summaries', () => {
    expect(parseTrayThreads(JSON.stringify({ threads: [
      thread('old', 'idle', '2026-06-01T00:00:00.000Z'),
      thread('deleted', 'deleted', '2026-06-03T00:00:00.000Z'),
      thread('new', 'running', '2026-06-02T00:00:00.000Z')
    ] })).map((item) => item.id)).toEqual(['new', 'old'])
    expect(parseTrayThreads('not json')).toEqual([])
  })

  it('groups running and recent threads with project labels', () => {
    const actions = fakeActions()
    const menu = buildTrayMenuTemplate({
      locale: 'en',
      threads: [
        thread('run', 'running', '2026-06-02T00:00:00.000Z', 'Fix tests', 'C:\\work\\Kun'),
        thread('recent', 'idle', '2026-06-01T00:00:00.000Z', 'Review PR', '/work/Docs')
      ],
      actions
    })

    expect(menu.map((item) => item.label).filter(Boolean)).toEqual([
      'Running', 'Fix tests', 'Recent', 'Review PR', 'New Chat', 'Daily notes & to-dos', 'Open Kun', 'Exit'
    ])
    expect(menu.find((item) => item.label === 'Fix tests')?.sublabel).toBe('Kun')
    expect(menu.find((item) => item.label === 'Review PR')?.sublabel).toBe('Docs')
    menu.find((item) => item.label === 'Fix tests')?.click?.({} as never, undefined, {} as never)
    expect(actions.openThread).toHaveBeenCalledWith('run')
  })

  it('moves overflow sessions into More and localizes actions', () => {
    const actions = fakeActions()
    const threads = Array.from({ length: 7 }, (_, index) =>
      thread(`thread-${index}`, 'idle', `2026-06-${String(10 - index).padStart(2, '0')}T00:00:00.000Z`)
    )
    const menu = buildTrayMenuTemplate({ locale: 'zh', threads, actions })
    const more = menu.find((item) => item.label === '更多')

    expect(Array.isArray(more?.submenu) ? more.submenu : []).toHaveLength(2)
    expect(menu.map((item) => item.label).filter(Boolean)).toEqual([
      '最近会话',
      'thread-0',
      'thread-1',
      'thread-2',
      'thread-3',
      'thread-4',
      '更多',
      '新建会话',
      '每日待办与笔记',
      '打开 Kun',
      '退出'
    ])
    menu.find(item => item.label === '每日待办与笔记')?.click?.({} as never, undefined, {} as never)
    expect(actions.openDailyNotes).toHaveBeenCalledOnce()
  })
})

function thread(
  id: string,
  status: string,
  updatedAt: string,
  title = id,
  workspace = '/work/project'
): TrayThreadSummary {
  return { id, title, workspace, status, updatedAt }
}

function fakeActions() {
  return {
    openThread: vi.fn(),
    newChat: vi.fn(),
    openDailyNotes: vi.fn(),
    openApp: vi.fn(),
    quit: vi.fn()
  }
}
