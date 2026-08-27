import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { ThreadRow } from './SidebarProjectRows'
import {
  prioritizeSidebarThreadActivity,
  sidebarThreadActivity
} from './sidebar-project-selectors'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

function thread(id: string): NormalizedThread {
  return {
    id, title: id, workspace: '/tmp/app', model: 'model', mode: 'agent',
    updatedAt: '2026-08-20T00:00:00.000Z'
  }
}

describe('sidebar thread activity indicators', () => {
  it('uses running, failed, completed, scheduled, then read activity priority', () => {
    const items = ['read', 'scheduled', 'completed', 'failed', 'running'].map(thread)
    const context = {
      activeThreadId: null,
      busy: false,
      watchTurnCompletion: { running: true },
      unreadThreadIds: { completed: 'completed' as const, failed: 'failed' as const },
      scheduledThreadActivities: {
        scheduled: { state: 'scheduled' as const, taskCount: 1, nextRunAt: '2099-01-01T00:00:00.000Z', queued: false }
      }
    }

    expect(prioritizeSidebarThreadActivity(items, context).map((item) => item.id)).toEqual([
      'read', 'scheduled', 'completed', 'failed', 'running'
    ])
    expect(sidebarThreadActivity(items[1]!, context)).toBe('scheduled')
  })

  it('renders distinct failed and scheduled indicators with accessible labels', () => {
    const noOp = vi.fn()
    const base = {
      thread: thread('indicator'), active: false, deleting: false, locale: 'en-US',
      showRunning: false, showUnread: false, onSelect: noOp, onContextMenu: noOp,
      onPreviewOpen: noOp, onPreviewClose: noOp, onPin: noOp, onRename: noOp,
      onArchive: noOp, onDelete: noOp, onRestore: noOp
    }
    const failed = renderToStaticMarkup(createElement(ThreadRow, { ...base, showFailed: true }))
    const scheduled = renderToStaticMarkup(createElement(ThreadRow, {
      ...base,
      scheduledActivity: {
        state: 'scheduled', taskCount: 1, nextRunAt: '2099-01-01T00:00:00.000Z', queued: false
      }
    }))

    expect(failed).toContain('aria-label="sidebarThreadFailed"')
    expect(scheduled).toContain('aria-label="sidebarThreadScheduled"')
  })
})
