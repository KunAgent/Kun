import { createElement, type ComponentProps } from 'react'
import {
  act,
  create,
  type ReactTestRenderer
} from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { FloatingComposer } from '../chat/FloatingComposer'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { SubagentReturnBar } from '../chat/message-timeline-empty'
import { WriteAssistantPanel } from './WriteAssistantPanel'

const provider = vi.hoisted(() => ({
  getThreadDetail: vi.fn(),
  getAttachmentContent: vi.fn()
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

type PanelProps = ComponentProps<typeof WriteAssistantPanel>

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    input: '',
    setInput: vi.fn(),
    mode: 'agent',
    setMode: vi.fn(),
    busy: true,
    runtimeConnection: 'ready',
    activeThreadId: 'write-parent',
    blocks: [{ kind: 'assistant', id: 'parent-answer', text: 'Parent transcript' }],
    liveReasoning: '',
    liveAssistant: '',
    composerModel: 'gpt-5.6',
    composerPickList: ['gpt-5.6'],
    composerReasoningEffort: 'high',
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
    onPickWorkspace: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides
  }
}

function timelineNodeMock() {
  return {
    style: {},
    closest: vi.fn(() => null),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    scrollIntoView: vi.fn(),
    scrollBy: vi.fn(),
    scrollHeight: 900,
    scrollTop: 0,
    clientHeight: 900,
    clientWidth: 640,
    scrollWidth: 640
  }
}

describe('WriteAssistantPanel subagent session', () => {
  const originalSelectThread = useChatStore.getState().selectThread

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    provider.getThreadDetail.mockReset()
    provider.getAttachmentContent.mockReset()
    useChatStore.setState({
      activeThreadId: 'write-parent',
      activeThreadRelation: 'primary',
      activeThreadParentId: null,
      route: 'write',
      workspaceRoot: '/workspace',
      threads: [],
      selectThread: vi.fn(async () => undefined)
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/doc.pptx',
      quotedSelections: []
    })
    ;(globalThis as { window?: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setTimeout,
      clearTimeout,
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
    useChatStore.setState({ selectThread: originalSelectThread })
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('opens the child transcript locally and returns without replacing the Work parent thread', async () => {
    const childBlocks: ChatBlock[] = [
      { kind: 'user', id: 'child-user', text: 'Summarize the presentation' },
      {
        kind: 'tool',
        id: 'child-image-tool',
        summary: 'generate_image',
        status: 'success',
        meta: {
          toolName: 'generate_image',
          generatedFiles: [{
            name: 'work-child.png',
            relativePath: '.kun/images/work-child.png',
            mimeType: 'image/png'
          }],
          attachments: [{
            id: 'att_work_child',
            name: 'work-child.png',
            mimeType: 'image/png'
          }]
        }
      },
      { kind: 'assistant', id: 'child-answer', text: 'Child transcript' }
    ]
    provider.getThreadDetail.mockResolvedValue({
      blocks: childBlocks,
      latestSeq: 4,
      threadStatus: 'idle',
      relation: 'side',
      parentThreadId: 'write-parent'
    })
    provider.getAttachmentContent.mockResolvedValue({
      attachment: {
        id: 'att_work_child',
        kind: 'image',
        name: 'work-child.png',
        mimeType: 'image/png'
      },
      dataBase64: 'Y2hpbGQ='
    })

    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(createElement(WriteAssistantPanel, panelProps()), {
          createNodeMock: timelineNodeMock
        })
      })

      const parentTimeline = renderer!.root.findByType(LazyMessageTimeline)
      expect(parentTimeline.props.activeThreadId).toBe('write-parent')
      expect(parentTimeline.props.onOpenChildThread).toBeTypeOf('function')

      await act(async () => {
        parentTimeline.props.onOpenChildThread('write-child')
        await Promise.resolve()
      })
      await vi.waitFor(() => {
        expect(provider.getThreadDetail).toHaveBeenCalledWith('write-child')
        expect(renderer!.root.findByType(LazyMessageTimeline).props.activeThreadId).toBe('write-child')
      })

      const childTimeline = renderer!.root.findByType(LazyMessageTimeline)
      expect(childTimeline.props.blocks).toEqual(childBlocks)
      expect(renderer!.root.findAllByType(FloatingComposer)).toHaveLength(0)
      expect(renderer!.root.findAllByProps({
        'data-testid': 'write-subagent-session-header'
      })).toHaveLength(1)
      expect(useChatStore.getState().activeThreadId).toBe('write-parent')
      expect(useChatStore.getState().selectThread).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(provider.getAttachmentContent).toHaveBeenCalledWith('att_work_child', {
          threadId: 'write-child',
          workspace: '/workspace'
        })
        expect(renderer!.root.findAllByType('img')).toHaveLength(1)
      }, { timeout: 5_000 })

      const returnBar = renderer!.root.findByType(SubagentReturnBar)
      await act(async () => {
        returnBar.props.onBack()
      })

      expect(renderer!.root.findByType(LazyMessageTimeline).props.activeThreadId).toBe('write-parent')
      expect(renderer!.root.findAllByType(FloatingComposer)).toHaveLength(1)
    } finally {
      if (renderer) act(() => renderer!.unmount())
    }
  })

  it('closes a local child transcript when the active Work file changes', async () => {
    provider.getThreadDetail.mockResolvedValue({
      blocks: [{ kind: 'assistant', id: 'child-answer', text: 'Child transcript' }],
      latestSeq: 2,
      threadStatus: 'idle',
      relation: 'side',
      parentThreadId: 'write-parent'
    })

    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(createElement(WriteAssistantPanel, panelProps()))
      })
      await act(async () => {
        renderer!.root.findByType(LazyMessageTimeline).props.onOpenChildThread('write-child')
        await Promise.resolve()
      })
      await vi.waitFor(() => {
        expect(renderer!.root.findByType(LazyMessageTimeline).props.activeThreadId).toBe('write-child')
      })

      await act(async () => {
        useWriteWorkspaceStore.setState({ activeFilePath: '/workspace/other.docx' })
      })

      expect(renderer!.root.findByType(LazyMessageTimeline).props.activeThreadId).toBe('write-parent')
      expect(renderer!.root.findAllByType(SubagentReturnBar)).toHaveLength(0)
      expect(renderer!.root.findAllByType(FloatingComposer)).toHaveLength(1)
    } finally {
      if (renderer) act(() => renderer!.unmount())
    }
  })
})
