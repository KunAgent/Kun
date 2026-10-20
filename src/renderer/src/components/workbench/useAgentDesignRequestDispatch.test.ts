import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useAgentDesignRequestStore } from '../../design/agent-design-requests'
import {
  clearCanvasTurnTerminalRegistry,
  recordCanvasTurnTerminal
} from '../../design/canvas/canvas-turn-terminal-registry'
import { agentDesignProfileSelection, useAgentDesignRequestDispatch } from './useAgentDesignRequestDispatch'

const REQUEST_ID = 'design_0123456789abcdef'

const thread: NormalizedThread = {
  id: 'thread-1',
  title: 'Code task',
  updatedAt: '2026-10-20T00:00:00.000Z',
  model: '',
  mode: 'agent',
  workspace: '/workspace',
  agentSurface: 'code'
}

function designBlock(requestId = REQUEST_ID, turnId = 'turn-1'): ChatBlock {
  return {
    kind: 'tool',
    id: `tool_${requestId}`,
    turnId,
    summary: 'design_open',
    status: 'success',
    toolKind: 'file_change',
    meta: {
      toolName: 'design_open',
      designOpenRequest: {
        status: 'queued',
        requestId,
        title: 'Footer entry',
        brief: 'Move the update button into the sidebar footer.',
        target: 'app'
      }
    }
  } as unknown as ChatBlock
}

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('agent design request dispatch', () => {
  let renderer: ReactTestRenderer | null = null
  const sendDesignPrompt = vi.fn(async () => true)

  const Harness = ({ busy }: { busy: boolean }) => {
    useAgentDesignRequestDispatch({
      activeThreadId: thread.id,
      busy,
      runtimeConnection: 'ready',
      threads: [thread],
      workspaceRoot: '/workspace',
      profile: { outputMedium: 'html', target: 'web', preset: 'shadcn' },
      imageGenerationAvailable: false,
      sendDesignPrompt
    })
    return null
  }

  async function render(busy: boolean): Promise<void> {
    useChatStore.setState({ busy })
    await act(async () => {
      if (renderer) renderer.update(createElement(Harness, { busy }))
      else renderer = create(createElement(Harness, { busy }))
    })
    await act(async () => { await Promise.resolve() })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      dispatchEvent: vi.fn(() => true)
    })
    clearCanvasTurnTerminalRegistry()
    sendDesignPrompt.mockClear()
    useAgentDesignRequestStore.setState({ records: {}, manualStarts: [] })
    useDesignWorkspaceStore.setState({ workspaceRoot: '/workspace', documents: [], activeDocumentId: null })
    useChatStore.setState({
      blocks: [designBlock()],
      currentTurnId: 'turn-1',
      queuedMessages: [],
      threads: [thread],
      busy: true
    })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount())
    renderer = null
    vi.unstubAllGlobals()
  })

  it('starts one Design pass on the same conversation after the reply completes', async () => {
    await render(true)
    expect(useAgentDesignRequestStore.getState().records[REQUEST_ID]?.phase).toBe('waiting')
    expect(sendDesignPrompt).not.toHaveBeenCalled()

    recordCanvasTurnTerminal('turn-1', 'completed', thread.id)
    useChatStore.setState({ currentTurnId: null })
    await render(false)

    expect(sendDesignPrompt).toHaveBeenCalledTimes(1)
    expect(sendDesignPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Move the update button into the sidebar footer.'),
      {
        displayText: 'Footer entry',
        drawingTitle: 'Footer entry',
        profileSelection: { outputMedium: 'html', target: 'app', preset: 'shadcn' },
        allowMultiPage: false,
        messageSource: 'design_continuation',
        ignoreComposerAttachments: true
      }
    )
    expect(useAgentDesignRequestStore.getState().records[REQUEST_ID]?.phase).toBe('running')

    await render(false)
    expect(sendDesignPrompt).toHaveBeenCalledTimes(1)
  })

  it('does not start a pass for a stopped reply', async () => {
    await render(true)
    recordCanvasTurnTerminal('turn-1', 'aborted', thread.id)
    useChatStore.setState({ currentTurnId: null })
    await render(false)
    expect(sendDesignPrompt).not.toHaveBeenCalled()
    expect(useAgentDesignRequestStore.getState().records[REQUEST_ID]?.phase).toBe('cancelled')
  })

  it('never auto-starts a request loaded from history', async () => {
    useChatStore.setState({ currentTurnId: null })
    await render(false)
    expect(useAgentDesignRequestStore.getState().records[REQUEST_ID]).toBeUndefined()
    expect(sendDesignPrompt).not.toHaveBeenCalled()
  })

  it('starts a history request when the card asks for it', async () => {
    useChatStore.setState({ currentTurnId: null })
    await render(false)
    act(() => useAgentDesignRequestStore.getState().requestStart(REQUEST_ID))
    await render(false)
    expect(sendDesignPrompt).toHaveBeenCalledTimes(1)
    expect(useAgentDesignRequestStore.getState().records[REQUEST_ID]?.phase).toBe('running')
  })

  it('waits for queued user messages before starting', async () => {
    await render(true)
    recordCanvasTurnTerminal('turn-1', 'completed', thread.id)
    useChatStore.setState({ currentTurnId: null, queuedMessages: [{ id: 'q1', text: 'next' }] })
    await render(false)
    expect(sendDesignPrompt).not.toHaveBeenCalled()
    useChatStore.setState({ queuedMessages: [] })
    await render(false)
    expect(sendDesignPrompt).toHaveBeenCalledTimes(1)
  })

  it('records a failed start so the card can offer a retry', async () => {
    sendDesignPrompt.mockResolvedValueOnce(false)
    await render(true)
    recordCanvasTurnTerminal('turn-1', 'completed', thread.id)
    useChatStore.setState({ currentTurnId: null, error: 'Runtime is offline' })
    await render(false)
    expect(useAgentDesignRequestStore.getState().records[REQUEST_ID]).toMatchObject({
      phase: 'failed',
      error: 'Runtime is offline'
    })
    useChatStore.setState({ error: null })
  })
})

describe('agent design profile selection', () => {
  it('lets the request override target and medium but keeps the style preset', () => {
    expect(agentDesignProfileSelection(
      { outputMedium: 'html', target: 'web', preset: 'material' },
      { target: 'app', medium: 'image' },
      true
    )).toEqual({ outputMedium: 'image', target: 'app', preset: 'material' })
  })

  it('falls an image request back to HTML when image generation is unavailable', () => {
    expect(agentDesignProfileSelection(undefined, { medium: 'image' }, false))
      .toEqual({ outputMedium: 'html', target: 'web', preset: 'none' })
  })
})
