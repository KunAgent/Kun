// @vitest-environment jsdom
import { createElement } from 'react'
import { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountTracker } from '../workers/worker-test-fixtures'
import { openWorkerSession } from '../workers/worker-view-store'
import { useActivityStore } from '../../store/activity-store'
import { workerSessionTabId } from '../../extensions/contribution-ids'
import { openCodeRightTab, emptyCodeRightTabsState } from './code-right-tabs-state'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { resolveCodeRightToolClick, useWorkbenchRightTools } from './useWorkbenchRightTools'

const { render, unmountAll } = mountTracker()
afterEach(unmountAll)

function toolsProps() {
  return {
    input: '', inputRef: { current: '' }, prevThreadId: { current: 'manager' },
    activeThreadId: 'manager', activeGuiPlan: null, rightPanelMode: null,
    sidePanel: { open: false }, currentSideConversations: [],
    designWorkspaceRoot: '', workspaceRoot: '', fileTreeWorkspaceRoot: '', filePreviewTarget: null,
    codeRightTabs: { expanded: true, tabs: [BUILTIN_RIGHT_PANEL_IDS.workers, workerSessionTabId('history')] },
    openSideConversationDraft: vi.fn(), selectSideConversation: vi.fn(), setSidePanelOpen: vi.fn(),
    openFileTreeSidePanel: vi.fn(), openDesignFileTreeSidePanel: vi.fn(),
    openRightPanelTab: vi.fn(), closeRightPanelTab: vi.fn(), toggleTerminal: vi.fn(),
    collapseRightPanel: vi.fn(), expandRightPanel: vi.fn()
  }
}

function Harness(props: ReturnType<typeof toolsProps>) {
  useWorkbenchRightTools(props)
  return null
}

describe('collaboration navigation', () => {
  it('focuses the requested worker without duplicating a tab on repeated clicks', async () => {
    const props = toolsProps()
    let state = emptyCodeRightTabsState()
    props.openRightPanelTab.mockImplementation((id) => { state = openCodeRightTab(state, id) })
    await render(createElement(Harness, props))
    await act(async () => { openWorkerSession('history'); openWorkerSession('history') })
    expect(state.tabs).toEqual([workerSessionTabId('history')])
    expect(state.activeId).toBe(workerSessionTabId('history'))
    expect(state.expanded).toBe(true)
  })

  it('closes only worker tabs on manager change, not the collaboration list', async () => {
    const props = toolsProps()
    const renderer = await render(createElement(Harness, props))
    await act(async () => renderer.update(createElement(Harness, { ...props, activeThreadId: 'other' })))
    expect(props.closeRightPanelTab.mock.calls).toEqual([[workerSessionTabId('history')]])
  })
  it('keeps collaboration and historical worker tabs open without live activity', async () => {
    useActivityStore.setState({ rows: {} })
    const props = toolsProps()
    await render(createElement(Harness, props))
    expect(props.closeRightPanelTab).not.toHaveBeenCalled()
    await act(async () => openWorkerSession('history'))
    expect(props.openRightPanelTab).toHaveBeenCalledWith(workerSessionTabId('history'))
    expect(props.closeRightPanelTab).not.toHaveBeenCalled()
  })
})

describe('resolveCodeRightToolClick', () => {
  it('collapses the panel when the clicked tool is already visible', () => {
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas
    )).toBe('collapse')
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.changes,
      BUILTIN_RIGHT_PANEL_IDS.changes
    )).toBe('collapse')
  })

  it('opens the tool when another tool or no tool is visible', () => {
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      BUILTIN_RIGHT_PANEL_IDS.changes
    )).toBe('open')
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      null
    )).toBe('open')
  })

  it('keeps the terminal on its own toggle path', () => {
    expect(resolveCodeRightToolClick(BUILTIN_RIGHT_PANEL_IDS.terminal, null)).toBe('toggle-terminal')
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.terminal,
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas
    )).toBe('toggle-terminal')
  })

  it('collapses an active extension right-rail view', () => {
    const extensionId = 'extension:example/right-panel' as const
    expect(resolveCodeRightToolClick(extensionId, extensionId)).toBe('collapse')
  })
})
