/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyNotesApi } from '@shared/daily-notes'
import { DailyNotesView } from './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createMemoryApi(initialFiles: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(initialFiles))
  const started: Array<{ prompt: string; title: string; workspaceRoot: string | null }> = []
  const docked: Array<{ day?: string; viewMode?: string }> = []

  const api: DailyNotesApi = {
    context: async () => ({ locale: 'zh', theme: 'light', pinned: true, canPin: true }),
    listDays: async () => [...files.keys()].sort().reverse(),
    read: async day => files.get(day) ?? '',
    save: async (day, markdown) => { files.set(day, markdown) },
    setPinned: async enabled => enabled,
    onCloseRequest: () => () => undefined,
    rollover: async () => ({ movedCount: 0, fromMarkdown: '', toMarkdown: '' }),
    sendToKun: async () => ({ ok: true, roomId: 'room-1', messageId: 'm-1', agentLabel: '小Kun' }),
    startThread: async request => {
      started.push(request)
      return { ok: true, threadId: 'thr-new-7', title: 'KunRepo' }
    },
    listTargets: async () => ({
      activeWorkspaceRoot: '/repo/KunRepo',
      projects: [{ root: '/repo/KunRepo', label: 'KunRepo' }],
      threads: [{
        id: 'thr-dragged-9',
        title: '排查内存泄漏',
        workspaceRoot: '/repo/KunRepo',
        workspaceLabel: 'KunRepo',
        status: 'running'
      }]
    }),
    dockToWorkbench: async payload => {
      docked.push(payload ?? {})
      return true
    },
    openLink: async () => true,
    watchLinks: async urls => Object.fromEntries(urls.map(url => [url, {
      url,
      tone: 'running' as const,
      statusText: '运行中 · KunRepo'
    }]))
  }

  return { api, files, started, docked }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 15))
  })
}

describe('DailyNotesView outliner, focus drill-down, day stream, direct session, and dock', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    vi.restoreAllMocks()
  })

  it('renders continuous day stream, drills into Focus View, launches direct session, and docks to workbench', async () => {
    const today = '2026-11-27'
    const yesterday = '2026-11-26'
    const { api, files, started, docked } = createMemoryApi({
      [today]: '- [ ] 重构大纲组件 !1\n  - 保留纯 Markdown 存储',
      [yesterday]: '- [x] 完成调研纪要 !2'
    })

    await act(async () => {
      root.render(createElement(DailyNotesView, { api, targetDay: today }))
    })
    await flush()
    await flush()

    // Continuous historical day stream renders yesterday below today.
    const streamSection = host.querySelector(`[data-stream-day="${yesterday}"]`)
    expect(streamSection).not.toBeNull()
    expect(streamSection?.textContent).toContain('完成调研纪要')

    // Task with sub-notes renders a ringed bullet dot; clicking it enters Focus View.
    const ringedDot = host.querySelector<HTMLButtonElement>('.note-bullet-dot.is-ringed')
    expect(ringedDot).not.toBeNull()
    await act(async () => {
      ringedDot!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await flush()

    expect(host.querySelector('.note-page.is-focus-view')).not.toBeNull()
    const titleInput = host.querySelector<HTMLInputElement>('.note-focus-title-input')
    expect(titleInput?.value).toBe('重构大纲组件')

    // Direct Start Session from Focus View pre-fills task + indented sub-note and binds kun://thread.
    const startBtn = host.querySelector<HTMLButtonElement>('[aria-label="重构大纲组件: 直接启动会话"]')
    expect(startBtn).not.toBeNull()
    await act(async () => { startBtn!.click() })
    await flush()

    const dialog = host.querySelector('[role="dialog"][aria-label="从待办直接启动会话"]')
    expect(dialog).not.toBeNull()
    const launchBtn = Array.from(dialog!.querySelectorAll('button')).find(b => b.textContent?.includes('启动会话'))
    await act(async () => { launchBtn!.click() })
    await flush()

    expect(started).toHaveLength(1)
    expect(started[0].prompt).toContain('重构大纲组件')
    expect(started[0].prompt).toContain('保留纯 Markdown 存储')
    expect(files.get(today)).toContain('[KunRepo](kun://thread/thr-new-7)')

    // Status pill more-actions menu supports unlinking the bound session.
    const moreBtn = host.querySelector<HTMLButtonElement>('[aria-label="重构大纲组件: 更多操作"]')
    expect(moreBtn).not.toBeNull()
    await act(async () => { moreBtn!.click() })
    const unlinkItem = Array.from(host.querySelectorAll('[role="menuitem"]')).find(b => b.textContent?.includes('解除关联')) as HTMLButtonElement
    await act(async () => { unlinkItem.click() })
    await flush()
    expect(files.get(today)).not.toContain('kun://thread/thr-new-7')

    // Breadcrumb returns from Focus View back to day stream.
    const backCrumb = host.querySelector<HTMLButtonElement>('.note-crumb-back')
    await act(async () => { backCrumb!.click() })
    await flush()
    expect(host.querySelector('.note-page.is-focus-view')).toBeNull()

    // Dock-to-workbench forwards current day & viewMode.
    const dockBtn = host.querySelector<HTMLButtonElement>('[aria-label="停靠到主窗口侧边"]')
    await act(async () => { dockBtn!.click() })
    await flush()
    expect(docked).toEqual([{ day: today, viewMode: 'page' }])
  })

  it('renders docked surface controls and accepts dragged sidebar threads', async () => {
    const today = '2026-11-27'
    const { api, files } = createMemoryApi({ [today]: '' })
    const onPopout = vi.fn()
    const onCloseDocked = vi.fn()

    await act(async () => {
      root.render(createElement(DailyNotesView, {
        api,
        surface: 'docked',
        targetDay: today,
        onPopout,
        onCloseDocked
      }))
    })
    await flush()

    const container = host.querySelector('.daily-notes.is-docked')!
    expect(container).not.toBeNull()

    // Drop a sidebar conversation onto the docked notes panel.
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        types: ['application/x-kun-thread-id'],
        getData: (type: string) => (type === 'application/x-kun-thread-id' ? 'thr-dragged-9' : '')
      }
    })
    await act(async () => { container.dispatchEvent(dropEvent) })
    await flush()
    expect(files.get(today)).toBe('- [ ] 排查内存泄漏 [排查内存泄漏](kun://thread/thr-dragged-9)')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="弹出为独立小窗"]')!.click()
      host.querySelector<HTMLButtonElement>('[aria-label="收起分栏"]')!.click()
    })
    expect(onPopout).toHaveBeenCalledOnce()
    expect(onCloseDocked).toHaveBeenCalledOnce()
  })
})
