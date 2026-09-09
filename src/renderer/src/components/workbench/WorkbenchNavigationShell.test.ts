import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../chat/Sidebar', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    Sidebar: ({ activeView }: { activeView: string }) => createMockElement('aside', {
      'data-testid': 'code-sidebar',
      'data-active-view': activeView
    })
  }
})

vi.mock('../write/WriteSidebar', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    WriteSidebar: ({
      focusModeEnabled,
      onFocusModeChange
    }: {
      focusModeEnabled: boolean
      onFocusModeChange: (enabled: boolean) => void
    }) => createMockElement('aside', {
      'data-testid': 'write-sidebar',
      'data-focus-mode': focusModeEnabled ? 'on' : 'off',
      'data-has-focus-handler': typeof onFocusModeChange === 'function' ? 'true' : 'false'
    })
  }
})

vi.mock('../../extensions/ControlledContributionSurfaces', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    ExtensionViewOutlet: () => createMockElement('aside', {
      'data-testid': 'extension-sidebar'
    })
  }
})

vi.mock('./WorkbenchConversationStage', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    WorkbenchConversationStage: ({ route }: { route: string }) => createMockElement('section', {
      'data-testid': 'conversation-stage',
      'data-route': route
    })
  }
})

import { WorkbenchLeftSidebar } from './WorkbenchLeftSidebar'
import { WorkbenchStageRouter } from './WorkbenchStageRouter'

const noop = (): void => undefined
const asyncNoop = async (): Promise<void> => undefined

describe('legacy Design workbench navigation', () => {
  it('forwards the global focus preference to the Work sidebar', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchLeftSidebar, {
      collapsed: false,
      width: 280,
      route: 'write',
      codeThreads: [],
      activeThreadId: null,
      sidebarView: 'chat',
      connectPhoneSidebarOpen: false,
      extensionsActive: false,
      runtimeReady: true,
      threadSearch: '',
      showArchivedThreads: false,
      focusModeEnabled: true,
      onFocusModeChange: noop,
      onThreadSearchChange: noop,
      onSelectThread: noop,
      onRenameThread: asyncNoop,
      onPinThread: asyncNoop,
      onArchiveThread: asyncNoop,
      onDeleteThread: asyncNoop,
      onRestoreThread: asyncNoop,
      onNewChat: noop,
      onNewChatInWorkspace: async () => null,
      onOpenSettings: noop,
      onOpenPlugins: noop,
      onOpenExtensions: noop,
      onToggleTheme: noop,
      onToggleConnectPhone: noop,
      onCodeOpen: noop,
      onWriteOpen: noop,
      onScheduleOpen: noop,
      onWorkflowOpen: noop,
      onNodeGraphOpen: noop,
      onNewConversation: noop,
      onBeginResize: noop
    }))

    expect(html).toContain('data-testid="write-sidebar"')
    expect(html).toContain('data-focus-mode="on"')
    expect(html).toContain('data-has-focus-handler="true"')
  })

  it('renders the Code sidebar for the legacy Design route', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchLeftSidebar, {
      collapsed: false,
      width: 280,
      route: 'design',
      codeThreads: [],
      activeThreadId: null,
      sidebarView: 'chat',
      connectPhoneSidebarOpen: false,
      extensionsActive: false,
      runtimeReady: true,
      threadSearch: '',
      showArchivedThreads: false,
      focusModeEnabled: false,
      onFocusModeChange: noop,
      onThreadSearchChange: noop,
      onSelectThread: noop,
      onRenameThread: asyncNoop,
      onPinThread: asyncNoop,
      onArchiveThread: asyncNoop,
      onDeleteThread: asyncNoop,
      onRestoreThread: asyncNoop,
      onNewChat: noop,
      onNewChatInWorkspace: async () => null,
      onOpenSettings: noop,
      onOpenPlugins: noop,
      onOpenExtensions: noop,
      onToggleTheme: noop,
      onToggleConnectPhone: noop,
      onCodeOpen: noop,
      onWriteOpen: noop,
      onScheduleOpen: noop,
      onWorkflowOpen: noop,
      onNodeGraphOpen: noop,
      onNewConversation: noop,
      onBeginResize: noop
    }))

    expect(html).toContain('data-testid="code-sidebar"')
    expect(html).not.toContain('data-testid="write-sidebar"')
  })

  it('renders the Code conversation stage for the legacy Design route', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchStageRouter, {
      route: 'design',
      leftSidebarCollapsed: false,
      onToggleLeftSidebar: noop,
      onOpenThread: noop,
      write: {
        runtimeBanner: null,
        leftSidebarCollapsed: false,
        onToggleLeftSidebar: noop,
        input: '',
        setInput: noop,
        rightPanel: null
      },
      conversation: {
        route: 'design',
        runtimeBanner: null,
        activeSddDraft: false,
        sdd: {} as never,
        chat: {} as never,
        rightPanel: null,
        sideRail: {} as never
      },
      imageAnnotationHost: null,
      planOverlay: null,
      extensions: {
        workspaceRoot: '',
        onOpenIntegrations: noop,
        onOpenView: asyncNoop
      },
      nodeGraph: { workspaceRoot: '' }
    }))

    expect(html).toContain('data-testid="conversation-stage"')
    expect(html).toContain('data-route="chat"')
    expect(html).not.toContain('data-route="design"')
  })
})
