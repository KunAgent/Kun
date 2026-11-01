import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { openAgentDesignCanvas } from '../../design/agent-design-ingest'
import { useAgentDesignAutoOpen } from './useAgentDesignAutoOpen'

vi.mock('../../store/chat-store', async () => {
  const { create } = await import('zustand')
  return { useChatStore: create(() => ({})) }
})
vi.mock('../../design/agent-design-ingest', () => ({
  ingestAgentDesign: vi.fn(async () => '12345678'),
  openAgentDesignCanvas: vi.fn(async () => true)
}))

function design(status: 'pending' | 'ready', id = 'tool-design'): ChatBlock {
  return {
    kind: 'tool', id, turnId: 'turn-design', summary: 'design_open',
    status: status === 'pending' ? 'running' : 'success',
    meta: {
      toolName: 'design_open',
      designOpenRequest: {
        status, title: 'Dashboard', screenCount: 1,
        requestId: 'design_0123456789abcdef', documentId: '12345678',
        screens: status === 'pending' ? [] : [{
          artifactId: 'abcdef12', name: 'Overview', width: 1280, height: 800,
          relativePath: '.kun-design/12345678/abcdef12/v1.html'
        }]
      }
    }
  }
}

function Harness({ workspaceRoot = '/repo' }: { workspaceRoot?: string }): null {
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  useAgentDesignAutoOpen({ activeThreadId, threads: [], workspaceRoot })
  return null
}

let renderer: ReactTestRenderer | undefined
async function mount(): Promise<void> {
  await act(async () => { renderer = create(createElement(Harness)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  useChatStore.setState({
    activeThreadId: 'thread-a', blocks: [], busy: false, busyUnconfirmed: false,
    threadLoadingId: null, currentTurnId: null
  })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
})

describe('agent design automatic reveal', () => {
  it.each([true, false])('does not reopen history on selection (unconfirmed=%s)', async (busyUnconfirmed) => {
    useChatStore.setState({ blocks: [design('ready')], busy: true, busyUnconfirmed, currentTurnId: 'turn-design' })
    await mount()
    await act(async () => { useChatStore.setState({ busyUnconfirmed: false }) })
    expect(openAgentDesignCanvas).not.toHaveBeenCalled()
  })

  it('treats the completed hydration projection as history', async () => {
    useChatStore.setState({ threadLoadingId: 'thread-a' })
    await mount()
    await act(async () => {
      useChatStore.setState({ threadLoadingId: null, blocks: [design('ready')], busy: true, currentTurnId: 'turn-design' })
    })
    expect(openAgentDesignCanvas).not.toHaveBeenCalled()
  })

  it('reveals a new ready result once during a confirmed live turn', async () => {
    await mount()
    await act(async () => {
      useChatStore.setState({ blocks: [design('ready')], busy: true, currentTurnId: 'turn-design' })
    })
    expect(openAgentDesignCanvas).toHaveBeenCalledTimes(1)
    expect(openAgentDesignCanvas).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-a', workspaceRoot: '/repo' }))
    await act(async () => { useChatStore.setState({ blocks: [design('ready')], busy: false, currentTurnId: null }) })
    expect(openAgentDesignCanvas).toHaveBeenCalledTimes(1)
  })

  it('remembers live pending calls when the result and turn completion arrive together', async () => {
    await mount()
    await act(async () => { useChatStore.setState({ blocks: [design('pending')], busy: true, currentTurnId: 'turn-design' }) })
    await act(async () => { useChatStore.setState({ blocks: [design('ready')], busy: false, currentTurnId: null }) })
    expect(openAgentDesignCanvas).toHaveBeenCalledTimes(1)
  })

  it('does not promote an unconfirmed pending replay to a live request', async () => {
    await mount()
    await act(async () => {
      useChatStore.setState({ blocks: [design('pending')], busy: true, busyUnconfirmed: true, currentTurnId: 'turn-design' })
    })
    await act(async () => { useChatStore.setState({ blocks: [design('ready')], busy: false, busyUnconfirmed: false, currentTurnId: null }) })
    expect(openAgentDesignCanvas).not.toHaveBeenCalled()
  })

  it('clears pending ownership on selection and invalidates outstanding asynchronous work', async () => {
    await mount()
    await act(async () => { useChatStore.setState({ blocks: [design('ready')], busy: true, currentTurnId: 'turn-design' }) })
    const options = vi.mocked(openAgentDesignCanvas).mock.calls[0][0]
    expect(options.isCurrent?.()).toBe(true)
    await act(async () => { useChatStore.setState({ activeThreadId: 'thread-b', blocks: [], busy: false, currentTurnId: null }) })
    expect(options.isCurrent?.()).toBe(false)
    await act(async () => { useChatStore.setState({ activeThreadId: 'thread-a', blocks: [design('ready')], busy: true, currentTurnId: 'turn-design' }) })
    expect(options.isCurrent?.()).toBe(false)
    expect(openAgentDesignCanvas).toHaveBeenCalledTimes(1)
  })

  it('invalidates asynchronous work when the workspace changes or the hook unmounts', async () => {
    await mount()
    await act(async () => { useChatStore.setState({ blocks: [design('ready')], busy: true, currentTurnId: 'turn-design' }) })
    const options = vi.mocked(openAgentDesignCanvas).mock.calls[0][0]
    expect(options.isCurrent?.()).toBe(true)
    await act(async () => { renderer?.update(createElement(Harness, { workspaceRoot: '/other' })) })
    expect(options.isCurrent?.()).toBe(false)
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    expect(options.isCurrent?.()).toBe(false)
  })

  it('does not reuse a pending block id in another conversation', async () => {
    await mount()
    await act(async () => { useChatStore.setState({ blocks: [design('pending')], busy: true, currentTurnId: 'turn-design' }) })
    await act(async () => {
      useChatStore.setState({ activeThreadId: 'thread-b', blocks: [design('ready')], busy: false, currentTurnId: null })
    })
    expect(openAgentDesignCanvas).not.toHaveBeenCalled()
  })
})
