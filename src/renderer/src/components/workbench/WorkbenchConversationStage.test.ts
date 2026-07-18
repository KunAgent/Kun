import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { WorkbenchConversationStage } from './WorkbenchConversationStage'
import type { WorkbenchChatStageProps } from './WorkbenchChatStage'

vi.mock('./WorkbenchChatStage', () => ({
  WorkbenchChatStage: () => createElement('section', { 'data-chat-stage': true })
}))

describe('WorkbenchConversationStage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps the Code icon rail mounted and routes its launcher through the tab callback', () => {
    const onToggleRightPanelMode = vi.fn()
    let renderer: ReactTestRenderer

    act(() => {
      renderer = create(createElement(WorkbenchConversationStage, {
        route: 'chat',
        runtimeBanner: null,
        activeSddDraft: false,
        sdd: {} as never,
        chat: {} as WorkbenchChatStageProps,
        rightPanel: createElement('aside', { 'data-right-workspace': true }),
        sideRail: {
          rightPanelMode: null,
          onToggleRightPanelMode,
          planPanelEnabled: false,
          canvasEnabled: true,
          sideChatEnabled: true,
          fileTreeEnabled: true
        }
      }))
    })

    const previewButton = renderer!.root.findByProps({ 'aria-label': 'Preview' })
    act(() => previewButton.props.onClick())
    expect(onToggleRightPanelMode).toHaveBeenCalledWith(BUILTIN_RIGHT_PANEL_IDS.browser)
    expect(renderer!.root.findByProps({ 'data-right-workspace': true })).toBeTruthy()
    act(() => renderer!.unmount())
  })
})
