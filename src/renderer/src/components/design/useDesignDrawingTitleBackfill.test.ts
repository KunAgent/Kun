/** @vitest-environment jsdom */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadDetail } from '../../agent/types'
import type { DesignDocument } from '../../design/design-types'

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  hydrateDesignChatMetaForDoc: vi.fn(),
  readFirstDesignPromptFromMirrors: vi.fn(),
  readDesignThreadRegistry: vi.fn(),
  getDesignWorkspaceState: vi.fn()
}))

vi.mock('../../agent/registry', () => ({ getProvider: mocks.getProvider }))
vi.mock('../../design/design-chat-transcript', () => ({
  hydrateDesignChatMetaForDoc: mocks.hydrateDesignChatMetaForDoc,
  readFirstDesignPromptFromMirrors: mocks.readFirstDesignPromptFromMirrors
}))
vi.mock('../../design/design-thread-registry', () => ({
  designDocKey: (workspaceRoot: string, documentId: string) => `${workspaceRoot}\u0000${documentId}`,
  readDesignThreadRegistry: mocks.readDesignThreadRegistry
}))
vi.mock('../../design/design-workspace-store', () => ({
  useDesignWorkspaceStore: { getState: mocks.getDesignWorkspaceState }
}))

import { useDesignDrawingTitleBackfill } from './useDesignDrawingTitleBackfill'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

const drawing: DesignDocument = {
  id: 'legacy-document',
  title: 'legacy-document',
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  order: 0,
  artifacts: [],
  activeArtifactId: null
}

function thread(updatedAt: string): NormalizedThread {
  return {
    id: 'thread-design',
    title: 'Design thread',
    updatedAt,
    model: 'test-model',
    mode: 'agent',
    status: 'idle',
    agentSurface: 'design'
  }
}

function Probe({ enabled, threads }: {
  enabled: boolean
  threads: NormalizedThread[]
}): ReactElement | null {
  useDesignDrawingTitleBackfill({
    enabled,
    workspaceRoot: '/workspace',
    documents: [drawing],
    threads,
    runtimeConnection: 'ready'
  })
  return null
}

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

describe('useDesignDrawingTitleBackfill', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setReactActEnvironment(true)
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.readDesignThreadRegistry.mockReturnValue({
      version: 1,
      workspaces: {
        ['/workspace\u0000legacy-document']: {
          activeThreadId: 'thread-design',
          threadIds: ['thread-design']
        }
      }
    })
    mocks.readFirstDesignPromptFromMirrors.mockResolvedValue('')
    mocks.getDesignWorkspaceState.mockReturnValue({
      workspaceRoot: '/workspace',
      documents: [drawing],
      renameDocument: vi.fn()
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
  })

  it('does no backfill work outside the Design surface', async () => {
    mocks.getProvider.mockReturnValue({ getThreadDetail: vi.fn() })
    await act(async () => root.render(createElement(Probe, {
      enabled: false,
      threads: [thread('2026-09-03T00:00:00.000Z')]
    })))

    expect(mocks.getProvider).not.toHaveBeenCalled()
    expect(mocks.hydrateDesignChatMetaForDoc).not.toHaveBeenCalled()
  })

  it('does not restart an in-flight backfill when thread summaries refresh', async () => {
    const pending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn(() => pending.promise)
    mocks.getProvider.mockReturnValue({ getThreadDetail })

    await act(async () => root.render(createElement(Probe, {
      enabled: true,
      threads: [thread('2026-09-03T00:00:00.000Z')]
    })))
    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    await act(async () => root.render(createElement(Probe, {
      enabled: true,
      threads: [thread('2026-09-03T00:01:00.000Z')]
    })))
    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve({
      blocks: [{ kind: 'user', id: 'prompt', text: 'Create a focused dashboard' }],
      latestSeq: 1,
      threadStatus: 'idle'
    }))
  })
})
