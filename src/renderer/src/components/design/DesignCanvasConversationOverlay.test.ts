import { createElement } from 'react'
import { create, act, type ReactTestRenderer as ReactTestRendererType } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DesignCanvasConversationOverlay } from './DesignCanvasConversationOverlay'
import type { DesignCanvasConversationOverlayConversationProps } from './DesignCanvasConversationOverlay'

const contentProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('./DesignConversationContent', () => ({
  DesignConversationContent: (props: Record<string, unknown>) => {
    contentProps.current = props
    return createElement('div')
  },
  DesignConversationHistoryHeader: () => createElement('div')
}))

const conversationBase = {
  input: '',
  setInput: () => {},
  mode: 'agent',
  setMode: () => {},
  busy: false,
  runtimeConnection: 'ready',
  activeThreadId: 'thread-1',
  blocks: [],
  liveReasoning: '',
  liveAssistant: '',
  composerModel: 'deepseek-chat',
  composerPickList: ['deepseek-chat'],
  composerReasoningEffort: 'auto',
  composerFastMode: false,
  setComposerModel: () => {},
  setComposerReasoningEffort: () => {},
  setComposerFastMode: () => {},
  queuedMessages: [],
  removeQueuedMessage: () => {},
  guideQueuedMessage: () => {},
  onSend: () => {},
  onInterrupt: () => {},
  onRetryConnection: () => {},
  onOpenSettings: () => {},
  designThreads: [],
  designHistoryThreadIds: [],
  onSwitchThread: () => {}
} satisfies Partial<DesignCanvasConversationOverlayConversationProps> as DesignCanvasConversationOverlayConversationProps

function render(props: Partial<Parameters<typeof DesignCanvasConversationOverlay>[0]> = {}) {
  const onNewConversation = vi.fn()
  let renderer: ReactTestRendererType | undefined
  act(() => {
    renderer = create(createElement(DesignCanvasConversationOverlay, {
      hostBounds: { width: 1400, height: 900 },
      workspaceRoot: '/ws',
      documentId: 'doc-1',
      drawingTitle: 'Drawing',
      running: false,
      conversation: conversationBase,
      onClearHistory: () => {},
      onNewConversation,
      ...props
    }))
  })
  const root = renderer!.root
  return { root, onNewConversation }
}

describe('DesignCanvasConversationOverlay', () => {
  const openPanel = (root: ReturnType<typeof render>['root']): void => {
    act(() => {
      root.findByProps({ 'aria-label': i18n.t('designCanvasConversationOpen') }).props.onClick()
    })
  }

  it('starts as a floating button, then opens and closes the panel', () => {
    const { root } = render()
    expect(root.findAllByProps({ 'data-design-canvas-conversation-panel': true }).length)
      .toBe(0)

    openPanel(root)
    expect(root.findAllByProps({ 'data-design-canvas-conversation-panel': true }).length)
      .toBe(1)

    act(() => {
      root.findByProps({ 'aria-label': i18n.t('designCanvasConversationClose') }).props.onClick()
    })
    expect(root.findAllByProps({ 'data-design-canvas-conversation-panel': true }).length)
      .toBe(0)
  })

  it('minimizes to the launcher and restores without losing the conversation', () => {
    const { root } = render()
    openPanel(root)
    act(() => {
      // The panel header carries the collapse control; the launcher now always
      // shows the open label, so the header button is the only collapse match.
      root.findAllByProps({ 'aria-label': i18n.t('designCanvasConversationCollapse') })[0].props.onClick()
    })
    expect(root.findAllByProps({ 'data-design-canvas-conversation-panel': true }).length)
      .toBe(0)
    openPanel(root)
    expect(root.findAllByProps({ 'data-design-canvas-conversation-panel': true }).length)
      .toBe(1)
  })

  it('resets the panel position from the header action', () => {
    const { root } = render()
    openPanel(root)
    const panelBefore = root.findByProps({ 'data-design-canvas-conversation-panel': true })
    const beforeLeft = (panelBefore.props.style as { left: number }).left
    act(() => {
      root.findByProps({ 'aria-label': i18n.t('designCanvasConversationResetPosition') }).props.onClick()
    })
    const panelAfter = root.findByProps({ 'data-design-canvas-conversation-panel': true })
    const afterLeft = (panelAfter.props.style as { left: number }).left
    expect(afterLeft).toBeGreaterThanOrEqual(24)
    expect(typeof beforeLeft).toBe('number')
  })

  it('does not interrupt the conversation when closing', () => {
    const onInterrupt = vi.fn()
    const { root } = render({
      conversation: { ...conversationBase, onInterrupt } as never
    })
    openPanel(root)
    act(() => {
      root.findByProps({ 'aria-label': i18n.t('designCanvasConversationClose') }).props.onClick()
    })
    expect(onInterrupt).not.toHaveBeenCalled()
  })

  it('requests a new conversation without touching history', () => {
    const onClearHistory = vi.fn()
    const { root, onNewConversation } = render({
      conversation: { ...conversationBase } as never,
      onClearHistory
    })
    openPanel(root)
    act(() => {
      root.findByProps({ 'aria-label': i18n.t('designCanvasConversationNew') }).props.onClick()
    })
    expect(onNewConversation).toHaveBeenCalledTimes(1)
    expect(onClearHistory).not.toHaveBeenCalled()
  })

  it('offsets the launcher by the window-controls safe area so it clears the titlebar', () => {
    const { root } = render()
    const launcher = root.findByProps({ 'aria-label': i18n.t('designCanvasConversationOpen') })
    const style = launcher.props.style as { top: string }
    expect(style.top).toContain('72px')
    expect(style.top).toContain('--ds-window-controls-safe-block')
  })

  it('mirrors the active conversation inside the floating panel', () => {
    const { root } = render()
    openPanel(root)
    expect(contentProps.current?.showActiveThreadConversation).toBe(true)
  })

  it('resizes the panel from the bottom-right grip', () => {
    const { root } = render()
    openPanel(root)
    const grip = root.findByProps({ 'data-design-canvas-conversation-resize-handle': true })
    const styleBefore = root
      .findByProps({ 'data-design-canvas-conversation-panel': true })
      .props.style as { width: number; height: number }
    act(() => {
      grip.props.onPointerDown({
        button: 0,
        pointerId: 7,
        clientX: 500,
        clientY: 500,
        preventDefault: () => {},
        stopPropagation: () => {},
        currentTarget: { setPointerCapture: () => {} }
      })
    })
    act(() => {
      grip.props.onPointerMove({
        pointerId: 7,
        clientX: 560,
        clientY: 460,
        preventDefault: () => {}
      })
    })
    const styleAfter = root
      .findByProps({ 'data-design-canvas-conversation-panel': true })
      .props.style as { width: number; height: number }
    expect(styleAfter.width).toBe(styleBefore.width + 60)
    expect(styleAfter.height).toBe(styleBefore.height - 40)
  })
})
