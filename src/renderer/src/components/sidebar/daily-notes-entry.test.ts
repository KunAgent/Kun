/** @vitest-environment jsdom */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../chat/Sidebar'
import { WriteSidebar } from '../write/WriteSidebar'
import i18n from '../../i18n'

const noop = vi.fn()
const sharedProps = {
  connectPhoneSidebarOpen: false, focusModeEnabled: false,
  onCodeOpen: noop, onWriteOpen: noop, onFocusModeChange: noop,
  onOpenSettings: noop, onToggleConnectPhone: noop, onToggleTheme: noop
}
function codeSidebar() {
  return createElement(Sidebar, {
    ...sharedProps, activeView: 'chat', threads: [], activeThreadId: null,
    connectPhoneInitialTarget: 'feishu', pluginsActive: false, extensionsActive: false, runtimeReady: false,
    threadSearch: '', showArchivedThreads: false, onThreadSearchChange: noop, onSelectThread: noop,
    onRenameThread: noop, onPinThread: noop, onArchiveThread: noop, onDeleteThread: noop,
    onRestoreThread: noop, onNewChat: noop, onNewChatInWorkspace: noop,
    onOpenPlugins: noop, onOpenExtensions: noop, onScheduleOpen: noop, onWorkflowOpen: noop,
    onNewConversation: noop
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('daily notes entry', () => {
  it('is available in both Code and Work with no project or connected runtime', async () => {
    await i18n.changeLanguage('zh')
    vi.stubGlobal('kunGui', { openDailyNotes: noop })
    for (const sidebar of [codeSidebar(), createElement(WriteSidebar, { ...sharedProps, activeView: 'write' })]) {
      const host = document.createElement('div')
      host.innerHTML = renderToStaticMarkup(sidebar)
      const buttons = [...host.querySelectorAll('button')].filter(button => button.textContent === '每日待办与笔记')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].disabled).toBe(false)
    }
  })

  it('keeps the native window action off remote browser clients', () => {
    vi.stubGlobal('kunGui', { openDailyNotes: noop, isRemoteWeb: true })
    expect(renderToStaticMarkup(codeSidebar())).not.toContain(i18n.t('dailyNotes.title'))
  })
})
