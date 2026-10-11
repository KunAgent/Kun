import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposer } from './FloatingComposer'

const captured = vi.hoisted(() => ({ context: {} as FloatingComposerRenderContext }))
vi.mock('./FloatingComposerSurfaceView', () => ({
  FloatingComposerSurfaceView: ({ context }: { context: FloatingComposerRenderContext }) => {
    captured.context = context
    return null
  }
}))
vi.mock('./FloatingComposerStackView', () => ({ FloatingComposerStackView: () => null }))
vi.mock('./use-ade-composer-controls', () => ({
  useAdeComposerControls: () => ({
    harnessId: useChatStore((state) => state.composerHarnessId),
    isolation: 'local', worktreeGit: {}
  })
}))

let renderer: ReactTestRenderer | undefined
let previous: ReturnType<typeof useChatStore.getState>
const setActiveThreadGoal = vi.fn(async () => true)
const onSend = vi.fn()
const onReviewCommand = vi.fn(async () => undefined)
const setInput = vi.fn()
const props = (input = 'Fix the tests') => ({
  input, setInput, mode: 'agent' as const, setMode: vi.fn(), busy: false,
  runtimeReady: true, hasActiveThread: true, workspaceRootOverride: '/repo',
  taskSurface: 'code' as const, composerModel: 'test', composerPickList: ['test'],
  onComposerModelChange: vi.fn(), queuedMessages: [], onRemoveQueuedMessage: vi.fn(),
  onSend, onInterrupt: vi.fn(), onReviewCommand, onPlanCommand: vi.fn(),
  attachmentUploadEnabled: false, webAccessAvailable: false
})

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  previous = useChatStore.getState()
  vi.clearAllMocks()
  vi.stubGlobal('document', { activeElement: null })
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(), kunGui: undefined
  })
  useChatStore.setState({
    activeThreadId: 'thread-test', activeThreadGoal: null, activeThreadTodos: null,
    blocks: [], threads: [{ id: 'thread-test', title: 'Task', workspace: '/repo',
      updatedAt: '2026-01-01T00:00:00.000Z', mode: 'agent', model: 'test' }], route: 'chat', workspaceRoot: '/repo',
    composerHarnessId: 'kun', composerProviderId: '', composerModelGroups: [],
    setActiveThreadGoal
  })
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  useChatStore.setState(previous)
  vi.unstubAllGlobals()
})

async function mount(input?: string): Promise<void> {
  await act(async () => { renderer = create(createElement(FloatingComposer, props(input))) })
}

describe('Kun-only composer action boundary', () => {
  it('clears an open goal panel and goal input mode when the same task switches to an external Agent', async () => {
    await mount()
    await act(async () => {
      captured.context.setGoalInputMode(true)
      captured.context.setGoalPanelOpen(true)
    })
    expect(captured.context.goalInputMode).toBe(true)
    expect(captured.context.goalPanelOpen).toBe(true)
    await act(async () => useChatStore.getState().setComposerHarness('codex', 'native-login'))
    expect(captured.context.goalInputMode).toBe(false)
    expect(captured.context.goalPanelOpen).toBe(false)
    await act(async () => captured.context.handlePrimaryAction())
    expect(onSend).toHaveBeenCalledOnce()
    expect(setActiveThreadGoal).not.toHaveBeenCalled()
  })

  it('sends ordinary external input even if goal mode is restored after the Agent switch', async () => {
    useChatStore.getState().setComposerHarness('codex', 'native-login')
    await mount()
    await act(async () => captured.context.setGoalInputMode(true))
    expect(captured.context.goalInputMode).toBe(true)
    expect(captured.context.canOpenGoalPanel).toBe(false)
    await act(async () => captured.context.handlePrimaryAction())
    expect(onSend).toHaveBeenCalledOnce()
    expect(setActiveThreadGoal).not.toHaveBeenCalled()
    expect(setInput).not.toHaveBeenCalled()
  })

  it('leaves a manually typed review command to the external Agent instead of invoking Kun review', async () => {
    useChatStore.getState().setComposerHarness('codex', 'native-login')
    await mount('/review focus on auth')
    expect(captured.context.onReviewCommand).toBeUndefined()
    expect(captured.context.highlightedSlashCommand).toBeFalsy()
    await act(async () => captured.context.handlePrimaryAction())
    expect(onReviewCommand).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('keeps Kun goal input and review actions available', async () => {
    await mount()
    await act(async () => captured.context.setGoalInputMode(true))
    await act(async () => captured.context.handlePrimaryAction())
    expect(setActiveThreadGoal).toHaveBeenCalledWith('Fix the tests')
    expect(onSend).not.toHaveBeenCalled()
    await act(async () => renderer!.update(createElement(FloatingComposer, props('/review focus on auth'))))
    await act(async () => captured.context.handlePrimaryAction())
    expect(onReviewCommand).toHaveBeenCalledWith({ kind: 'custom', instructions: 'focus on auth' })
  })
})
