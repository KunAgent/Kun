import { createElement } from 'react'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposer } from '../chat/FloatingComposer'
import { SubagentReturnBar } from '../chat/message-timeline-empty'
import { SddAssistantPanel } from './SddAssistantPanel'

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === 'string' ? child : textContent(child))
    .join('')
}

describe('SddAssistantPanel structured user input', () => {
  const originalResolveUserInput = useChatStore.getState().resolveUserInput
  const originalSelectThread = useChatStore.getState().selectThread

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    ;(globalThis as { window?: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setInterval,
      clearInterval,
      innerHeight: 900,
      innerWidth: 1400,
      kunGui: {
        platform: 'darwin',
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{"sessions":[]}' }))
      }
    }
  })

  afterEach(() => {
    useChatStore.setState({
      activeThreadRelation: null,
      activeThreadParentId: null,
      resolveUserInput: originalResolveUserInput,
      selectThread: originalSelectThread
    })
  })

  it('renders and submits the live request above the compact composer', async () => {
    const resolveUserInput = vi.fn(async () => undefined)
    const blocks: ChatBlock[] = [{
      kind: 'user_input',
      id: 'sdd-input-item',
      requestId: 'sdd-input-request',
      status: 'pending',
      live: true,
      questions: [{
        id: 'lifecycle',
        header: 'Lifecycle',
        question: 'How long should the CLI details be kept?',
        options: [
          { label: 'Current turn', description: 'Use them once.' },
          { label: 'Whole session', description: 'Keep them for later turns.' }
        ]
      }]
    }]
    useChatStore.setState({
      activeThreadId: 'sdd-thread',
      route: 'chat',
      blocks,
      resolveUserInput
    })

    let renderer: ReactTestRenderer | undefined
    let clock: { mockRestore: () => void } | undefined
    try {
      await act(async () => {
        renderer = create(createElement(SddAssistantPanel, {
          draft: {
            id: 'draft-1',
            workspaceRoot: '/workspace',
            relativePath: '.kunsdd/requirements/draft-1/requirement.md',
            createdAt: '2026-07-30T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z'
          },
          input: '',
          setInput: vi.fn(),
          mode: 'agent',
          setMode: vi.fn(),
          busy: true,
          runtimeConnection: 'ready',
          activeThreadId: 'sdd-thread',
          blocks,
          liveReasoning: '',
          liveAssistant: '',
          composerModel: 'gpt-5.6',
          composerProviderId: 'codex',
          composerPickList: ['gpt-5.6'],
          composerReasoningEffort: 'low',
          composerFastMode: false,
          setComposerModel: vi.fn(),
          setComposerReasoningEffort: vi.fn(),
          setComposerFastMode: vi.fn(),
          queuedMessages: [],
          removeQueuedMessage: vi.fn(),
          guideQueuedMessage: vi.fn(),
          onSend: vi.fn(),
          onInterrupt: vi.fn(),
          onRetryConnection: vi.fn(),
          onOpenSettings: vi.fn(),
          onNewConversation: vi.fn(),
          onApplyFramework: vi.fn(),
          onCollapse: vi.fn()
        }))
      })

      expect(renderer!.root.findByProps({
        'data-user-input-variant': 'compact'
      })).toBeDefined()

      // The ask card ignores clicks for a moment after it appears (arming).
      clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1_000)
      const option = renderer!.root.findAllByType('button').find((button) =>
        button.props.role === 'option' && textContent(button).includes('Current turn')
      )
      expect(option).toBeDefined()
      await act(async () => {
        option!.props.onClick({ preventDefault: vi.fn() })
      })

      const submit = renderer!.root.findAllByType('button').find((button) =>
        button.props['data-user-input-primary'] === 'submit'
      )
      expect(submit).toBeDefined()
      expect(textContent(submit!)).toBe('Submit')
      await act(async () => {
        submit!.props.onClick({ preventDefault: vi.fn() })
      })

      expect(resolveUserInput).toHaveBeenCalledWith('sdd-input-item', {
        kind: 'submit',
        answers: [{ id: 'lifecycle', label: 'Current turn', value: 'Current turn' }]
      })
    } finally {
      clock?.mockRestore()
      if (renderer) {
        act(() => renderer!.unmount())
      }
    }
  })

  it('replaces the composer with a route back to the Requirement AI parent thread', async () => {
    const selectThread = vi.fn(async () => undefined)
    useChatStore.setState({
      activeThreadId: 'sdd-child-thread',
      activeThreadRelation: 'side',
      activeThreadParentId: 'sdd-parent-thread',
      threads: [{
        id: 'sdd-parent-thread',
        title: 'Requirement AI parent',
        updatedAt: '2026-07-30T00:00:00.000Z',
        model: 'gpt-5.6',
        mode: 'agent',
        status: 'idle'
      }],
      selectThread
    })

    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(createElement(SddAssistantPanel, {
          draft: {
            id: 'draft-1',
            workspaceRoot: '/workspace',
            relativePath: '.kunsdd/requirements/draft-1/requirement.md',
            createdAt: '2026-07-30T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z'
          },
          input: '',
          setInput: vi.fn(),
          mode: 'agent',
          setMode: vi.fn(),
          busy: false,
          runtimeConnection: 'ready',
          activeThreadId: 'sdd-child-thread',
          blocks: [],
          liveReasoning: '',
          liveAssistant: '',
          composerModel: 'gpt-5.6',
          composerProviderId: 'codex',
          composerPickList: ['gpt-5.6'],
          composerReasoningEffort: 'low',
          composerFastMode: false,
          setComposerModel: vi.fn(),
          setComposerReasoningEffort: vi.fn(),
          setComposerFastMode: vi.fn(),
          queuedMessages: [],
          removeQueuedMessage: vi.fn(),
          guideQueuedMessage: vi.fn(),
          onSend: vi.fn(),
          onInterrupt: vi.fn(),
          onRetryConnection: vi.fn(),
          onOpenSettings: vi.fn(),
          onNewConversation: vi.fn(),
          onApplyFramework: vi.fn(),
          onCollapse: vi.fn()
        }))
      })

      expect(renderer!.root.findAllByType(FloatingComposer)).toHaveLength(0)
      const returnBar = renderer!.root.findByType(SubagentReturnBar)
      expect(returnBar.props.parentTitle).toBe('Requirement AI parent')
      expect(textContent(returnBar)).toContain('Back to main chat')

      await act(async () => {
        returnBar.props.onBack()
        await Promise.resolve()
      })

      expect(selectThread).toHaveBeenCalledWith('sdd-parent-thread')
    } finally {
      if (renderer) act(() => renderer!.unmount())
    }
  })
})
