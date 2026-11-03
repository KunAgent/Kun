import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposer } from './FloatingComposer'
import type { FloatingComposerProps } from './floating-composer-policy'
import { resolveComposerInterrupt, type ComposerApprovalBlock } from './use-composer-interrupt'
import type { ComposerUserInputController } from './use-composer-user-input'

const approval: ComposerApprovalBlock = {
  kind: 'approval',
  id: 'blk_approval',
  approvalId: 'appr_1',
  summary: 'Run npm test',
  toolName: 'run_shell_command',
  status: 'pending'
}

const askUser: Extract<ChatBlock, { kind: 'user_input' }> = {
  kind: 'user_input',
  id: 'blk_ask',
  requestId: 'req_1',
  status: 'pending',
  live: true,
  questions: [{
    id: 'q1',
    header: 'State',
    question: 'Where should login state live?',
    options: [{ label: 'Zustand store', description: 'Matches chat-store' }]
  }]
}

function composerProps(overrides: Partial<FloatingComposerProps> = {}): FloatingComposerProps {
  return {
    input: 'Keep this draft',
    setInput: () => undefined,
    mode: 'agent',
    setMode: () => undefined,
    busy: true,
    runtimeReady: true,
    hasActiveThread: true,
    composerModel: 'test-model',
    composerPickList: ['test-model'],
    onComposerModelChange: () => undefined,
    queuedMessages: [],
    onRemoveQueuedMessage: () => undefined,
    onSend: () => undefined,
    onInterrupt: () => undefined,
    ...overrides
  }
}

function renderComposer(overrides: Partial<FloatingComposerProps> = {}): string {
  return renderToStaticMarkup(createElement(FloatingComposer, composerProps(overrides)))
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useChatStore.setState({
    activeThreadId: 'thr_1',
    activeThreadGoal: null,
    activeThreadTodos: null,
    route: 'chat',
    workspaceRoot: '/repo',
    threads: [],
    blocks: [{ kind: 'user', id: 'u1', text: 'Refactor login' } as ChatBlock]
  })
})

describe('resolveComposerInterrupt', () => {
  const idle = { active: false } as ComposerUserInputController
  const asking = { active: true } as ComposerUserInputController

  it('puts pending approvals before the ask-user request', () => {
    expect(resolveComposerInterrupt([approval], asking)).toEqual({ kind: 'approval', approvals: [approval] })
    expect(resolveComposerInterrupt([], asking)).toEqual({ kind: 'user-input', controller: asking })
    expect(resolveComposerInterrupt(undefined, idle)).toBeNull()
  })
})

describe('FloatingComposer interrupt slot', () => {
  it('shows the approval card in the shell slot and keeps the hidden editor mounted', async () => {
    // Store-driven blocks need a client render (server snapshots read the initial store).
    useChatStore.setState({ blocks: [...useChatStore.getState().blocks, approval] })
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      kunGui: { getSettings: vi.fn(async () => ({ composerSendKey: 'enter' })) }
    })
    let renderer!: ReturnType<typeof createRenderer>
    try {
      await act(async () => {
        renderer = createRenderer(createElement(FloatingComposer, composerProps()))
      })
      const slot = renderer.root.findByProps({ 'data-composer-input-slot': true })
      expect(slot.props['data-interrupt']).toBe('approval')
      expect(slot.findAllByProps({ 'data-composer-stack-item': 'approval' }).length).toBeGreaterThan(0)
      const editor = slot.findByProps({ 'data-composer-editor': true })
      expect(editor.props.hidden).toBe(true)
      expect(editor.props.inert).toBe(true)
      expect(editor.props['aria-hidden']).toBe(true)
      expect(editor.findByType('textarea').props.value).toBe('Keep this draft')
    } finally {
      if (renderer) await act(async () => renderer.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('shows the ask-user card for a live request and leaves the shell visible otherwise', () => {
    const withAsk = renderComposer({ userInputBlocksOverride: [askUser], onResolveUserInput: vi.fn(async () => undefined) })
    expect(withAsk).toContain('data-interrupt="user-input"')
    expect(withAsk).toContain('data-composer-stack-item="user-input"')
    expect(withAsk).toMatch(/<div hidden=""[^>]*data-composer-editor/)

    const plain = renderComposer()
    expect(plain).not.toContain('data-interrupt=')
    expect(plain).toMatch(/<div data-composer-editor/)
  })
})

describe('FloatingComposer send / queue / stop', () => {
  it('shows a quiet Stop with the Esc hint while running with an empty draft', () => {
    const html = renderComposer({ input: '' })
    expect(html).toContain('data-primary-action="interrupt"')
    expect(html).toContain('title="Stop (Esc)"')
    expect(html).toContain('aria-keyshortcuts="Escape"')
    expect(html).toContain('ds-composer-stop-action')
    expect(html).toContain('placeholder="Keep typing to queue follow-up changes…"')
  })

  it('queues a running draft with the dark button and the Enter hint', () => {
    const html = renderComposer()
    expect(html).toContain('data-primary-action="queue"')
    expect(html).toContain('aria-label="Queue message"')
    expect(html).toContain('lucide-arrow-up')
    expect(html).toContain('Enter to queue')
  })

  it('keeps the idle send button', () => {
    const html = renderComposer({ busy: false })
    expect(html).toContain('data-primary-action="submit"')
    expect(html).not.toContain('Enter to queue')
  })
})
