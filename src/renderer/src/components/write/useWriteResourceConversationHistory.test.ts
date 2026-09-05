import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  emptyWriteThreadRegistry,
  markWriteThread,
  saveWriteThreadRegistry
} from '../../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import {
  useWriteResourceConversationHistory,
  type WriteResourceConversationHistoryModel
} from './useWriteResourceConversationHistory'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const workspace = '/work'
const filePath = '/work/draft.md'
const now = '2026-08-30T00:00:00.000Z'
let currentModel: WriteResourceConversationHistoryModel | null = null

function thread(id: string, status = 'idle'): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: now,
    model: 'deepseek-v4',
    mode: 'agent',
    workspace,
    agentSurface: 'write',
    status
  }
}

function Harness({ busy = false }: { busy?: boolean }): null {
  currentModel = useWriteResourceConversationHistory(busy)
  return null
}

describe('useWriteResourceConversationHistory', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage, kunGui: { platform: 'darwin' } })
    let registry = emptyWriteThreadRegistry()
    registry = markWriteThread(workspace, 'thread-1', registry, filePath)
    registry = markWriteThread(workspace, 'thread-2', registry, filePath)
    registry = markWriteThread(workspace, 'thread-3', registry, filePath)
    saveWriteThreadRegistry(registry, storage)
    useWriteWorkspaceStore.setState({
      workspaceRoot: workspace,
      activeFilePath: filePath,
      activeWhiteboardId: null,
      whiteboards: {}
    })
  })

  afterEach(() => {
    currentModel = null
    vi.unstubAllGlobals()
  })

  it('switches within the file scope and falls back after archiving the current conversation', async () => {
    const selectWriteThread = vi.fn(async () => undefined)
    const archiveThread = vi.fn(async () => undefined)
    useChatStore.setState({
      runtimeConnection: 'ready',
      activeThreadId: 'thread-3',
      threads: [thread('thread-3'), thread('thread-2'), thread('thread-1')],
      selectWriteThread,
      archiveThread
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness))
    })

    expect(currentModel?.entries.map((entry) => entry.id))
      .toEqual(['thread-3', 'thread-2', 'thread-1'])
    await act(async () => currentModel?.selectConversation('thread-1'))
    expect(selectWriteThread).toHaveBeenCalledWith('thread-1', workspace, filePath)

    await act(async () => currentModel?.archiveConversation('thread-3'))
    expect(archiveThread).toHaveBeenCalledWith('thread-3', true)
    expect(selectWriteThread).toHaveBeenLastCalledWith('thread-2', workspace, filePath)
    await act(async () => renderer.unmount())
  })

  it('blocks every mutation when any associated conversation is running', async () => {
    const selectWriteThread = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const archiveThread = vi.fn(async () => undefined)
    useChatStore.setState({
      runtimeConnection: 'ready',
      activeThreadId: 'thread-3',
      threads: [thread('thread-3'), thread('thread-2', 'running'), thread('thread-1')],
      selectWriteThread,
      renameThread,
      archiveThread
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness))
    })

    await expect(currentModel?.canStartConversation()).resolves.toBe(false)
    await act(async () => currentModel?.selectConversation('thread-1'))
    await act(async () => currentModel?.renameConversation('thread-1', 'Renamed'))
    await act(async () => currentModel?.archiveConversation('thread-1'))
    expect(selectWriteThread).not.toHaveBeenCalled()
    expect(renameThread).not.toHaveBeenCalled()
    expect(archiveThread).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})
