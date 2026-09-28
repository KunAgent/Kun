// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline } from './MessageTimeline'

const codeThread: NormalizedThread = {
  id: 'thread-code',
  title: 'Code',
  updatedAt: '2026-08-23T00:00:00.000Z',
  model: 'deepseek-v4-pro',
  mode: 'agent',
  workspace: '/workspace/deepseek-gui',
  status: 'idle'
}

const adeThread: NormalizedThread = {
  ...codeThread,
  id: 'thread-ade',
  title: 'ADE manager',
  workspaceMode: 'ade'
}

const workerThread: NormalizedThread = {
  ...codeThread,
  id: 'thread-worker',
  title: 'Worker',
  workspaceMode: 'ade',
  executionUnit: {
    kind: 'worker',
    teamId: 'team-1',
    managerThreadId: 'thread-ade',
    label: 'Reviewer',
    lifecycle: 'persistent',
    control: 'manager'
  }
}

const workerPayload = {
  team: {
    teamId: 'team-1',
    managerThreadId: 'thread-ade',
    status: 'active',
    workers: [],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z'
  },
  worker: {
    workerId: 'thread-worker',
    label: 'Reviewer',
    control: 'manager',
    state: 'active'
  }
}

function renderTimeline(container: HTMLDivElement, root: Root, thread: NormalizedThread): void {
  useChatStore.setState({
    route: 'chat',
    workspaceRoot: '/workspace/deepseek-gui',
    activeThreadId: thread.id,
    threadLoadingId: null,
    threads: [thread],
    busy: false,
    busyUnconfirmed: false,
    currentTurnId: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    clawChannels: [],
    activeClawChannelId: ''
  })
  root.render(
    createElement(MessageTimeline, {
      blocks: [{ kind: 'assistant', id: 'answer', text: 'ready-content' }],
      liveReasoning: '',
      live: '',
      activeThreadId: thread.id,
      runtimeConnection: 'ready',
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined
    })
  )
}

describe('MessageTimeline worker control banner', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    container.remove()
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function stubRuntimeRequest(): ReturnType<typeof vi.fn> {
    const runtimeRequest = vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/v1/teams/workers/')
          ? { ok: true, status: 200, body: JSON.stringify(workerPayload) }
          : { ok: true, status: 200, body: JSON.stringify({ buckets: [] }) }
      )
    )
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { runtimeRequest } })
    return runtimeRequest
  }

  const workerLookups = (runtimeRequest: ReturnType<typeof vi.fn>): unknown[][] =>
    runtimeRequest.mock.calls.filter(([path]) =>
      typeof path === 'string' && path.startsWith('/v1/teams/workers/'))

  it.each([
    ['code', codeThread],
    ['ade manager', adeThread]
  ])('skips the worker lookup for %s threads', async (_label, thread) => {
    const runtimeRequest = stubRuntimeRequest()
    await act(async () => renderTimeline(container, root!, thread))
    expect(container.querySelector('[data-worker-control-banner]')).toBeNull()
    expect(workerLookups(runtimeRequest)).toHaveLength(0)
  })

  it('loads the worker record and shows the banner for ADE worker threads', async () => {
    const runtimeRequest = stubRuntimeRequest()
    await act(async () => renderTimeline(container, root!, workerThread))
    expect(workerLookups(runtimeRequest)).toHaveLength(1)
    const banner = container.querySelector('[data-worker-control-banner]')
    expect(banner?.getAttribute('data-worker-control-banner')).toBe('manager')
  })
})
